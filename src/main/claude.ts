import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnEnv } from './lib/login-shell'
import type { ClaudeActivity, ClaudeMode, ClaudeStatus, ClaudeTools } from '@shared/types'

/**
 * Claude, headless.
 *
 * The app shells out to the `claude` CLI rather than talking to an API: the
 * binary already holds the user's credentials, so there is no key to store here
 * and nothing to keep in sync when they switch plans.
 *
 * Two shapes of run come through here. The one-shot modes are a sentence in and
 * a block of markdown out — a diagram, a drawing, a program, a table — with
 * every tool switched off and nothing kept between requests; they are the fast
 * path and they stay that way. Agent mode is the other one: it runs in the
 * vault with tools, remembers the session so a follow-up can say "now add the
 * error cases", and takes as long as the work takes.
 */

/** Switched off wholesale for the one-shot modes: a text generator, not an agent. */
const NO_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'Task',
  'WebSearch',
  'WebFetch',
  'NotebookEdit'
].join(',')

/**
 * What the agent may run, given the switches in Settings.
 *
 * Reading comes with the mode; the rest is opt-in. `TodoWrite` is in the read
 * set because it writes nothing outside the CLI's own scratch list, and an
 * agent that can keep a plan does noticeably better on the multi-step asks
 * this mode exists for.
 */
function agentTools(tools: ClaudeTools): string {
  const allowed = ['Read', 'Glob', 'Grep', 'Task', 'TodoWrite']
  if (tools.write) allowed.push('Write', 'Edit', 'NotebookEdit')
  if (tools.web) allowed.push('WebSearch', 'WebFetch')
  if (tools.shell) allowed.push('Bash')
  return allowed.join(',')
}

/**
 * Rules every mode that draws or writes into a note shares.
 *
 * Kept in one string because they are properties of the destination — a
 * markdown file read in a light and a dark theme — rather than of the request,
 * and three copies of them would drift.
 */
const HOUSE_RULES = `The answer is pasted straight into a note, so: no preamble, no sign-off, no "here is". No top-level heading unless one was asked for, tables in GitHub markdown, code in fenced blocks with a language tag, and never an outer fence wrapped around the whole reply.

The note is read in both a light and a dark theme, so anything that carries its own colours must work on either. Be concrete and dense: real names, real numbers, real edges. Placeholder content like "Class A" or "step 2 goes here" is a wasted answer.`

const DIAGRAM_PROMPT = `You draw diagrams for a markdown notes app. The user describes something; you answer with the diagram.

Reply with a fenced code block tagged \`mermaid\`. The block is rendered by Mermaid 11, so it must parse on the first try. Where one picture genuinely cannot hold the answer — a system worth both a structure and a sequence — several blocks are allowed, each under its own \`###\` heading; one is the normal case.

Pick the diagram type that fits what was asked:
- objects, classes, fields, methods, inheritance -> classDiagram
- trees, data structures, linked lists, graphs, algorithms -> flowchart TD with node shapes that read as the structure
- processes, decisions, control flow -> flowchart TD
- calls between components over time -> sequenceDiagram
- tables and their keys -> erDiagram
- states and transitions -> stateDiagram-v2
- a loose hierarchy of ideas -> mindmap
- work over time -> gantt or timeline
- quantities against two axes -> quadrantChart or xychart-beta

Go as deep as the subject deserves. Subgraphs to group what belongs together, notes on the parts that need one, labelled edges rather than bare arrows, and the error paths as well as the happy one.

Rules, in order of how often they break a diagram:
- Quote any flowchart node label containing parentheses, brackets or quotes — A["Node (left)"] parses, A[Node (left)] does not. Commas, colons, slashes and angle brackets are safe unquoted.
- Use <br/> for a line break inside a label, never a real newline. Give every node a short alphanumeric id.
- In a classDiagram, leave types unquoted: Map~String, Note~, List~Note~. Nesting them is allowed where it is genuinely clearer.
- \`classDef\` and \`class\` are fine for grouping, and are the right way to distinguish kinds of node. Give them colours that read on white and on near-black — a mid-tone stroke with a translucent fill, never a light fill with light text — or leave the colour out and vary the shape instead. No \`click\` directives.
- Nothing inside the block that is itself a code fence.

${HOUSE_RULES}`

const DRAWING_PROMPT = `You draw pictures for a markdown notes app, in SVG, for the things a diagram language cannot say: a labelled anatomy, a circuit, a force diagram, a map, a timeline with real proportions, an illustration of a physical mechanism.

Reply with a fenced code block tagged \`svg\` holding one \`<svg>\` element. The app renders it inline, so it must be self-contained: no external images, no fonts, no scripts, no animation that depends on JavaScript.

Make it a real drawing:
- Set \`viewBox\` and leave off \`width\`/\`height\`; the note scales it to the column. A 16:9-ish box is usually right.
- Build it out of \`<g>\` groups that name their parts, with \`<defs>\` for anything reused — a marker for arrowheads, a gradient, a symbol repeated across the picture.
- Label things. \`<text>\` with \`font-family="system-ui, sans-serif"\`, sized about 14 in a 800-wide box, anchored so it does not collide with what it points at. Leader lines where a label cannot sit on its subject.
- Use \`currentColor\` for strokes, rules and text, so the drawing follows the theme. Never set \`color\` or a background on the \`<svg>\` element itself — the note supplies both, and a drawing that pins them is invisible in one of the two themes. Where colour carries meaning, use it deliberately and sparingly: mid-tone hues at around 55% lightness read on both a white and a near-black page. Fills of a colour want \`fill-opacity\` around 0.15 with the same colour at full strength as the stroke.
- Geometry that is actually right: a lever arm to scale, a circuit whose wires meet at junctions, a curve that is the function it claims to be. Compute the coordinates rather than eyeballing them.

${HOUSE_RULES}`

const STRUCTURE_PROMPT = `You draw program figures for a markdown notes app: the pictures a programmer draws on a whiteboard and no diagram language will draw for them. Three fences, each rendered by the app itself. Reply with one fenced block, tagged with the fence you picked.

Choose by what is being explained:
- which object holds a reference to which — a Java or Python program's objects, arrays and fields -> \`boxes\`
- pointers, ownership, aliasing, what a copy did, where a thing lives -> \`memory\`
- a binary tree, a heap, a BST, a parse tree, a trie -> \`tree\`
- an algorithm whose difficulty is that it changes over time — a sort, a search, a traversal, a two-pointer walk -> \`algo\`

\`boxes\` is the default for a language with references rather than pointers. Reach for \`memory\` only when the stack/heap split is itself the point.

Anything else — control flow, classes, calls between services — is a Mermaid diagram, not one of these. Say so rather than forcing it.

BOXES. An object diagram: variables on the left, objects they refer to on the right, nothing about storage.
\`\`\`boxes
b -> board

board CBoard:
  cells -> grid

grid Int[][] [ ->r0, ->r1 ]

r0 Int[] [ 1, 2, 3 ]
r1 Int[] [ 4, 5, 6 ]
\`\`\`
Three shapes. A variable is \`name -> target\` at the left margin — a small box with its name beside it; \`-> null\` strikes it through. An object is \`id Type:\` with its fields indented, or \`id Type { field: v, field -> target }\` on one line; the box is titled with its **type**, and the \`id\` is only how the source names it for the arrows — it is never drawn, so pick short ones. A list is \`id Type [ ... ]\` and is drawn as a column: the type, then its **length**, then one row per element, each a value or \`->target\`.

Never write \`stack:\` or \`heap:\` in a \`boxes\` block; it is refused. Do not position anything — the layout follows the pointers.

MEMORY. Sections at the left margin, boxes indented under them, fields indented under those.
\`\`\`memory
title: Reversing a linked list
stack:
  reverse(head):
    prev -> null
    curr -> n2 *
heap:
  n1 Node { val: 1, next: null }
  n2 Node { val: 2, next -> n1 }
  buckets [ ., ->n1, . ]
\`\`\`
Sections are \`stack:\`, \`heap:\` and \`globals:\`. A box is \`id Type { field: value, field -> target }\`, or \`id Type:\` with its fields indented under it, or \`id [ a, b, c ]\` for an array, or \`id ( a, b )\` for a pair — the same slots as an array without the indices under them, which is what a cons cell wants. A slot may be \`->id\` to point at a box, or \`.\` for an empty one. A field is \`name = value\`, \`name: value\`, \`name -> target\` or a bare \`name\` for a slot not yet written. A target is a box id, \`id[3]\` for one array slot, or \`null\`. Every pointer must name a box that exists in the same block.

Do not position anything: the heap lays itself out by following its own pointers, so a chain of nodes becomes a chain across the page on its own. A field named \`next\`, \`cdr\`, \`tail\`, \`rest\`, \`link\`, \`succ\`, \`after\` or \`down\` is treated as the spine and keeps the row; so does the last slot of a pair. Two one-liners save writing a chain out: \`list: 1 2 3\` builds \`Node { val, next }\` boxes and \`pairs: 1 2 3\` builds cons cells, both nil-terminated.

For a box-and-pointer diagram in the Lisp sense, use the pair form — \`pairs: 1 2 3\` for a flat list, and written-out \`p1 ( ->q1, ->p2 )\` pairs when there is nesting, sharing or a cycle.

TREE. Give it the array it already is, or an indented outline.
\`\`\`tree
bst: 50 30 70 20 40
\`\`\`
\`bst:\` inserts in the order given. \`heap:\` reads an array as a complete binary tree and labels the indices. \`level:\` is level order with \`.\` for a missing child — the form every coding problem uses. An indented outline is for the trees that are not arrays, with \`.\` holding an empty slot open so a one-child node still leans the right way. Add \`traverse: inorder\` (or preorder, postorder, level) to number the nodes in visit order and caption the sequence.

ALGO. A structure, then one step per line. Every step is a frame.
\`\`\`algo
title: Bubble sort
array: 5 3 8 1
---
note Walk the pairs, swapping any out of order
compare 0 1
swap 0 1
mark 3 sorted
\`\`\`
The structure is \`array:\`, \`stack:\`, \`queue:\`, \`list:\`, or \`bst:\`/\`heap:\`/\`level:\` for a traversal over a tree. Steps: \`note <text>\`, \`compare i j\`, \`swap i j\`, \`set i v\`, \`mark i <name>\` (also \`mark 0..3 <name>\`), \`unmark i\` or \`unmark all\`, \`at <name> i\` for a named pointer under a slot, \`range <name> i j\` for a bracket over one, \`push v\`, \`pop\`, \`insert i v\`, \`remove i\`, \`visit i\`, \`clear\`, \`hold\`. In a tree, a step names a node by its label. Mark names carry colour: sorted, done, found are green; pivot, target, key purple; visited, seen, current blue; out, removed, skipped grey. \`speed: 600\` sets the milliseconds a frame is held.

Write the steps out in full — an algorithm shown for three of its twenty steps teaches nothing. Say what is happening with \`note\` at the points that need it, not on every line. Slot numbers are checked against the structure, so count them.

Annotations, in all three: \`*\` after a label rings it, \`~\` fades it, \`#red\` (or green, blue, yellow, purple, gray) colours it, and \`| text\` adds a second smaller line.

${HOUSE_RULES}`

const CODE_PROMPT = `You write programs for a markdown notes app. The user describes what they want; you answer with the code.

Reply with a fenced code block tagged with the language. A block in the note has a Run button — the app writes it to a scratch file and runs it with the language's interpreter — so what you write must run as it stands: every import at the top, no undefined helpers, no placeholder credentials, and something printed to stdout so the run has a visible result. Assume the standard library and nothing else unless the user named a package.

Runnable here: javascript, typescript, python, bash, zsh, powershell, ruby, php, perl, lua, r, go, rust, c, cpp, swift, java. Anything else still pastes fine, it just will not have a Run button.

Where the answer needs explaining, put a short paragraph or a list before the block, and comments inside it where a line earns one. Handle the cases that break: empty input, the file that is not there, the number that is zero. A second block is right when the answer is genuinely two things — the program and the test that shows it works.

${HOUSE_RULES}`

const TEXT_PROMPT = `You write blocks of markdown for a notes app. The user describes what they want; you answer with the markdown they asked for and nothing else.

Prefer a list or a table over a paragraph whenever the content has shape. Headings, nested lists, tables, fenced code, maths in $…$ and $$…$$, callouts as blockquotes — all of it renders, so use what the answer needs rather than flattening it to prose.

${HOUSE_RULES}`

const AGENT_PROMPT = `You are working inside a Stone vault: a folder of markdown notes, which is your working directory. The person asking is looking at their notes, not at a terminal.

Use your tools to answer from what is actually in the vault rather than from what a note is probably called — read the file before you describe it. Wiki links are written [[Note title]] and resolve to a file of that name; frontmatter at the top of a note is YAML between --- fences.

Your final message is what they see, and it is pasted into a note when they choose to keep it. So end with the answer itself in markdown — the diagram, the table, the code, the summary — not a report of what you did. Cite notes you drew on as [[links]]. If a tool you needed was not available, say which, once, at the end.

${HOUSE_RULES}`

const LECTURE_PROMPT = `You answer questions about a recorded lecture. You are given its transcript, with a clock time in front of every line, and often the notes the person typed while they were listening.

Answer only from what you were given. The transcript is machine-made and will have misheard names, jargon and numbers — read through an obvious mishearing when the sense is clear, and say so when it is not. If the recording does not cover what was asked, say that plainly instead of filling the gap from general knowledge.

Cite. Every claim about what was said carries the time it was said at, written bare as \`12:04\` or \`1:02:04\` — those become buttons that jump the audio there, so an answer with no times is an answer the reader cannot check. Put the time next to the claim, not in a list at the end.

Be direct and concrete: name the actual terms, definitions, numbers and examples used. Prefer a short list over a paragraph when the answer has parts. No preamble, no "based on the transcript", no summary of what you were asked. Markdown, and nothing wrapped in an outer code fence.

When the notes are included and they contradict or trail off from the recording, it is worth saying where — that is usually the reason the question is being asked.`

function systemPrompt(mode: ClaudeMode): string {
  if (mode === 'diagram') return DIAGRAM_PROMPT
  if (mode === 'drawing') return DRAWING_PROMPT
  if (mode === 'structure') return STRUCTURE_PROMPT
  if (mode === 'code') return CODE_PROMPT
  if (mode === 'agent') return AGENT_PROMPT
  if (mode === 'lecture') return LECTURE_PROMPT
  return TEXT_PROMPT
}

// ------------------------------------------------------------ finding the CLI

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Ask a login shell where `claude` is.
 *
 * An app launched from the Finder or the Start menu inherits a PATH that has
 * none of the places version managers install to, so `claude` is invisible to
 * it even though the user's terminal finds it instantly. Running their login
 * shell once, and caching what it says, is the only way to see what they see.
 */
function askLoginShell(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    const child = spawn(shell, ['-lc', 'command -v claude'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', () => resolve(out.trim().split('\n').pop()?.trim() || null))
    // A misconfigured profile can hang forever; the fallbacks below are better
    // than a dialog that never answers.
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, 4000)
  })
}

function candidates(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [
      path.join(process.env.APPDATA ?? home, 'npm', 'claude.cmd'),
      path.join(home, '.local', 'bin', 'claude.exe')
    ]
  }
  return [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ]
}

let cached: string | null = null

/**
 * The CLI's path, from the user's override, the usual places, or their shell.
 *
 * The known install locations are tried first, and the shell only when none of
 * them has anything. It is the other way round from what you would expect, and
 * the reason is that `-lc` reads the login files but not `.zshrc`: on a machine
 * where an old npm `claude` is still sitting in /usr/local/bin, the shell
 * answers with that one even though the terminal the user actually types in
 * resolves to the current install. `candidates()` is ordered, up to date, and
 * checked for real, so it is the better first guess.
 */
export async function resolveBinary(override: string | null): Promise<string | null> {
  if (override) return (await isExecutable(override)) ? override : null
  if (cached && (await isExecutable(cached))) return cached

  for (const file of candidates()) {
    if (await isExecutable(file)) {
      cached = file
      return cached
    }
  }
  const fromShell = await askLoginShell()
  if (fromShell && (await isExecutable(fromShell))) {
    cached = fromShell
    return cached
  }
  return null
}

export async function status(override: string | null): Promise<ClaudeStatus> {
  const binary = await resolveBinary(override)
  return { available: Boolean(binary), binary }
}

// ------------------------------------------------------------------- running

/**
 * Requests in flight, so a cancel from the dialog has something to kill. Keyed
 * by the id the renderer generated, because the reply to `claude:run` does not
 * arrive until the run is over — by which time cancelling is moot.
 *
 * The flag is not redundant with the exit signal: the CLI traps SIGTERM and
 * exits 143 under its own steam, so from the outside a cancel is
 * indistinguishable from a crash unless the intent is recorded here.
 */
interface Job {
  child: ChildProcess
  cancelled: boolean
}

const running = new Map<string, Job>()

export function cancel(id: string): boolean {
  const job = running.get(id)
  if (!job) return false
  job.cancelled = true
  job.child.kill('SIGTERM')
  return true
}

export interface RunRequest {
  id: string
  mode: ClaudeMode
  prompt: string
  /** Text from the note, already trimmed to size by the renderer. */
  context?: string | null
  model: string
  binaryOverride: string | null
  cwd: string | null
  /** Agent mode only: what it is allowed to do beyond reading. */
  tools?: ClaudeTools
  /**
   * Agent mode only: the session this turn continues. Null starts a new one.
   *
   * Resuming is what makes a follow-up worth typing — "now add the error
   * cases" means nothing to a process that has never seen the first answer.
   */
  sessionId?: string | null
  /** Called with the output so far, for the live preview. */
  onChunk: (text: string) => void
  /** Called as the agent picks up a tool, for the dialog's activity line. */
  onActivity?: (activity: ClaudeActivity) => void
}

export interface RunResult {
  text: string
  /** The session to pass back for a follow-up, when the run kept one. */
  sessionId: string | null
}

/**
 * The slice of the CLI's NDJSON this cares about.
 *
 * Deliberately partial: the stream carries init banners, rate-limit notices and
 * per-message usage that none of this needs, and typing all of it would be a
 * standing invitation to break whenever the CLI adds a field.
 */
interface StreamMessage {
  type: string
  parent_tool_use_id?: string | null
  session_id?: string
  event?: {
    type?: string
    delta?: { type?: string; text?: string }
  }
  /** On `assistant` messages: the blocks it produced, tool calls among them. */
  message?: {
    content?: Array<{
      type?: string
      name?: string
      input?: Record<string, unknown>
    }>
  }
  is_error?: boolean
  result?: string
}

/**
 * How long a run may take.
 *
 * The one-shot cap is generous because the ceiling on these modes was raised.
 * A drawing is the case that sets it: asked for a force diagram, the model
 * spends around three minutes working out where every arrow lands before it
 * writes a single tag, and a cap that kills that produces nothing at all. The
 * agent gets longer again — it is reading files and running searches between turns,
 * and a cap that kills it mid-task is worse than no agent at all.
 */
const TIMEOUT_MS = 420_000
const AGENT_TIMEOUT_MS = 900_000

/**
 * The argument of a tool call worth showing: a path, a pattern, a command.
 *
 * Paths come back absolute, and the vault's own prefix is the least
 * interesting part of them — it is the same on every line and eats the width
 * the file name needed. So it is cut, leaving what the user would call the note.
 */
function activityDetail(input: Record<string, unknown> | undefined, root: string | null): string {
  if (!input) return ''
  for (const key of ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'prompt']) {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) continue
    let line = value.trim().split('\n')[0]
    if (root && line.startsWith(root)) line = line.slice(root.length).replace(/^[/\\]+/, '')
    return line.length > 80 ? `${line.slice(0, 79)}…` : line
  }
  return ''
}

export async function run(request: RunRequest): Promise<RunResult> {
  const binary = await resolveBinary(request.binaryOverride)
  if (!binary) {
    throw new Error(
      'Claude Code was not found. Install it from claude.com/product/claude-code, or set the path in Settings.'
    )
  }

  // Lecture context arrives already labelled — a transcript and the notes taken
  // against it — so a second "from the note" header would only misdescribe it.
  const header = request.mode === 'lecture' ? '' : '--- context from the note ---\n'
  const input = request.context?.trim()
    ? `${request.prompt.trim()}\n\n${header}${request.context.trim()}`
    : request.prompt.trim()

  const agent = request.mode === 'agent'
  const args = [
    '--print',
    '--model',
    request.model,
    // NDJSON rather than plain text: the plain formatter prints nothing until
    // the run is over, and a long answer can take minutes. The deltas are what
    // let the dialog show the answer being written.
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages'
  ]

  if (agent) {
    // Appended rather than replacing: the CLI's own system prompt is what
    // teaches it to use the tools it has just been handed, and a run that
    // overrides it gets an agent that reasons about files it never opens.
    args.push('--append-system-prompt', systemPrompt(request.mode))
    args.push('--allowed-tools', agentTools(request.tools ?? { write: false, web: false, shell: false }))
    // File tools are rooted at the working directory, which is the vault, so
    // the permission mode grants edits *there* and nowhere else. Without it
    // every write would stop at a prompt no headless run can answer.
    if (request.tools?.write) args.push('--permission-mode', 'acceptEdits')
    if (request.sessionId) args.push('--resume', request.sessionId)
  } else {
    args.push('--system-prompt', systemPrompt(request.mode))
    args.push('--disallowed-tools', NO_TOOLS)
    // One-shot: nothing to resume, so nothing worth writing to the session log.
    args.push('--no-session-persistence')
  }

  // The CLI may well be an npm script whose `#!/usr/bin/env node` needs `node`
  // on the PATH of whatever spawned it, which the app's own PATH has not got.
  const env = await spawnEnv()

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: request.cwd ?? os.homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })
    const job: Job = { child, cancelled: false }
    running.set(request.id, job)

    let err = ''
    let settled = false

    /** Text assembled from the deltas, and the final answer once it lands. */
    let streamed = ''
    let final: string | null = null
    let failure: string | null = null
    /** The CLI's id for this session, from whichever message mentions it first. */
    let sessionId: string | null = request.sessionId ?? null
    /** Tool calls already announced, so a re-sent block is not shown twice. */
    const announced = new Set<string>()
    // stdout is a stream of newline-delimited JSON, and a chunk boundary lands
    // mid-object often enough to matter: keep the tail until its newline shows.
    let pending = ''

    const readLine = (line: string): void => {
      if (!line.trim()) return
      let message: StreamMessage
      try {
        message = JSON.parse(line) as StreamMessage
      } catch {
        // Anything the CLI prints that is not a message — a warning, a banner —
        // is not worth failing a run over.
        return
      }

      if (typeof message.session_id === 'string' && message.session_id) {
        sessionId = message.session_id
      }

      if (message.type === 'stream_event') {
        const event = message.event
        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          typeof event.delta.text === 'string' &&
          // A subagent's narration would interleave with the answer being
          // written, so only the top-level assistant's deltas are shown.
          !message.parent_tool_use_id
        ) {
          streamed += event.delta.text
          request.onChunk(streamed)
        }
        return
      }

      // Tool calls, for the line under the prompt that says what it is doing.
      // Taken from the assembled `assistant` message rather than the partial
      // deltas: the input of a tool call arrives as a JSON string in pieces,
      // and half-parsed arguments are worse than none.
      if (message.type === 'assistant' && request.onActivity) {
        for (const block of message.message?.content ?? []) {
          if (block.type !== 'tool_use' || !block.name) continue
          const detail = activityDetail(block.input, request.cwd)
          const key = `${block.name}:${detail}`
          if (announced.has(key)) continue
          announced.add(key)
          request.onActivity({ tool: block.name, detail })
        }
        return
      }

      if (message.type === 'result') {
        if (message.is_error) failure = message.result || 'Claude reported an error.'
        else if (typeof message.result === 'string') final = message.result
      }
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(request.id)
      fn()
    }

    const limit = agent ? AGENT_TIMEOUT_MS : TIMEOUT_MS
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      const minutes = Math.round(limit / 60_000)
      finish(() =>
        reject(new Error(`Claude ran for over ${minutes} minutes and was stopped.`))
      )
    }, limit)

    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) readLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })

    child.on('error', (error) => finish(() => reject(error)))

    child.on('close', (code, signal) => {
      finish(() => {
        // The stop button, not a failure — and nothing worth reporting, since
        // the person who pressed it already knows.
        if (job.cancelled || signal === 'SIGTERM') {
          reject(new Error('cancelled'))
          return
        }
        readLine(pending)
        if (failure) {
          reject(new Error(failure))
          return
        }
        if (code !== 0) {
          reject(new Error(err.trim() || `Claude exited with code ${code ?? 'unknown'}.`))
          return
        }
        // The result message is authoritative; the deltas are the fallback for
        // a run that ended without one.
        const text = tidy(final ?? streamed, request.mode)
        if (!text) reject(new Error('Claude returned nothing.'))
        else resolve({ text, sessionId: agent ? sessionId : null })
      })
    })

    // The prompt goes over stdin rather than argv: a long selection pasted in
    // as context can run past the platform's argument limit.
    child.stdin.end(input)
  })
}

/**
 * Make the reply safe to paste.
 *
 * The system prompts ask for a bare block and it usually arrives that way, but
 * "usually" is not a thing to build an editor insertion on. A whole reply
 * wrapped in ```markdown is unwrapped, and a drawing or a diagram that came
 * back as bare source gets its fence put back on so the editor renders it
 * rather than showing the user a wall of SVG.
 *
 * What it no longer does is cut the reply down to one block. The richer modes
 * are allowed a program and its test, or a structure and a sequence, and
 * truncating those to the first fence threw away the half that explained it.
 */
export function tidy(raw: string, mode: ClaudeMode): string {
  let text = raw.trim()

  const wrapper = /^```(?:markdown|md)\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (wrapper) text = wrapper[1].trim()

  // Bare source, no fence anywhere: infer the one the mode asked for.
  if (!/^```/m.test(text)) {
    if (mode === 'drawing' && /^<(\?xml|svg)\b/i.test(text)) return fence('svg', text)
    if (mode === 'diagram') return fence('mermaid', text)
  }
  return text
}

function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

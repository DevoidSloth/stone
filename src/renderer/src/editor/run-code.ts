import { Facet, type EditorState, type Range, type Text } from '@codemirror/state'
import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import { languageFor, type CodeLanguage } from '@shared/code-langs'
import { kernelFor, notebookMode } from '@shared/code-kernels'
import type { CodeRunResult, CodeSessionInfo } from '@shared/types'
import { describeError } from '../lib/errors'
import { useStone } from '../store'

/**
 * Running a fenced code block from inside the note.
 *
 * The output is deliberately *not* written back into the document. A note is a
 * file on disk that the user owns; a run is a transient thing they did to it,
 * and turning every run into an edit would mean a diff, a save, and a merge
 * conflict on every machine the vault syncs to. So results live here, in a
 * module-level map keyed by note and by which runnable block it is, and they
 * survive the widget being torn down and rebuilt on every keystroke — which is
 * what makes it possible to edit a block while it is still running.
 *
 * A note is a notebook by default, which is to say its blocks run into one
 * session per language and go on from one another: what the second block
 * declares, the fifth can use, without the second being run again. Main owns
 * the session and the counting; what is kept here is what the note has to
 * *show* for it — the `[3]` beside a block, and whether the block has been
 * edited since the session last saw it, which is the one thing a notebook can
 * be quietly wrong about.
 */

/** The note the editor is showing, for the run's working directory and key. */
export const notePathFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? ''
})

export interface RunChunk {
  stream: 'out' | 'err'
  text: string
}

export interface RunState {
  /**
   * `consent` is the one-time "this really does run programs" question.
   * `queued` is waiting for an earlier block in the same session, `starting`
   * is the session process coming up — a second, for a JVM.
   */
  status: 'idle' | 'consent' | 'queued' | 'starting' | 'running' | 'done'
  chunks: RunChunk[]
  /** The id main knows this run by, while it is running. */
  runId: string | null
  result: CodeRunResult | null
  /** A run that never started — no runner, no shell. */
  error: string | null
  /** What the consent panel will run once it is answered. */
  pending: RunRequest | null
  /**
   * The text that was actually run. A block edited since then has a result
   * that no longer describes it, and in a session that matters more than it
   * does anywhere else: the session still holds what the *old* text declared.
   */
  ranCode: string | null
  /** Which session this run belonged to, so its count can be retired with it. */
  notePath: string | null
  langId: string | null
  /**
   * What the block was last asked for. A diagram runs the same code through the
   * same consent and reports into the same bar, but it produces a figure in the
   * note rather than output under it, so the bar has to know which it is.
   */
  kind: RunKind
  /** A word about what a diagram did, where a run would have printed something. */
  message: string | null
}

export type RunKind = 'run' | 'diagram'

interface RunRequest {
  lang: string
  /** The language's id, which is what a session is keyed by. */
  langId: string
  code: string
  notePath: string
  /** Whether to ask for the note's shared session. */
  session: boolean
  kind: RunKind
  /**
   * The blocks a diagram has to run before this one, in the order they appear.
   *
   * A run joins the note's session and so already has whatever the blocks above
   * it declared; a diagram cannot — it needs a JShell of its own, built through
   * the API so the dumper can hold the objects rather than describe them. So
   * the blocks above are handed over and re-run in front of it, which is what
   * makes a block that only says `Board b = new CBoard(4);` drawable.
   *
   * Empty for a run, and for a note that is not a notebook: there, a block that
   * shares nothing with its neighbours should not be given their declarations.
   */
  prelude?: string[]
}

const IDLE: RunState = {
  status: 'idle',
  chunks: [],
  runId: null,
  result: null,
  error: null,
  pending: null,
  ranCode: null,
  notePath: null,
  langId: null,
  kind: 'run',
  message: null
}

/** Notes a user opens in one sitting; the oldest results are dropped first. */
const MAX_KEPT = 60

const runs = new Map<string, RunState>()
const listeners = new Map<string, Set<() => void>>()
const keyOfRun = new Map<string, string>()

let seq = 0
let subscribed = false

export function runState(key: string): RunState {
  return runs.get(key) ?? IDLE
}

export function subscribeRun(key: string, fn: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(fn)
  listeners.set(key, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(key)
  }
}

function emit(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn()
}

function patch(key: string, next: Partial<RunState>): void {
  const state = { ...runState(key), ...next }
  runs.delete(key)
  runs.set(key, state)
  emit(key)

  if (runs.size > MAX_KEPT) {
    for (const [oldest, value] of runs) {
      if (value.status === 'running' || value.status === 'queued') continue
      runs.delete(oldest)
      break
    }
  }
}

// ------------------------------------------------------------------ sessions

/**
 * The sessions main has open, so a block can say which one it belongs to and
 * offer to throw it away. Kept as a plain list rather than in the store: it
 * changes on every block run, and nothing outside this file wants it.
 */
let sessions: CodeSessionInfo[] = []
const sessionListeners = new Set<() => void>()

export function subscribeSessions(fn: () => void): () => void {
  sessionListeners.add(fn)
  return () => sessionListeners.delete(fn)
}

/** The live session for a note's language, or null when none is running. */
export function sessionFor(notePath: string, langId: string): CodeSessionInfo | null {
  return sessions.find((s) => s.notePath === notePath && s.langId === langId) ?? null
}

export function restartSession(notePath: string, langId: string | null): void {
  void window.stone.code.restartSession(notePath, langId)
}

/**
 * Takes the new list of sessions, and retires the run numbers of any that have
 * gone.
 *
 * The number beside a block is its place in a session's history, so when the
 * session is thrown away the number stops describing anything — a block still
 * offering `[2]` next to a jshell that has never seen it is exactly the kind of
 * quiet wrongness a notebook has to avoid. The output stays; only the claim
 * that the session ran it goes.
 */
function setSessions(next: CodeSessionInfo[]): void {
  const gone = sessions.filter(
    (was) => !next.some((now) => now.notePath === was.notePath && now.langId === was.langId)
  )
  sessions = next

  // Snapshotted first: `patch` re-inserts the entry it touches, which would
  // otherwise move it to the end of the map and have the loop meet it again.
  for (const session of gone) {
    for (const [key, state] of [...runs]) {
      if (state.notePath !== session.notePath || state.langId !== session.langId) continue
      if (state.result?.count == null) continue
      patch(key, { result: { ...state.result, count: null } })
    }
  }

  for (const fn of sessionListeners) fn()
}

/**
 * Output arrives from main as it is printed, addressed by run id. One listener
 * for the whole renderer, installed on the first run rather than at import, so
 * a vault with no code in it never registers it.
 */
function listen(): void {
  if (subscribed) return
  subscribed = true

  window.stone.code.onChunk(({ id, stream, text }) => {
    const key = keyOfRun.get(id)
    if (!key) return
    const state = runState(key)
    const chunks = state.chunks.slice()
    const last = chunks[chunks.length - 1]
    // Consecutive writes to the same stream are one run of text: the pane
    // renders a span per chunk, and a chatty program would otherwise build
    // thousands of them.
    if (last && last.stream === stream) chunks[chunks.length - 1] = { stream, text: last.text + text }
    else chunks.push({ stream, text })
    patch(key, { chunks })
  })

  // Where a run has got to before it has anything to print — queued behind an
  // earlier block, or waiting on a JVM. Without this a Java block looks frozen
  // for the second its session takes to come up.
  window.stone.code.onPhase(({ id, phase }) => {
    const key = keyOfRun.get(id)
    if (!key) return
    if (runState(key).runId === id) patch(key, { status: phase })
  })

  window.stone.code.onSessions(setSessions)
  void window.stone.code.sessions().then(setSessions)
}

async function launch(key: string, request: RunRequest): Promise<void> {
  if (request.kind === 'diagram') return await drawObjects(key, request)
  listen()
  const id = `run-${++seq}-${Date.now()}`
  keyOfRun.set(id, key)
  patch(key, {
    status: request.session ? 'queued' : 'running',
    chunks: [],
    runId: id,
    result: null,
    error: null,
    pending: null,
    ranCode: request.code,
    notePath: request.notePath,
    langId: request.langId,
    kind: 'run',
    message: null
  })

  try {
    const result = await window.stone.code.run({
      id,
      lang: request.lang,
      code: request.code,
      notePath: request.notePath || null,
      session: request.session
    })
    if (runState(key).runId === id) patch(key, { status: 'done', result, runId: null })
  } catch (err) {
    if (runState(key).runId === id) {
      patch(key, { status: 'done', error: (err as Error).message, runId: null })
    }
  } finally {
    keyOfRun.delete(id)
  }
}

/**
 * Start a run, or ask first.
 *
 * The question is asked once per machine and then remembered. It is worth
 * asking at all because a note is not always something the user wrote: the web
 * clipper files pages from the internet into the vault, and a fenced block in
 * one of those is a program by a stranger.
 */
export function startRun(key: string, request: RunRequest): void {
  const status = runState(key).status
  if (status === 'running' || status === 'queued' || status === 'starting') return
  if (useStone.getState().settings?.codeRunConfirmed) {
    void launch(key, request)
    return
  }
  patch(key, { status: 'consent', pending: request, chunks: [], result: null, error: null })
}

export function confirmRun(key: string): void {
  const pending = runState(key).pending
  if (!pending) return
  void useStone.getState().updateSettings({ codeRunConfirmed: true })
  void launch(key, pending)
}

export function dismissRun(key: string): void {
  diagramTargets.delete(key)
  patch(key, { status: 'idle', pending: null })
}

export function stopRun(key: string): void {
  const id = runState(key).runId
  if (id) void window.stone.code.cancel(id)
}

export function clearRun(key: string): void {
  runs.delete(key)
  emit(key)
}

/*
 * ------------------------------------------------------------- java objects
 *
 * Drawing what a Java block leaves in memory.
 *
 * The figure is not inferred from the source: main compiles the block, runs it
 * in a jshell session, and walks the objects that are really there — so two
 * variables that turned out to be one object come out as one box with two
 * arrows into it. What comes back is `boxes` source, the same fence a person
 * would have typed.
 *
 * Unlike a run, the result *is* written into the note. A run is something you
 * did to the file and a figure is part of it: it renders in the note, prints
 * with it, and survives being opened in another editor.
 */

/**
 * What marks a `boxes` block as this button's work, so the next press replaces
 * it rather than stacking a second figure under the first. `readSource` drops
 * `#` lines, so it costs the drawing nothing — and a figure the user has moved
 * or rewritten is no longer marked, and is left alone.
 */
const DIAGRAM_MARK = '# drawn from the Java block above'

/** Where a diagram should go, and what it belongs to, while the block runs. */
interface DiagramTarget {
  fence: RunnableFence
  view: EditorView
}

const diagramTargets = new Map<string, DiagramTarget>()

/**
 * The blocks a diagram has to stand on: the note's earlier blocks in the same
 * language, in the order they appear.
 *
 * A note that declares its types in one block and uses them in the next is the
 * ordinary shape of a lecture note, and it is the shape a session was built
 * for. The drawer has no session, so it is given the text instead. Only in a
 * notebook — where blocks are meant to go on from one another — and only the
 * same language, since that is what a session is keyed by.
 */
function preludeFor(fence: RunnableFence, view: EditorView): string[] {
  if (!notebookDoc(view.state.doc)) return []
  return runnableFences(view.state.doc)
    .filter((f) => f.index < fence.index && f.language.id === fence.language.id)
    .map((f) => f.code)
}

export function startDiagram(
  key: string,
  fence: RunnableFence,
  notePath: string,
  view: EditorView
): void {
  diagramTargets.set(key, { fence, view })
  startRun(key, {
    lang: fence.info,
    langId: fence.language.id,
    code: fence.code,
    notePath,
    session: false,
    kind: 'diagram',
    prelude: preludeFor(fence, view)
  })
}

async function drawObjects(key: string, request: RunRequest): Promise<void> {
  patch(key, {
    status: 'running',
    kind: 'diagram',
    chunks: [],
    runId: null,
    result: null,
    error: null,
    message: null,
    pending: null,
    ranCode: request.code,
    notePath: request.notePath,
    langId: request.langId
  })

  try {
    const source = await window.stone.code.javaObjects({
      code: request.code,
      prelude: request.prelude ?? [],
      notePath: request.notePath || null
    })
    patch(key, { status: 'done', message: writeDiagram(key, source) })
  } catch (err) {
    patch(key, { status: 'done', error: describeError(err) })
  }
}

/**
 * Put the figure under its block, and say what happened.
 *
 * The block is found again rather than trusted: running it took a second or two
 * and the note is live the whole time, so the line numbers taken when the
 * button was pressed may well have moved. Matching on the text is what makes an
 * edit *elsewhere* in the note harmless, and an edit to this block honest — a
 * figure of what the code used to be would be worse than none.
 */
function writeDiagram(key: string, source: string): string {
  const target = diagramTargets.get(key)
  diagramTargets.delete(key)
  if (!target || !target.view.dom.isConnected) {
    return 'Drawn, but the note had closed. Press Diagram again.'
  }

  const view = target.view
  const fences = runnableFences(view.state.doc)
  const same = fences[target.fence.index]
  const fence =
    same && same.code === target.fence.code
      ? same
      : fences.find((one) => one.code === target.fence.code)
  if (!fence) return 'The block changed while it was running, so the figure was not written.'

  const block = `\`\`\`boxes\n${DIAGRAM_MARK}\n${source.trim()}\n\`\`\``
  const range = diagramRange(view.state.doc, fence.endLine)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: range.replacing ? block : `\n\n${block}` }
  })
  return range.replacing ? 'Figure redrawn below.' : 'Figure drawn below.'
}

/**
 * The span the figure occupies: the one this block drew last time, or the empty
 * point just after it.
 *
 * Only a `boxes` block carrying the marker is replaced. A figure the user wrote
 * themselves, or moved, is theirs — the second press writes a new one rather
 * than overwriting work Stone did not do.
 */
function diagramRange(doc: Text, endLine: number): { from: number; to: number; replacing: boolean } {
  let n = endLine + 1
  while (n <= doc.lines && doc.line(n).text.trim() === '') n++

  if (
    n < doc.lines &&
    /^\s*```\s*boxes\s*$/.test(doc.line(n).text) &&
    doc.line(n + 1).text.trim() === DIAGRAM_MARK
  ) {
    for (let close = n + 1; close <= doc.lines; close++) {
      if (/^\s*```\s*$/.test(doc.line(close).text)) {
        return { from: doc.line(n).from, to: doc.line(close).to, replacing: true }
      }
    }
  }

  const end = doc.line(endLine).to
  return { from: end, to: end, replacing: false }
}

// ------------------------------------------------------------ finding blocks

export interface RunnableFence {
  /** Which runnable block this is in the note, counting from the top. */
  index: number
  info: string
  language: CodeLanguage
  code: string
  startLine: number
  endLine: number
}

function overrides(): Record<string, string> {
  return useStone.getState().settings?.codeRunners ?? {}
}

/**
 * Whether this note's blocks share a session.
 *
 * The vault's setting, unless the note's frontmatter says otherwise — a page of
 * unrelated snippets can keep every block to itself with `notebook: false`, and
 * one note can be a notebook in a vault where the setting is off. Read off the
 * head of the document rather than through the parser: this is asked on every
 * redraw, and the answer is always in the first few lines.
 */
export function notebookDoc(doc: Text): boolean {
  const setting = useStone.getState().settings?.codeNotebook ?? true
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return setting

  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    const text = doc.line(n).text
    if (text.trim() === '---') break
    const key = /^\s*notebook\s*:\s*(.*)$/i.exec(text)
    if (key) return notebookMode(setting, key[1].trim().replace(/^['"]|['"]$/g, ''))
  }
  return setting
}

/**
 * Every closed fence in the note whose language Stone can run.
 *
 * Fences are scanned from the top rather than from the viewport for the same
 * reason the live-preview scan is: a block half-scrolled off the screen is
 * still the same block, and the index it gets is what its output is filed
 * under. An unclosed fence at the end of the document is someone still typing,
 * and is not offered a button.
 */
export function runnableFences(doc: Text): RunnableFence[] {
  const table = overrides()
  const found: RunnableFence[] = []
  let open = false
  let start = 0
  let info = ''

  for (let n = 1; n <= doc.lines; n++) {
    const fence = /^\s*(```|~~~)\s*(.*)$/.exec(doc.line(n).text)
    if (!fence) continue
    if (!open) {
      open = true
      start = n
      info = (fence[2] ?? '').trim()
      continue
    }

    open = false
    const language = languageFor(info, table)
    if (!language) continue
    const code: string[] = []
    for (let i = start + 1; i < n; i++) code.push(doc.line(i).text)
    found.push({
      index: found.length,
      info,
      language,
      code: code.join('\n'),
      startLine: start,
      endLine: n
    })
  }

  return found
}

export function fenceKey(notePath: string, fence: RunnableFence): string {
  return `${notePath}#${fence.index}`
}

function requestFor(fence: RunnableFence, notePath: string, notebook: boolean): RunRequest {
  return {
    lang: fence.info,
    langId: fence.language.id,
    code: fence.code,
    notePath,
    // Main has the last word — it knows whether this particular block can join
    // a session — but there is no point asking for one the language has none of.
    session: notebook && kernelFor(fence.language.id) !== null,
    kind: 'run'
  }
}

/** ⇧⌘⏎ in a block: run the one the caret is in. */
export function runFenceAtCursor(view: EditorView): boolean {
  const notePath = view.state.facet(notePathFacet)
  const line = view.state.doc.lineAt(view.state.selection.main.head).number
  const fence = runnableFences(view.state.doc).find((f) => line >= f.startLine && line <= f.endLine)
  if (!fence) return false

  const key = fenceKey(notePath, fence)
  const state = runState(key).status
  if (state === 'running' || state === 'queued' || state === 'starting') stopRun(key)
  else startRun(key, requestFor(fence, notePath, notebookDoc(view.state.doc)))
  return true
}

/**
 * Run a run of blocks, in the order they appear in the note.
 *
 * This is the other half of what a notebook is for: a note reopened tomorrow
 * has a session that no longer exists, and "run everything down to here" is
 * how it is brought back. They are fired together rather than awaited one by
 * one — main queues a session's blocks and runs them in order, which is the
 * same thing and leaves every block's Stop button working while it waits.
 */
export function runFences(view: EditorView, scope: 'all' | 'above'): number {
  const notePath = view.state.facet(notePathFacet)
  const notebook = notebookDoc(view.state.doc)
  const line = view.state.doc.lineAt(view.state.selection.main.head).number
  const fences = runnableFences(view.state.doc).filter(
    (fence) => scope === 'all' || fence.endLine <= line
  )
  if (fences.length === 0) return 0

  // The consent question is about running code at all, not about this block, so
  // it is asked once and the rest wait for the answer rather than stacking up
  // five copies of the same panel.
  if (!useStone.getState().settings?.codeRunConfirmed) {
    const first = fences[0]
    startRun(fenceKey(notePath, first), requestFor(first, notePath, notebook))
    return 1
  }

  for (const fence of fences) {
    startRun(fenceKey(notePath, fence), requestFor(fence, notePath, notebook))
  }
  return fences.length
}

/** The languages a note has live sessions for, for the restart command. */
export function noteSessions(notePath: string): CodeSessionInfo[] {
  return sessions.filter((session) => session.notePath === notePath)
}

// ------------------------------------------------------------------- widget

function button(
  label: string,
  cls: string,
  onClick: () => void,
  title?: string,
  disabled = false
): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = cls
  el.textContent = label
  el.disabled = disabled
  if (title) el.title = title
  // Without this the editor takes the mousedown, moves the caret into the
  // block and re-renders the widget out from under the click.
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return el
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The right-hand half of the bar: what happened, in a few words. */
function statusOf(state: RunState): { text: string; bad: boolean } {
  // A diagram prints nothing and leaves no exit code: everything it has to say
  // is one line, and the figure it wrote is the rest of the answer.
  if (state.kind === 'diagram') {
    if (state.status === 'running') {
      return { text: 'Running the block and drawing it…', bad: false }
    }
    if (state.error) return { text: state.error, bad: true }
    return { text: state.message ?? '', bad: false }
  }
  if (state.status === 'queued') return { text: 'Waiting for the block above…', bad: false }
  if (state.status === 'starting') return { text: 'Starting the session…', bad: false }
  if (state.status === 'running') return { text: 'Running…', bad: false }
  if (state.error) return { text: state.error, bad: true }

  const result = state.result
  if (!result) return { text: '', bad: false }
  if (result.timedOut) return { text: `Stopped at the time limit · ${duration(result.ms)}`, bad: true }
  if (result.cancelled) return { text: `Stopped · ${duration(result.ms)}`, bad: false }
  if (result.signal) return { text: `Killed by ${result.signal} · ${duration(result.ms)}`, bad: true }
  if (result.code !== 0) return { text: `Exit ${result.code} · ${duration(result.ms)}`, bad: true }
  return { text: `Done · ${duration(result.ms)}`, bad: false }
}

class RunWidget extends WidgetType {
  private unsubscribe: (() => void)[] = []

  constructor(
    readonly key: string,
    readonly fence: RunnableFence,
    readonly notePath: string,
    readonly notebook: boolean
  ) {
    super()
  }

  eq(other: RunWidget): boolean {
    return (
      other.key === this.key &&
      other.notePath === this.notePath &&
      other.notebook === this.notebook &&
      other.fence.info === this.fence.info &&
      other.fence.code === this.fence.code
    )
  }

  get estimatedHeight(): number {
    return 30
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div')
    root.className = 'cm-block cm-run'

    const bar = document.createElement('div')
    bar.className = 'cm-run__bar'
    const aside = document.createElement('div')
    aside.className = 'cm-run__note'
    const output = document.createElement('pre')
    output.className = 'cm-run__out'
    const consent = document.createElement('div')
    consent.className = 'cm-run__consent'
    root.append(bar, aside, output, consent)

    const render = (): void => {
      const state = runState(this.key)
      const busy =
        state.status === 'running' || state.status === 'queued' || state.status === 'starting'
      bar.replaceChildren()

      // A diagram is the same block running, so it holds the same button — but
      // it is not stoppable from here and pressing Run while it works would ask
      // the same code to run twice over.
      const drawing = busy && state.kind === 'diagram'
      bar.appendChild(
        button(
          busy && !drawing ? 'Stop' : 'Run',
          'cm-run__go',
          () => {
            if (busy) stopRun(this.key)
            else startRun(this.key, requestFor(this.fence, this.notePath, this.notebook))
          },
          undefined,
          drawing
        )
      )

      // Java, and only Java: the figure comes from a jshell session holding the
      // block's own objects, which no other language here can offer.
      if (this.fence.language.id === 'java') {
        bar.appendChild(
          button(
            drawing ? 'Drawing…' : 'Diagram',
            'cm-run__act cm-run__act--lead',
            () => startDiagram(this.key, this.fence, this.notePath, view),
            'Run the block and draw the objects it leaves behind as a figure under it.',
            busy
          )
        )
      }

      const lang = document.createElement('span')
      lang.className = 'cm-run__lang'
      lang.textContent = this.fence.language.label
      bar.appendChild(lang)

      // The count is the notebook's one piece of essential bookkeeping: it says
      // this block has been through the session, and in what order relative to
      // the others. A block whose text has changed since shows it struck
      // through, because the session is still holding what the old text did.
      const count = state.result?.count ?? null
      if (count !== null) {
        const chip = document.createElement('span')
        const stale = state.ranCode !== null && state.ranCode !== this.fence.code
        chip.className = stale ? 'cm-run__count cm-run__count--stale' : 'cm-run__count'
        chip.textContent = `[${count}]`
        chip.title = stale
          ? `Run ${count} in this note’s ${this.fence.language.label} session — but the block has been edited since, and the session still has what it declared before.`
          : `Run ${count} in this note’s ${this.fence.language.label} session.`
        bar.appendChild(chip)
      }

      const status = statusOf(state)
      if (status.text) {
        const el = document.createElement('span')
        el.className = status.bad ? 'cm-run__status cm-run__status--bad' : 'cm-run__status'
        el.textContent = status.text
        bar.appendChild(el)
      }

      const text = state.chunks.map((chunk) => chunk.text).join('')
      if (text) {
        bar.appendChild(
          button('Copy', 'cm-run__act', () => void navigator.clipboard.writeText(text))
        )
      }
      if (state.status === 'done') {
        bar.appendChild(button('Clear', 'cm-run__act', () => clearRun(this.key)))
      }
      // Only offered where there is something to throw away, so a note of
      // ordinary blocks never grows a button about sessions.
      if (sessionFor(this.notePath, this.fence.language.id)) {
        bar.appendChild(
          button(
            'Restart',
            'cm-run__act',
            () => restartSession(this.notePath, this.fence.language.id),
            `Throw away this note’s ${this.fence.language.label} session, so the next block starts from nothing.`
          )
        )
      }

      // Why a block did not share the session, or what Stone called on its
      // behalf. Rare, and worth a line of its own when it happens.
      const note = state.result?.note ?? null
      aside.textContent = note ?? ''
      aside.hidden = note === null

      // Only ever appended to: the last chunk is the one that grows, and
      // rebuilding the pane on every write would lose the user's scroll.
      const bottom = output.scrollHeight - output.scrollTop - output.clientHeight < 24
      while (output.childElementCount > state.chunks.length) output.lastElementChild?.remove()
      state.chunks.forEach((chunk, i) => {
        let span = output.children[i] as HTMLElement | undefined
        if (!span) {
          span = document.createElement('span')
          output.appendChild(span)
        }
        span.className = chunk.stream === 'err' ? 'cm-run__err' : 'cm-run__stdout'
        if (span.textContent !== chunk.text) span.textContent = chunk.text
      })
      output.hidden = state.chunks.length === 0
      if (bottom) output.scrollTop = output.scrollHeight

      consent.replaceChildren()
      consent.hidden = state.status !== 'consent'
      if (state.status === 'consent') {
        const words = document.createElement('p')
        words.textContent =
          'This runs the block as a program on this computer, with your permissions, in the note’s folder. Run code you trust. Stone asks once.'
        const actions = document.createElement('div')
        actions.className = 'cm-run__actions'
        actions.append(
          button('Cancel', 'cm-run__act', () => dismissRun(this.key)),
          button('Run it', 'cm-run__go', () => confirmRun(this.key))
        )
        consent.append(words, actions)
      }
    }

    render()
    this.unsubscribe.push(subscribeRun(this.key, render), subscribeSessions(render))
    return root
  }

  destroy(): void {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
  }

  ignoreEvent(): boolean {
    // The bar is buttons. Handing their clicks to the editor would move the
    // caret instead of pressing them.
    return true
  }
}

/**
 * A run bar under every runnable block.
 *
 * These are block widgets, so they have to come from the same state field the
 * rest of the block layer does — CodeMirror throws on a block decoration that
 * arrives from a view plugin, and takes the whole plugin down with it.
 */
export function runWidgetRanges(state: EditorState): Range<Decoration>[] {
  const notePath = state.facet(notePathFacet)
  const notebook = notebookDoc(state.doc)
  return runnableFences(state.doc).map((fence) =>
    Decoration.widget({
      widget: new RunWidget(fenceKey(notePath, fence), fence, notePath, notebook),
      block: true,
      side: 1
    }).range(state.doc.line(fence.endLine).to)
  )
}

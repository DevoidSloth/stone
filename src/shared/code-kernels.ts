/**
 * Sessions: the languages whose blocks can go on from one another.
 *
 * A note is a notebook when its blocks share one running process per language,
 * so the fourth block can use what the second declared without the second being
 * run again. That is the whole of the idea, and all of the difficulty is in
 * knowing when a block is *finished* — a pipe has no end, so something in the
 * session has to say so.
 *
 * Every kernel here therefore answers the same two questions: what starts the
 * process, and what a block turns into on the wire so that a marker line comes
 * back after it. Two markers, in fact, one down each stream, which is what
 * makes a block's output its own: without one on stderr, a traceback written
 * just before the block ended could arrive after the next block had started and
 * be shown under it.
 *
 * There are two shapes of kernel:
 *
 *   A *driver* is a small program written here and run by the language's own
 *   interpreter, so a user who has told Settings to run Python with `pyenv
 *   exec python` gets that interpreter for their session too. It reads blocks
 *   off its standard input, runs them against one long-lived scope, and prints
 *   the markers itself — which means it also reports whether the block threw,
 *   and can echo the value of a trailing expression the way a notebook does.
 *
 *   A *REPL* is a session the language already ships. Java is the one that
 *   matters, and jshell is genuinely good at this: it holds declarations across
 *   snippets, which is exactly the thing being asked for.
 *
 * A block that cannot join a session — a Java block with a package declaration,
 * or one whose braces do not balance — is not an error. `reject` says why, and
 * the block runs on its own through the one-shot runner instead.
 */

import { javaComplete, javaEntryCall, javaShape } from './code-langs'

/** What a block becomes before it is written to the session. */
export interface KernelCell {
  code: string
  /** Something the user should know about how it was run. */
  note: string | null
}

export interface CodeKernel {
  /** The language id, as `CODE_LANGUAGES` spells it. */
  id: string
  /**
   * A program written into the session's scratch directory and handed to the
   * language's own runner, with the nonce as its one argument.
   */
  driver?: { name: string; source: string }
  /** A session the language ships. `{nonce}` is substituted. */
  repl?: string
  replWindows?: string
  /** Written before any block; everything it prints up to the marker is dropped. */
  prologue?: (nonce: string) => string
  /** Prepares a block — Java's entry-point call is the only one that does anything. */
  prepare?: (code: string) => KernelCell
  /** The block, plus whatever makes the markers come back after it. */
  wire: (code: string, nonce: string) => string
  /**
   * Whether an interrupt stops a block without taking the session with it. A
   * driver catches it and carries on; jshell, reading from a pipe rather than a
   * terminal, does not hear it at all, so stopping a Java block means starting
   * the session over.
   */
  interruptible: boolean
  /** Which stream a line of session output belongs on, when the process is vague about it. */
  classify?: (line: string) => 'out' | 'err'
  /** Whether a block failed, for a session that reports no status of its own. */
  failed?: (text: string) => boolean
  /** Why this block cannot join the session, or null when it can. */
  reject?: (code: string) => string | null
}

// ------------------------------------------------------------------- drivers

/**
 * Python.
 *
 * `exec` against one dictionary is the whole of the state-keeping. The rest is
 * notebook manners: a block ending in a bare expression has its value printed,
 * a block that raises prints the traceback and says so without the session
 * dying, and `sys.stdin` is swapped for an empty one so that a block calling
 * `input()` gets an EOF rather than eating the next block off the pipe.
 */
const PYTHON_DRIVER = `import ast, os, sys, traceback

NONCE = sys.argv[1]
END = NONCE + ":END"
protocol = sys.stdin
sys.stdin = open(os.devnull)
scope = {"__name__": "__main__"}
buf = []
n = 0


def run(src, where):
    block = ast.parse(src)
    if block.body and isinstance(block.body[-1], ast.Expr):
        head = ast.Module(body=block.body[:-1], type_ignores=[])
        exec(compile(head, where, "exec"), scope)
        tail = ast.Expression(body=block.body[-1].value)
        value = eval(compile(tail, where, "eval"), scope)
        if value is not None:
            sys.stdout.write(repr(value) + "\\n")
    else:
        exec(compile(block, where, "exec"), scope)


for line in protocol:
    if line.rstrip("\\n") != END:
        buf.append(line)
        continue
    src = "".join(buf)
    buf = []
    n += 1
    status = "0"
    try:
        run(src, "<block " + str(n) + ">")
    except SystemExit:
        pass
    except BaseException:
        traceback.print_exc()
        status = "1"
    sys.stdout.flush()
    sys.stderr.write("\\n" + NONCE + "\\n")
    sys.stderr.flush()
    sys.stdout.write("\\n" + NONCE + " " + status + "\\n")
    sys.stdout.flush()
`

/**
 * JavaScript.
 *
 * One `vm` context is what carries state: V8 keeps a global lexical scope per
 * context, so a `const` declared by one block is still there for the next,
 * which plain `eval` in a fresh scope would not give. The completion value of
 * the block is printed when there is one, and awaited first when it is a
 * promise, so a block ending in a `fetch` shows what it fetched.
 */
const NODE_DRIVER = `import vm from 'node:vm'
import { createRequire } from 'node:module'
import { inspect } from 'node:util'

const nonce = process.argv[2]
const end = nonce + ':END'
const require = createRequire(process.cwd() + '/block.mjs')

const scope = { require, console, process, Buffer, URL, TextEncoder, TextDecoder, fetch, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone }
scope.global = scope
scope.globalThis = scope
const context = vm.createContext(scope)

let buf = ''
let n = 0

async function run(src) {
  const value = vm.runInContext(src, context, { filename: '<block ' + n + '>' })
  const settled = value && typeof value.then === 'function' ? await value : value
  if (settled !== undefined) console.log(inspect(settled, { colors: false, depth: 4 }))
}

async function finish(src) {
  n += 1
  let status = '0'
  try {
    await run(src)
  } catch (err) {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\\n')
    status = '1'
  }
  process.stderr.write('\\n' + nonce + '\\n')
  process.stdout.write('\\n' + nonce + ' ' + status + '\\n')
}

// Blocks are run one at a time and in order: stdin is paused while one runs,
// so a slow block cannot have the next one start underneath it.
process.stdin.setEncoding('utf8')
let queue = Promise.resolve()
process.stdin.on('data', (chunk) => {
  buf += chunk
  let at = buf.indexOf('\\n' + end + '\\n')
  while (at !== -1) {
    const src = buf.slice(0, at)
    buf = buf.slice(at + end.length + 2)
    queue = queue.then(() => finish(src))
    at = buf.indexOf('\\n' + end + '\\n')
  }
})
`

/**
 * The shells, which need no help keeping state — a variable set by one block is
 * still set for the next, and so is the working directory — but do need their
 * blocks kept off the pipe the session is fed down. `eval` with an empty
 * standard input is what does that: without it, a block containing `cat` would
 * swallow every block after it.
 */
const SHELL_DRIVER = `NONCE="$1"
buf=""
while IFS= read -r line; do
  if [ "$line" = "$NONCE:END" ]; then
    eval "$buf" < /dev/null
    status=$?
    buf=""
    printf '\\n%s\\n' "$NONCE" >&2
    printf '\\n%s %s\\n' "$NONCE" "$status"
  else
    buf="$buf$line
"
  fi
done
`

/** The marker pair a driver's own protocol is closed with. */
function driverCell(code: string, nonce: string): string {
  // A trailing newline before the terminator, so a block whose last line has no
  // newline of its own does not run into it.
  return `${code}\n${nonce}:END\n`
}

// ---------------------------------------------------------------------- java

/**
 * What a Java block turns into for jshell.
 *
 * jshell declares what it is handed and runs what it is asked to, so a block
 * that is a whole program — a class with a `main`, which is most of a page of
 * Java notes — needs the call appending or it prints nothing at all. What is
 * appended is said out loud in the block's status line, because a `main` that
 * ran when the user did not write the call is otherwise a small mystery.
 */
function javaPrepare(code: string): KernelCell {
  const call = javaEntryCall(code)
  if (!call) return { code, note: null }
  return { code: `${code}\n${call}`, note: `Called ${call.replace(/;$/, '')}` }
}

function javaReject(code: string): string | null {
  const shape = javaShape(code)
  if (shape.packageName) {
    return `jshell has no packages, so this block ran on its own. Drop the \`package ${shape.packageName};\` line to share the note's session.`
  }
  if (!javaComplete(code)) {
    return 'The block’s brackets do not balance, so it ran on its own rather than leaving the session waiting for the rest of it.'
  }
  return null
}

export const CODE_KERNELS: CodeKernel[] = [
  {
    id: 'python',
    driver: { name: 'stone-session.py', source: PYTHON_DRIVER },
    wire: driverCell,
    interruptible: true
  },
  {
    id: 'javascript',
    driver: { name: 'stone-session.mjs', source: NODE_DRIVER },
    // The driver frames on a bare marker line, so the block needs a newline in
    // front of the terminator whether or not it ends with one.
    wire: (code, nonce) => `${code}\n${nonce}:END\n`,
    // A synchronous loop never yields, so the signal handler would never run.
    interruptible: false
  },
  {
    id: 'bash',
    driver: { name: 'stone-session.sh', source: SHELL_DRIVER },
    wire: driverCell,
    interruptible: true
  },
  {
    id: 'zsh',
    driver: { name: 'stone-session.sh', source: SHELL_DRIVER },
    wire: driverCell,
    interruptible: true
  },
  {
    id: 'java',
    // No `-` argument: given one, jshell reads standard input as a *script*,
    // and a script neither echoes the value of an expression nor accepts the
    // feedback settings below. Left off, the same pipe is a session.
    repl: 'jshell --execution local',
    /**
     * jshell's own chatter, turned off.
     *
     * A feedback mode cannot be edited in place — the four it ships are
     * read-only — so one is copied from `concise`, which shows the value of an
     * expression but stays quiet about declarations, and given an empty prompt.
     * What is left on stdout is the block's own output and, prefixed with a
     * bar, its diagnostics. `System.in` is emptied for the same reason the
     * Python driver empties it: a block that reads it would otherwise be read
     * the next block.
     */
    prologue: () =>
      [
        '/set mode stone concise -quiet',
        '/set prompt stone "" ""',
        '/set feedback stone',
        'System.setIn(java.io.InputStream.nullInputStream());'
      ].join('\n') + '\n',
    prepare: javaPrepare,
    wire: (code, nonce) =>
      [
        code,
        `System.out.print("\\n${nonce} \\n");`,
        `System.err.print("\\n${nonce}\\n");`,
        ''
      ].join('\n'),
    interruptible: false,
    // In this mode a leading bar is jshell speaking rather than the block, and
    // it only ever speaks to report a problem.
    classify: (line) => (line.startsWith('|') ? 'err' : 'out'),
    failed: (text) => /^\|\s+(Error|Exception)/m.test(text),
    reject: javaReject
  }
]

const BY_ID = new Map(CODE_KERNELS.map((kernel) => [kernel.id, kernel]))

/** The kernel for a language, or null when its blocks each run on their own. */
export function kernelFor(languageId: string): CodeKernel | null {
  return BY_ID.get(languageId) ?? null
}

/**
 * Whether a note's blocks share a session, given the vault's setting and the
 * note's own `notebook:` key. The note wins, so one page of loose snippets can
 * sit in a vault of notebooks.
 */
export function notebookMode(setting: boolean, frontmatter: string | null): boolean {
  if (frontmatter === null) return setting
  return !/^(false|no|off|0)$/i.test(frontmatter.trim())
}

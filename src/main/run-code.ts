import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { commandFor, languageFor } from '@shared/code-langs'
import type { CodeRunResult } from '@shared/types'

/**
 * Running a fenced code block.
 *
 * The block is written to a scratch file and its language's command line is
 * handed to the user's login shell, which is the only arrangement that finds
 * the interpreters a developer actually has: an app launched from the Finder
 * or the Start menu inherits a PATH with no nvm, no pyenv and no homebrew in
 * it. The shell reads their profile, so `python3` here means the `python3`
 * their terminal means.
 *
 * Nothing runs on its own. Every run starts at a button in the note, and the
 * first one asks first — a note can arrive from the web clipper, and a code
 * block in it is a program someone else wrote.
 */

/** Stops a runaway loop from filling memory; the note only shows a tail anyway. */
const MAX_OUTPUT = 400_000

/**
 * Colour codes, which would otherwise print as gibberish in a pane that is a
 * `<pre>` rather than a terminal. Built from the code point: an escape
 * character written literally into the source is invisible to anyone reading
 * this line.
 */
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

interface Job {
  child: ChildProcess
  cancelled: boolean
}

const running = new Map<string, Job>()

export interface RunCodeRequest {
  /** The renderer's id for this run, so a stop button has something to name. */
  id: string
  /** The fence's info string, as written. */
  lang: string
  code: string
  /** Where the command runs — the note's folder, so relative paths work. */
  cwd: string | null
  timeoutMs: number
  /** The user's language table from Settings, keyed by language id. */
  overrides: Record<string, string>
  /**
   * Why this block ran on its own rather than in the note's session, when the
   * note is a notebook and something about the block ruled it out.
   */
  note?: string | null
  onChunk: (stream: 'out' | 'err', text: string) => void
}

/** Quote a path for the shell that will run the line. */
export function quote(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function fill(template: string, file: string, dir: string, name: string): string {
  return template
    .replace(/\{file\}/g, quote(file))
    .replace(/\{dir\}/g, quote(dir))
    .replace(/\{name\}/g, quote(name))
}

/**
 * Kill the whole process group.
 *
 * The child is the shell, not the interpreter, so killing the child alone
 * leaves the program running with nothing left to read its output. That group
 * is why the shell is spawned detached.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group is already gone, or was never made; the child may not be.
    child.kill(signal)
  }
}

export function cancelRun(id: string): boolean {
  const job = running.get(id)
  if (!job) return false
  job.cancelled = true
  killTree(job.child, 'SIGTERM')
  // A program that traps SIGTERM, or one wedged in a syscall, gets a moment to
  // exit on its own terms before the stop button is made to mean it.
  setTimeout(() => {
    if (running.get(id) === job) killTree(job.child, 'SIGKILL')
  }, 2000)
  return true
}

/** Stop everything still running — the window is going away. */
export function cancelAllRuns(): void {
  for (const id of [...running.keys()]) cancelRun(id)
}

export async function runCode(request: RunCodeRequest): Promise<CodeRunResult> {
  const language = languageFor(request.lang, request.overrides)
  if (!language) {
    throw new Error(
      `Stone has no runner for ${request.lang.trim() || 'plain'} blocks. Add a command for it in Settings, under Code.`
    )
  }

  // Most languages need nothing said about the block beyond writing it down.
  // Java does — what the file is called is part of its program, and what runs
  // it depends on whether the block is a program at all.
  const plan = language.plan?.(request.code, process.platform)
  const command = commandFor(language, request.overrides, process.platform, plan)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stone-run-'))
  const name = plan?.name ?? 'main'
  const file = path.join(dir, `${name}.${language.ext}`)
  await writeFile(file, plan?.text ?? request.code, 'utf8')

  const line = fill(command, file, dir, name)
  const shell =
    process.platform === 'win32'
      ? (process.env.COMSPEC ?? 'cmd.exe')
      : (process.env.SHELL ?? '/bin/sh')
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', line] : ['-lc', line]

  const started = Date.now()

  try {
    return await new Promise<CodeRunResult>((resolve, reject) => {
      const child = spawn(shell, args, {
        cwd: request.cwd ?? os.homedir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group, so stop reaches the interpreter and not just
        // the shell that launched it.
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          // Line buffering off, or a Python script's prints all arrive at once
          // when it exits and the block looks frozen while it works.
          PYTHONUNBUFFERED: '1',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          TERM: 'dumb'
        }
      })

      const job: Job = { child, cancelled: false }
      running.set(request.id, job)

      let bytes = 0
      let stopped = false
      let timedOut = false
      let settled = false

      const emit = (stream: 'out' | 'err', chunk: Buffer): void => {
        if (stopped) return
        const text = chunk.toString().replace(ANSI_RE, '')
        bytes += text.length
        request.onChunk(stream, text)
        if (bytes >= MAX_OUTPUT) {
          stopped = true
          request.onChunk('err', '\nOutput stopped after 400 KB.\n')
        }
      }

      child.stdout.on('data', (chunk: Buffer) => emit('out', chunk))
      child.stderr.on('data', (chunk: Buffer) => emit('err', chunk))

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        running.delete(request.id)
        fn()
      }

      const timer = setTimeout(() => {
        timedOut = true
        killTree(child, 'SIGKILL')
      }, request.timeoutMs)

      child.on('error', (err) =>
        finish(() => reject(new Error(`${shell} could not be started: ${err.message}`)))
      )

      child.on('close', (code, signal) => {
        finish(() =>
          resolve({
            code: code ?? null,
            signal: signal ?? null,
            timedOut,
            cancelled: job.cancelled && !timedOut,
            ms: Date.now() - started,
            session: false,
            count: null,
            note: request.note ?? null
          })
        )
      })

      // Nothing is being typed at it: close stdin so a program that reads it
      // gets an EOF instead of hanging until the timeout.
      child.stdin.end()
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

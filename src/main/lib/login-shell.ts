import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * The PATH the user's terminal has.
 *
 * An app launched from the Finder or the Start menu inherits launchd's PATH,
 * which has none of the places a version manager installs to. That bites twice.
 * Once when looking for a CLI, which is why `claude.ts` and `transcribe.ts` ask
 * a login shell where their binaries are — and again after one is found, because
 * a CLI installed through npm is not a binary at all but a script starting
 * `#!/usr/bin/env node`. Spawn that with the app's own PATH and the kernel hands
 * it to `env`, which cannot find `node`, and the run dies with
 * `env: node: No such file or directory` before a line of it has run.
 *
 * So: ask the login shell for its PATH once, hand it to everything we spawn.
 */

/** One shell per process, however many spawns end up wanting the answer. */
let asked: Promise<string | null> | null = null

function ask(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    const child = spawn(shell, ['-lc', 'printf %s "$PATH"'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', () => resolve(out.trim() || null))
    // A profile that blocks on something — a prompt, a slow network mount —
    // must not take the feature down with it.
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, 4000)
  })
}

export function loginShellPath(): Promise<string | null> {
  if (!asked) asked = ask()
  return asked
}

/**
 * `process.env` with the login shell's PATH in front of our own.
 *
 * In front, because the point is to reach the version manager's `node` rather
 * than any older one on the system path; ours is kept behind it so that whatever
 * Electron added for its own reasons is still there.
 */
export async function spawnEnv(): Promise<NodeJS.ProcessEnv> {
  const fromShell = await loginShellPath()
  if (!fromShell) return process.env

  const seen = new Set<string>()
  const dirs: string[] = []
  for (const dir of [fromShell, process.env.PATH ?? '']
    .join(path.delimiter)
    .split(path.delimiter)) {
    const trimmed = dir.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    dirs.push(trimmed)
  }
  return { ...process.env, PATH: dirs.join(path.delimiter) }
}

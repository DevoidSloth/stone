import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnEnv } from './lib/login-shell'
import type { Transcript, TranscriptSegment, WhisperFlavor, WhisperStatus } from '@shared/types'

/**
 * Whisper, headless.
 *
 * The same bargain `claude.ts` makes: shell out to a binary the user already
 * has rather than ship a model or an API key. A lecture is an hour of audio and
 * an hour of audio is a gigabyte of tensor arithmetic — that belongs in
 * whisper.cpp with Metal behind it, not in a WASM build inside the renderer,
 * and certainly not uploaded somewhere.
 *
 * Four front ends are recognised because there is no one Whisper CLI. They
 * disagree about flag names and about where the output goes, so `run` speaks
 * each one's dialect; everything downstream sees `TranscriptSegment[]`.
 */

/** How each front end is invoked. `main` is whisper.cpp before it was renamed. */
const FLAVOURS: { names: string[]; flavor: WhisperFlavor }[] = [
  { names: ['whisper-cli', 'whisper-cpp', 'main'], flavor: 'whisper-cpp' },
  { names: ['mlx_whisper'], flavor: 'mlx' },
  { names: ['whisper-ctranslate2', 'faster-whisper'], flavor: 'faster' },
  { names: ['whisper'], flavor: 'openai' }
]

export function flavorOf(binary: string): WhisperFlavor {
  const base = path.basename(binary).replace(/\.(exe|cmd|bat)$/i, '')
  for (const entry of FLAVOURS) {
    if (entry.names.includes(base)) return entry.flavor
  }
  // An unrecognised name is most likely a wrapper script around whisper.cpp,
  // which is the front end people actually build from source and rename.
  return 'whisper-cpp'
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
 * Ask a login shell where the binaries are.
 *
 * Same reason as `claude.ts`: an app launched from the Finder has none of the
 * version managers or Homebrew on its PATH, so `which` from inside the app sees
 * nothing the user's terminal sees. One shell, all four names, cached.
 */
function askLoginShell(): Promise<string[]> {
  if (process.platform === 'win32') return Promise.resolve([])
  const shell = process.env.SHELL || '/bin/zsh'
  const names = FLAVOURS.flatMap((f) => f.names).join(' ')
  return new Promise((resolve) => {
    const child = spawn(shell, ['-lc', `command -v ${names}`], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => resolve([]))
    child.on('close', () =>
      resolve(
        out
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      )
    )
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve([])
    }, 4000)
  })
}

function candidates(): string[] {
  const home = os.homedir()
  const names = FLAVOURS.flatMap((f) => f.names)
  const dirs =
    process.platform === 'win32'
      ? [path.join(process.env.APPDATA ?? home, 'npm'), path.join(home, '.local', 'bin')]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          path.join(home, '.local', 'bin'),
          path.join(home, 'bin'),
          '/usr/bin'
        ]
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name + suffix)))
}

let cached: string | null = null

/**
 * Order matters. The shell's answer comes back in the order the names were
 * asked for, which is the order in `FLAVOURS` — whisper.cpp first, because on
 * an Apple Silicon Mac it is several times faster than the Python front ends
 * and is what `brew install whisper-cpp` puts there.
 */
export async function resolveBinary(override: string | null): Promise<string | null> {
  if (override) return (await isExecutable(override)) ? override : null
  if (cached && (await isExecutable(cached))) return cached

  for (const file of await askLoginShell()) {
    if (await isExecutable(file)) {
      cached = file
      return cached
    }
  }
  for (const file of candidates()) {
    if (await isExecutable(file)) {
      cached = file
      return cached
    }
  }
  return null
}

// --------------------------------------------------------------------- models

/** Where a `ggml-*.bin` tends to end up, across the ways whisper.cpp is installed. */
function modelDirs(): string[] {
  const home = os.homedir()
  return [
    process.env.WHISPER_MODEL_PATH ?? '',
    path.join(home, '.whisper-models'),
    path.join(home, '.cache', 'whisper.cpp'),
    path.join(home, '.cache', 'whisper'),
    path.join(home, 'Library', 'Application Support', 'whisper.cpp'),
    path.join(home, 'whisper.cpp', 'models'),
    path.join(home, 'Documents', 'whisper.cpp', 'models'),
    '/opt/homebrew/share/whisper-cpp/models',
    '/opt/homebrew/share/whisper-cpp',
    '/usr/local/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp',
    '/usr/share/whisper-cpp/models'
  ].filter(Boolean)
}

/**
 * Which model to reach for when the user has not said.
 *
 * Turbo first: on Apple Silicon it runs at roughly the speed of `small` and is
 * very nearly `large-v3` for accuracy, which is exactly the trade an hour of
 * lecture wants. English-only variants beat their multilingual twins at the
 * same size, so they sort ahead of them.
 */
const MODEL_RANK = [
  'large-v3-turbo',
  'small.en',
  'base.en',
  'medium.en',
  'small',
  'base',
  'large-v3',
  'medium',
  'tiny.en'
]

function rank(file: string): number {
  const name = path
    .basename(file)
    .replace(/^ggml-/, '')
    .replace(/\.bin$/, '')
  const at = MODEL_RANK.indexOf(name)
  return at === -1 ? MODEL_RANK.length : at
}

export async function listModels(): Promise<string[]> {
  const found: string[] = []
  for (const dir of modelDirs()) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      // Quantised and non-quantised alike; the `-q5_0` suffixes sort last by
      // rank, which is the right default but still leaves them selectable.
      //
      // Not everything shaped like a model is one: Homebrew ships a deliberately
      // tiny `for-tests` model that turns real speech into nonsense, and a Silero
      // VAD file sits in the same folders under the same naming scheme but is a
      // speech *detector* — whisper.cpp fails outright when handed one.
      if (!/^ggml-.*\.bin$/.test(entry)) continue
      if (/for-tests|silero|[-.]vad/i.test(entry)) continue
      found.push(path.join(dir, entry))
    }
  }
  return [...new Set(found)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export async function status(override: string | null): Promise<WhisperStatus> {
  const binary = await resolveBinary(override)
  return {
    available: Boolean(binary),
    binary,
    flavor: binary ? flavorOf(binary) : null,
    models: await listModels()
  }
}

/**
 * The model to pass, given what the user chose and which front end this is.
 *
 * whisper.cpp needs a file and will not go and find one; the Python front ends
 * take a name and download it themselves, so leaving theirs blank is fine and
 * `base.en` is a better default than whatever they would pick.
 */
async function resolveModel(flavor: WhisperFlavor, chosen: string): Promise<string> {
  const wanted = chosen.trim()
  if (flavor !== 'whisper-cpp')
    return wanted || (flavor === 'mlx' ? 'mlx-community/whisper-base.en-mlx' : 'base.en')
  if (wanted) return wanted

  const models = await listModels()
  if (models.length === 0) {
    throw new Error(
      'No Whisper model was found. Download one — `bash models/download-ggml-model.sh base.en` in a whisper.cpp checkout, or grab ggml-base.en.bin from Hugging Face — then point Settings → Audio at it.'
    )
  }
  return models[0]
}

// -------------------------------------------------------------------- parsing

/**
 * A segment line, as every front end prints it while it works.
 *
 * whisper.cpp writes `[00:00:05.000 --> 00:00:09.000]   text` and the Python
 * ones write `[00:05.000 --> 00:09.000]  text`, so the hour is optional and the
 * decimal separator is either — locale-formatted output is a real thing.
 */
const LINE_RE =
  /^\[(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\]\s*(.*)$/

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

function readSegmentLine(line: string): TranscriptSegment | null {
  const found = LINE_RE.exec(line.trim())
  if (!found) return null
  const text = found[9].trim()
  if (!text) return null
  return {
    start: seconds(found[1], found[2], found[3], found[4]),
    end: seconds(found[5], found[6], found[7], found[8]),
    text
  }
}

/** whisper.cpp's `-oj`, which nests the times two levels down. */
interface CppJson {
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[]
  result?: { language?: string }
}

/** What openai-whisper, mlx_whisper and whisper-ctranslate2 all write. */
interface PyJson {
  language?: string
  segments?: { start?: number; end?: number; text?: string }[]
}

function readJson(raw: string): { segments: TranscriptSegment[]; language: string } | null {
  let parsed: CppJson & PyJson
  try {
    parsed = JSON.parse(raw) as CppJson & PyJson
  } catch {
    return null
  }

  if (Array.isArray(parsed.transcription)) {
    const segments = parsed.transcription
      .map((entry) => ({
        // whisper.cpp reports milliseconds here; the `timestamps` sibling is a
        // pre-formatted string and parsing that back would only lose precision.
        start: (entry.offsets?.from ?? 0) / 1000,
        end: (entry.offsets?.to ?? 0) / 1000,
        text: (entry.text ?? '').trim()
      }))
      .filter((s) => s.text)
    return { segments, language: parsed.result?.language ?? '' }
  }

  if (Array.isArray(parsed.segments)) {
    const segments = parsed.segments
      .map((entry) => ({
        start: entry.start ?? 0,
        end: entry.end ?? 0,
        text: (entry.text ?? '').trim()
      }))
      .filter((s) => s.text)
    return { segments, language: parsed.language ?? '' }
  }

  return null
}

// -------------------------------------------------------------------- running

interface Job {
  child: ChildProcess
  cancelled: boolean
  /** Removed on the way out whether the run worked or not. */
  scratch: string
}

const running = new Map<string, Job>()

export function cancel(id: string): boolean {
  const job = running.get(id)
  if (!job) return false
  job.cancelled = true
  job.child.kill('SIGTERM')
  return true
}

export interface TranscribeRequest {
  id: string
  /** A 16 kHz mono WAV. Every front end accepts one and whisper.cpp accepts
   *  nothing else, so the renderer decodes to that before we are called. */
  wav: string
  /** Vault-relative path of the recording this describes. */
  audio: string
  durationSeconds: number
  binaryOverride: string | null
  model: string
  /** `auto`, or a language code to stop it guessing wrong on a quiet opening. */
  language: string
  onProgress: (segments: TranscriptSegment[], progress: number | null, stage: string) => void
}

function argsFor(
  flavor: WhisperFlavor,
  model: string,
  language: string,
  wav: string,
  outDir: string
): string[] {
  const lang = language && language !== 'auto' ? language : null

  if (flavor === 'whisper-cpp') {
    return [
      '-m',
      model,
      '-f',
      wav,
      // JSON is what gets parsed; the printed segments are only for progress.
      '-oj',
      '-of',
      path.join(outDir, 'out'),
      '-pp',
      ...(lang ? ['-l', lang] : ['-l', 'auto'])
    ]
  }

  // The three Python front ends share openai-whisper's option names.
  return [
    wav,
    '--model',
    model,
    '--output_format',
    'json',
    '--output_dir',
    outDir,
    '--verbose',
    'True',
    ...(lang ? ['--language', lang] : [])
  ]
}

/** An hour of audio on a slow machine, with room to spare. */
const TIMEOUT_MS = 45 * 60 * 1000

export async function run(request: TranscribeRequest): Promise<Transcript> {
  const binary = await resolveBinary(request.binaryOverride)
  if (!binary) {
    throw new Error(
      'No Whisper command was found. Install one — `brew install whisper-cpp` on macOS, or `pip install openai-whisper` — then check Settings → Audio.'
    )
  }

  const flavor = flavorOf(binary)
  const model = await resolveModel(flavor, request.model)
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'stone-whisper-'))
  const args = argsFor(flavor, model, request.language, request.wav, scratch)

  const segments: TranscriptSegment[] = []
  // A pip-installed `whisper` is a script with a `#!/usr/bin/env python3` line,
  // and the app's own PATH has no python on it. Spawn with the user's.
  const env = await spawnEnv()

  const transcript = await new Promise<Transcript>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })
    const job: Job = { child, cancelled: false, scratch }
    running.set(request.id, job)

    let err = ''
    let settled = false
    let pending = ''
    let stderrPending = ''

    const readLine = (line: string): void => {
      const segment = readSegmentLine(line)
      if (!segment) return
      segments.push(segment)
      const done = request.durationSeconds > 0 ? segment.end / request.durationSeconds : null
      request.onProgress(segments, done === null ? null : Math.min(0.99, done), 'Transcribing')
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(request.id)
      fn()
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() =>
        reject(new Error('Whisper ran for 45 minutes without finishing and was stopped.'))
      )
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) readLine(line)
    })

    // whisper.cpp prints its segments and its progress on stderr, not stdout.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      err += text
      stderrPending += text
      const lines = stderrPending.split('\n')
      stderrPending = lines.pop() ?? ''
      for (const line of lines) {
        readLine(line)
        const percent = /whisper_print_progress_callback:\s*progress\s*=\s*(\d+)%/.exec(line)
        if (percent) request.onProgress(segments, Number(percent[1]) / 100, 'Transcribing')
      }
    })

    child.on('error', (error) => finish(() => reject(error)))

    child.on('close', (code, signal) => {
      finish(() => {
        if (job.cancelled || signal === 'SIGTERM') {
          reject(new Error('cancelled'))
          return
        }
        readLine(pending)
        readLine(stderrPending)

        void (async () => {
          const fromFile = await readOutput(scratch)
          const final = fromFile?.segments.length ? fromFile.segments : segments
          if (final.length === 0) {
            reject(
              new Error(
                code === 0
                  ? 'Whisper produced no speech from this recording.'
                  : err.trim().split('\n').slice(-4).join('\n') ||
                      `Whisper exited with code ${code ?? 'unknown'}.`
              )
            )
            return
          }
          resolve({
            audio: request.audio,
            createdAt: new Date().toISOString(),
            language: fromFile?.language || request.language,
            engine: `${path.basename(binary)} ${path.basename(model)}`,
            durationSeconds: request.durationSeconds || final[final.length - 1].end,
            segments: final
          })
        })()
      })
    })
  }).finally(() => {
    void rm(scratch, { recursive: true, force: true })
  })

  return transcript
}

/** The one JSON file the run left behind, whichever name it chose for it. */
async function readOutput(
  dir: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed = readJson(await readFile(path.join(dir, entry), 'utf8'))
      if (parsed) return parsed
    } catch {
      // Try the next one; a front end that wrote two files wrote one good one.
    }
  }
  return null
}

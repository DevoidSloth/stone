import { systemPreferences } from 'electron'
import crypto from 'node:crypto'
import fs, { type FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Transcript } from '@shared/types'
import { assertInsideVault, ensureDir, sanitizeFilename, toRelPath } from './vault/fs'

/**
 * Recordings on disk, and the transcripts that describe them.
 *
 * Two things live here that look alike and are not. A *recording sink* is the
 * WebM the renderer's MediaRecorder produces, appended a chunk at a time and
 * kept in the vault; a *PCM sink* is the throwaway 16 kHz WAV that Whisper is
 * actually fed. Both stream rather than arriving as one buffer, because an
 * hour-long lecture is not a thing to hold in memory twice — once in the
 * renderer and once more crossing IPC — and because a recording that survives
 * a crash is worth more than one that is tidy.
 */

// ----------------------------------------------------------------- recording

interface Sink {
  handle: FileHandle
  absPath: string
  bytes: number
}

const recordings = new Map<string, Sink>()

/**
 * Open a file for a recording about to start.
 *
 * Named for the moment rather than the note: a recording is a thing that
 * happened at a time, it outlives whichever note it was started from, and two
 * notes can both point at it.
 */
export async function startRecording(
  vaultPath: string,
  folder: string,
  label: string
): Promise<{ id: string; relPath: string }> {
  const dir = path.join(vaultPath, ...folder.split('/').filter(Boolean))
  assertInsideVault(vaultPath, dir)
  await ensureDir(dir)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const base = sanitizeFilename(label) || 'Recording'
  let absPath = path.join(dir, `${base} ${stamp}.webm`)
  let n = 2
  while (await exists(absPath)) {
    absPath = path.join(dir, `${base} ${stamp} ${n}.webm`)
    n++
  }

  const handle = await fs.open(absPath, 'w')
  const id = crypto.randomUUID()
  recordings.set(id, { handle, absPath, bytes: 0 })
  return { id, relPath: toRelPath(vaultPath, absPath) }
}

export async function appendRecording(id: string, chunk: Uint8Array): Promise<number> {
  const sink = recordings.get(id)
  if (!sink) throw new Error('That recording is no longer open.')
  await sink.handle.write(chunk)
  sink.bytes += chunk.byteLength
  return sink.bytes
}

export async function finishRecording(
  vaultPath: string,
  id: string
): Promise<{ relPath: string; bytes: number }> {
  const sink = recordings.get(id)
  if (!sink) throw new Error('That recording is no longer open.')
  recordings.delete(id)
  // Flushed before the handle goes, so the file is complete the moment the
  // renderer is told it is and a transcribe can start reading it immediately.
  await sink.handle.sync().catch(() => undefined)
  await sink.handle.close()
  return { relPath: toRelPath(vaultPath, sink.absPath), bytes: sink.bytes }
}

/** Stop and delete — the discard button, and the cleanup path on a crash. */
export async function cancelRecording(id: string): Promise<boolean> {
  const sink = recordings.get(id)
  if (!sink) return false
  recordings.delete(id)
  await sink.handle.close().catch(() => undefined)
  await fs.rm(sink.absPath, { force: true })
  return true
}

/** Close every open sink cleanly on quit, keeping whatever was captured. */
export async function closeAllRecordings(): Promise<void> {
  for (const [id, sink] of recordings) {
    recordings.delete(id)
    await sink.handle.close().catch(() => undefined)
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

// ----------------------------------------------------------------- wav sinks

const SAMPLE_RATE = 16_000
const HEADER_BYTES = 44

interface PcmSink {
  handle: FileHandle
  absPath: string
  samples: number
}

const pcm = new Map<string, PcmSink>()

/**
 * A RIFF header for mono 16-bit PCM.
 *
 * Written twice: once with zeroed lengths to reserve the space, and once more
 * over the top when the sample count is finally known. The alternative is
 * buffering the whole decode to count first, which is the thing this exists to
 * avoid.
 */
function wavHeader(samples: number): Buffer {
  const dataBytes = samples * 2
  const buffer = Buffer.alloc(HEADER_BYTES)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20) // format: PCM
  buffer.writeUInt16LE(1, 22) // channels
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

export async function openPcm(id: string): Promise<string> {
  await closePcm(id).catch(() => undefined)
  const dir = path.join(os.tmpdir(), 'stone-audio')
  await ensureDir(dir)
  const absPath = path.join(dir, `${id}.wav`)
  const handle = await fs.open(absPath, 'w')
  await handle.write(wavHeader(0))
  pcm.set(id, { handle, absPath, samples: 0 })
  return absPath
}

/** `chunk` is little-endian signed 16-bit mono at 16 kHz — nothing else. */
export async function writePcm(id: string, chunk: Uint8Array): Promise<void> {
  const sink = pcm.get(id)
  if (!sink) throw new Error('That decode is no longer open.')
  await sink.handle.write(chunk)
  sink.samples += chunk.byteLength / 2
}

export async function closePcm(id: string): Promise<string | null> {
  const sink = pcm.get(id)
  if (!sink) return null
  pcm.delete(id)
  await sink.handle.write(wavHeader(sink.samples), 0, HEADER_BYTES, 0)
  await sink.handle.close()
  return sink.absPath
}

export async function discardPcm(id: string): Promise<void> {
  const sink = pcm.get(id)
  if (sink) {
    pcm.delete(id)
    await sink.handle.close().catch(() => undefined)
  }
  await fs.rm(path.join(os.tmpdir(), 'stone-audio', `${id}.wav`), { force: true })
}

// --------------------------------------------------------------- transcripts

/**
 * Transcripts live beside the snapshots, under `.stone`, keyed by the hash of
 * the recording's path.
 *
 * In the vault rather than in `userData` so a transcript travels with the notes
 * it belongs to — a vault in iCloud opened on the other machine should not have
 * to transcribe the lecture a second time. Under a dot-folder rather than next
 * to the audio because the attachments folder is somewhere people look, and a
 * JSON file per recording sitting in it is clutter they did not ask for.
 */
function transcriptDir(vaultPath: string): string {
  return path.join(vaultPath, '.stone', 'transcripts')
}

function transcriptKey(audioRelPath: string): string {
  return crypto.createHash('sha1').update(audioRelPath).digest('hex').slice(0, 16)
}

function transcriptFile(vaultPath: string, audioRelPath: string): string {
  return path.join(transcriptDir(vaultPath), `${transcriptKey(audioRelPath)}.json`)
}

export async function readTranscript(
  vaultPath: string,
  audioRelPath: string
): Promise<Transcript | null> {
  try {
    const raw = await fs.readFile(transcriptFile(vaultPath, audioRelPath), 'utf8')
    const parsed = JSON.parse(raw) as Transcript
    return Array.isArray(parsed.segments) ? parsed : null
  } catch {
    return null
  }
}

export async function writeTranscript(
  vaultPath: string,
  transcript: Transcript
): Promise<void> {
  const file = transcriptFile(vaultPath, transcript.audio)
  await ensureDir(path.dirname(file))
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(transcript, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function deleteTranscript(vaultPath: string, audioRelPath: string): Promise<void> {
  await fs.rm(transcriptFile(vaultPath, audioRelPath), { force: true })
}

/**
 * Every transcript in the vault, newest first.
 *
 * Read rather than indexed: a person accumulates lectures at the rate of a few
 * a week, and a watcher plus a cache for a list this size would be machinery
 * with nothing to do.
 */
export async function listTranscripts(vaultPath: string): Promise<Transcript[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(transcriptDir(vaultPath))
  } catch {
    return []
  }
  const out: Transcript[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(transcriptDir(vaultPath), entry), 'utf8')
      ) as Transcript
      if (Array.isArray(parsed.segments)) out.push(parsed)
    } catch {
      // A half-written file from a kill mid-save; the next run replaces it.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Ask macOS for the microphone, returning what it decided.
 *
 * Called the first time someone presses record, not at startup: a note-taking
 * app that asks for the microphone before it has been used has explained
 * nothing about why. A denial is permanent until it is changed in System
 * Settings, so it is reported back rather than asked for again.
 */
export async function askForMicrophone(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const state = systemPreferences.getMediaAccessStatus('microphone')
  if (state === 'granted') return true
  if (state === 'denied' || state === 'restricted') return false
  return systemPreferences.askForMediaAccess('microphone')
}

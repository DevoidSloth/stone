/**
 * The microphone, streamed to disk.
 *
 * MediaRecorder hands over a chunk every few seconds and every chunk goes
 * straight through to main, which appends it to a file in the vault. Nothing
 * is accumulated here: an hour of lecture held in a renderer array is an hour
 * of lecture lost to a reload, a crash, or a closed lid, and the one thing a
 * recording must not do is fail at the end.
 *
 * A module singleton rather than store state, for the same reason the active
 * editor is one — a MediaStream is not a value, and there is only ever one
 * microphone.
 */

/** Opus at speech bitrate. An hour is about fifteen megabytes. */
const BITS_PER_SECOND = 32_000

/** Long enough that the IPC is idle most of the time; short enough to lose
 *  almost nothing to a hard kill. */
const CHUNK_MS = 5_000

interface Active {
  id: string
  relPath: string
  stream: MediaStream
  recorder: MediaRecorder
  context: AudioContext
  analyser: AnalyserNode
  levels: Uint8Array<ArrayBuffer>
  /** Writes are chained so chunks reach the file in the order they were made. */
  queue: Promise<unknown>
  failed: Error | null
}

let active: Active | null = null

export function isRecording(): boolean {
  return active !== null
}

/** Which of the WebM/Opus spellings this Chromium admits to supporting. */
function mimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export interface Started {
  id: string
  relPath: string
}

export async function start(label: string): Promise<Started> {
  if (active) throw new Error('Something is already recording.')

  // macOS will not even show the prompt until the app asks through its own
  // bundle; getUserMedia alone fails with a bare NotAllowedError.
  const allowed = await window.stone.audio.requestMicrophone()
  if (!allowed) {
    throw new Error(
      'Stone has no access to the microphone. Turn it on in System Settings → Privacy & Security → Microphone.'
    )
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // A lecturer is across a room. Echo cancellation and noise suppression
      // are tuned for a voice at a desk and will gate a distant one out
      // entirely; gain control is the one that helps.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true
    }
  })

  let opened: Started
  try {
    opened = await window.stone.audio.startRecording(label)
  } catch (err) {
    for (const track of stream.getTracks()) track.stop()
    throw err
  }

  const type = mimeType()
  const recorder = new MediaRecorder(stream, {
    ...(type ? { mimeType: type } : {}),
    audioBitsPerSecond: BITS_PER_SECOND
  })

  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  context.createMediaStreamSource(stream).connect(analyser)

  const state: Active = {
    id: opened.id,
    relPath: opened.relPath,
    stream,
    recorder,
    context,
    analyser,
    levels: new Uint8Array(analyser.frequencyBinCount),
    queue: Promise.resolve(),
    failed: null
  }
  active = state

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    state.queue = state.queue
      .then(async () => {
        const bytes = new Uint8Array(await event.data.arrayBuffer())
        await window.stone.audio.appendRecording(state.id, bytes)
      })
      .catch((err: Error) => {
        // Remembered rather than thrown into nothing: the stop button is where
        // a person can be told, and by then every other chunk has been tried.
        state.failed ??= err
      })
  }

  recorder.start(CHUNK_MS)
  return opened
}

/** 0–1, from the loudest bin. Read by the meter on every frame. */
export function level(): number {
  if (!active) return 0
  active.analyser.getByteTimeDomainData(active.levels)
  let peak = 0
  for (const sample of active.levels) peak = Math.max(peak, Math.abs(sample - 128))
  // Square-rooted so a quiet room still moves the meter a little, which is how
  // someone tells "recording and silent" from "not recording".
  return Math.min(1, Math.sqrt(peak / 128))
}

export function pause(): void {
  if (active?.recorder.state === 'recording') active.recorder.pause()
}

export function resume(): void {
  if (active?.recorder.state === 'paused') active.recorder.resume()
}

export function isPaused(): boolean {
  return active?.recorder.state === 'paused'
}

/** Everything torn down, whichever way the recording ended. */
async function teardown(state: Active): Promise<void> {
  await new Promise<void>((resolve) => {
    if (state.recorder.state === 'inactive') {
      resolve()
      return
    }
    // The last chunk only arrives after `stop`, and it is the one holding the
    // final seconds — so the queue is not drained until `onstop` has fired.
    state.recorder.onstop = () => resolve()
    state.recorder.stop()
  })
  await state.queue
  for (const track of state.stream.getTracks()) track.stop()
  await state.context.close().catch(() => undefined)
}

export async function stop(): Promise<{ relPath: string; bytes: number }> {
  const state = active
  if (!state) throw new Error('Nothing is recording.')
  active = null

  await teardown(state)
  const done = await window.stone.audio.finishRecording(state.id)
  if (state.failed) throw state.failed
  return done
}

export async function discard(): Promise<void> {
  const state = active
  if (!state) return
  active = null
  await teardown(state)
  await window.stone.audio.cancelRecording(state.id).catch(() => undefined)
}

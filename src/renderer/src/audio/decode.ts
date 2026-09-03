import { toProtocolUrl } from '@shared/attachments'

/**
 * A recording, turned into what Whisper eats.
 *
 * Every Whisper front end accepts 16 kHz mono 16-bit PCM and whisper.cpp
 * accepts nothing else — so something has to decode the Opus. That something
 * is Chromium, which is already here and already has the decoder; the
 * alternative is making the user install ffmpeg to use a feature whose whole
 * pitch is that it works on the machine they are on.
 *
 * `decodeAudioData` resamples to the context's own rate, so asking for a
 * 16 kHz context does the resampling too, in one pass, in native code.
 */

const SAMPLE_RATE = 16_000

/** Samples per IPC message. About a megabyte, which keeps neither side waiting. */
const CHUNK = 1 << 19

/**
 * Decode `audioRelPath` and stream it to main under `id`.
 *
 * Returns the duration, which the caller wants anyway: a WebM written by
 * MediaRecorder carries no duration in its header, and this is the first
 * moment anything knows how long the recording actually is.
 */
export async function streamPcm(
  id: string,
  audioRelPath: string,
  onProgress?: (fraction: number) => void
): Promise<number> {
  const response = await fetch(toProtocolUrl(audioRelPath))
  if (!response.ok) throw new Error(`The recording could not be read (${response.status}).`)
  const encoded = await response.arrayBuffer()

  // Length 1 because nothing is ever rendered — the context exists only to fix
  // the sample rate that `decodeAudioData` resamples into.
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const buffer = await context.decodeAudioData(encoded)

  await window.stone.audio.openPcm(id)

  try {
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))

    const total = buffer.length
    const scratch = new Int16Array(Math.min(CHUNK, total))

    for (let offset = 0; offset < total; offset += CHUNK) {
      const size = Math.min(CHUNK, total - offset)
      for (let i = 0; i < size; i++) {
        // Downmix by averaging: a lecture recorded in stereo is the same room
        // twice, and taking one channel throws away half the signal-to-noise.
        let sum = 0
        for (const channel of channels) sum += channel[offset + i]
        const value = Math.max(-1, Math.min(1, sum / channels.length))
        scratch[i] = Math.round(value * 32767)
      }
      await window.stone.audio.writePcm(
        id,
        new Uint8Array(scratch.buffer.slice(0, size * 2))
      )
      onProgress?.((offset + size) / total)
    }
  } catch (err) {
    await window.stone.audio.discardPcm(id).catch(() => undefined)
    throw err
  }

  return buffer.duration
}

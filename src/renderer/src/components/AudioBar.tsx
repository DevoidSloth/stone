import { useEffect, useRef, useState } from 'react'
import { formatClock } from '@shared/audio'
import { toProtocolUrl } from '@shared/attachments'
import { recordingElapsed, useStone } from '../store'
import * as recorder from '../audio/recorder'
import { playerElement, setPlayerElement } from '../audio/player'
import { markNow } from '../editor/stamps'
import {
  IconMic,
  IconPause,
  IconPlay,
  IconSkipBack,
  IconSkipForward,
  IconStop,
  IconTrash,
  IconWaveform,
  IconX
} from '../ui/icons'

/**
 * The bar at the foot of the window: one recorder, one player, one transcription.
 *
 * All three live here rather than inside the note because all three outlive it.
 * A lecture keeps recording while you flip to last week's notes to check
 * something; a recording keeps playing while you scroll away from its embed;
 * and a transcription of an hour of audio takes minutes, during which the
 * person should be able to do anything else. Putting any of them in the editor
 * would tie them to a component that unmounts the moment a tab changes.
 */

/** How far a skip button jumps. Long enough to clear a sentence you missed. */
const SKIP_SECONDS = 10

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

export function AudioBar() {
  const recording = useStone((s) => s.recording)
  const playback = useStone((s) => s.playback)
  const transcribing = useStone((s) => s.transcribing)
  const transcripts = useStone((s) => s.transcripts)
  const settings = useStone((s) => s.settings)
  const stopRecording = useStone((s) => s.stopRecording)
  const discardRecording = useStone((s) => s.discardRecording)
  const togglePause = useStone((s) => s.toggleRecordingPause)
  const closePlayer = useStone((s) => s.closePlayer)
  const setPlayback = useStone((s) => s.setPlayback)
  const setSidePanel = useStone((s) => s.setSidePanel)
  const cancelTranscribe = useStone((s) => s.cancelTranscribe)
  const transcribe = useStone((s) => s.transcribe)
  const toast = useStone((s) => s.toast)

  if (!recording && !playback && !transcribing) return null

  return (
    <div className="audiobar">
      {recording && (
        <RecordingRow
          onMark={() => {
            const result = markNow()
            if (result === 'no-editor') toast('Put the caret in a note first.', 'error')
          }}
          onPause={togglePause}
          onStop={() => void stopRecording()}
          onDiscard={() => void discardRecording()}
          paused={recording.pausedAt !== null}
        />
      )}

      {playback && !recording && (
        <PlaybackRow
          audio={playback.audio}
          hasTranscript={Boolean(transcripts[playback.audio])}
          busy={transcribing?.audio === playback.audio}
          onTranscribe={() => void transcribe(playback.audio)}
          onShowTranscript={() => setSidePanel('transcript')}
          onClose={closePlayer}
          rate={playback.rate}
          onRate={(rate) => setPlayback({ rate })}
        />
      )}

      {transcribing && (
        <div className="audiobar__row audiobar__row--work">
          <IconWaveform size={13} />
          <span className="audiobar__label truncate">
            {transcribing.stage} — {basename(transcribing.audio)}
          </span>
          <div className="audiobar__progress" role="progressbar">
            <span
              className={
                transcribing.progress === null
                  ? 'audiobar__progressFill audiobar__progressFill--unknown'
                  : 'audiobar__progressFill'
              }
              style={
                transcribing.progress === null
                  ? undefined
                  : { width: `${Math.round(transcribing.progress * 100)}%` }
              }
            />
          </div>
          <span className="audiobar__count">
            {transcribing.segments.length > 0
              ? `${transcribing.segments.length} segments`
              : 'Starting…'}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={cancelTranscribe}>
            Stop
          </button>
        </div>
      )}

      {/* The element every seek in the app talks to. Kept mounted while the bar
          is, and outside the rows so a recording appearing above it does not
          unmount the player underneath. */}
      {playback && (
        <Player
          audio={playback.audio}
          rate={playback.rate}
          wanted={playback.time}
          autoplay={playback.autoplay}
        />
      )}

      {recording && settings?.audioAutoStamp === false && (
        <span className="audiobar__hint">Auto-stamping is off — press ⌘⇧M to mark a moment.</span>
      )}
    </div>
  )
}

function basename(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath
  return name.replace(/\.[a-z0-9]+$/i, '')
}

// ------------------------------------------------------------------ recording

function RecordingRow({
  paused,
  onMark,
  onPause,
  onStop,
  onDiscard
}: {
  paused: boolean
  onMark: () => void
  onPause: () => void
  onStop: () => void
  onDiscard: () => void
}) {
  const recording = useStone((s) => s.recording)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const meter = useRef<number | null>(null)

  // The clock is derived from the start time on every tick rather than
  // incremented, so a throttled background tab cannot make it drift away from
  // the offsets actually being written into the note.
  useEffect(() => {
    const tick = (): void => {
      const current = useStone.getState().recording
      if (current) setElapsed(recordingElapsed(current))
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const frame = (): void => {
      setLevel(recorder.level())
      meter.current = requestAnimationFrame(frame)
    }
    meter.current = requestAnimationFrame(frame)
    return () => {
      if (meter.current !== null) cancelAnimationFrame(meter.current)
    }
  }, [])

  if (!recording) return null

  return (
    <div className="audiobar__row audiobar__row--rec">
      <span className={paused ? 'audiobar__dot audiobar__dot--paused' : 'audiobar__dot'} />
      <IconMic size={13} />
      <span className="audiobar__clock mono">{formatClock(elapsed)}</span>

      {/* A meter, not a waveform: the only question it has to answer while a
          lecture runs is "is anything reaching the microphone". */}
      <div className="audiobar__meter" aria-hidden="true">
        <span style={{ transform: `scaleX(${paused ? 0 : Math.max(0.02, level)})` }} />
      </div>

      <span className="audiobar__label truncate">
        {paused ? 'Paused' : recording.note ? basename(recording.note) : 'Recording'}
      </span>

      <button type="button" className="btn btn--ghost btn--sm" onClick={onMark} data-tip="Stamp this line (⌘⇧M)">
        Mark
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onPause}>
        {paused ? <IconPlay size={12} /> : <IconPause size={12} />}
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button type="button" className="btn btn--primary btn--sm" onClick={onStop}>
        <IconStop size={11} /> Stop
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm audiobar__discard"
        onClick={onDiscard}
        data-tip="Throw this recording away"
      >
        <IconTrash size={12} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ playback

function PlaybackRow({
  audio,
  hasTranscript,
  busy,
  rate,
  onRate,
  onTranscribe,
  onShowTranscript,
  onClose
}: {
  audio: string
  hasTranscript: boolean
  busy: boolean
  rate: number
  onRate: (rate: number) => void
  onTranscribe: () => void
  onShowTranscript: () => void
  onClose: () => void
}) {
  const playback = useStone((s) => s.playback)
  const time = playback?.time ?? 0
  const duration = playback?.duration ?? 0
  const playing = playback?.playing ?? false

  const nudge = (by: number): void => {
    const element = playerElement()
    if (element) element.currentTime = Math.max(0, Math.min(duration || Infinity, time + by))
  }

  const toggle = (): void => {
    const element = playerElement()
    if (!element) return
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
  }

  return (
    <div className="audiobar__row">
      <button type="button" className="audiobar__play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
      </button>
      <button type="button" className="audiobar__icon" onClick={() => nudge(-SKIP_SECONDS)} data-tip={`Back ${SKIP_SECONDS}s`}>
        <IconSkipBack size={14} />
      </button>
      <button type="button" className="audiobar__icon" onClick={() => nudge(SKIP_SECONDS)} data-tip={`Forward ${SKIP_SECONDS}s`}>
        <IconSkipForward size={14} />
      </button>

      <span className="audiobar__clock mono">{formatClock(time)}</span>
      <input
        className="audiobar__scrub"
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={0.5}
        value={Math.min(time, Math.max(1, duration))}
        aria-label="Position in the recording"
        onChange={(event) => {
          const element = playerElement()
          if (element) element.currentTime = Number(event.target.value)
        }}
      />
      <span className="audiobar__clock audiobar__clock--dim mono">
        {duration > 0 ? formatClock(duration) : '--:--'}
      </span>

      <span className="audiobar__label truncate">{basename(audio)}</span>

      <select
        className="audiobar__rate"
        value={rate}
        aria-label="Playback speed"
        onChange={(event) => onRate(Number(event.target.value))}
      >
        {RATES.map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>

      {hasTranscript ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onShowTranscript}>
          Transcript
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={onTranscribe}
        >
          {busy ? 'Transcribing…' : 'Transcribe'}
        </button>
      )}

      <button type="button" className="audiobar__icon" onClick={onClose} aria-label="Close the player">
        <IconX size={12} />
      </button>
    </div>
  )
}

/**
 * The audio element itself.
 *
 * Its own component so that a re-render of the bar around it — the clock ticks
 * four times a second — never touches the element's attributes, which is what
 * would restart the file.
 */
function Player({
  audio,
  rate,
  wanted,
  autoplay
}: {
  audio: string
  rate: number
  wanted: number
  autoplay: boolean
}) {
  const setPlayback = useStone((s) => s.setPlayback)
  const element = useRef<HTMLAudioElement>(null)
  /** The position asked for before the file was ready, applied once it is. */
  const pending = useRef(wanted)
  const start = useRef(autoplay)

  useEffect(() => {
    setPlayerElement(element.current)
    return () => setPlayerElement(null)
  }, [])

  useEffect(() => {
    pending.current = wanted
    start.current = autoplay
    // A src change resets the element; nothing to apply until it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio])

  useEffect(() => {
    if (element.current) element.current.playbackRate = rate
  }, [rate])

  return (
    <audio
      id="stone-player"
      ref={element}
      src={toProtocolUrl(audio)}
      preload="metadata"
      onLoadedMetadata={(event) => {
        const media = event.currentTarget
        media.playbackRate = rate
        if (pending.current > 0) {
          media.currentTime = pending.current
          pending.current = 0
        }
        if (start.current) {
          start.current = false
          void media.play().catch(() => undefined)
        }
        if (Number.isFinite(media.duration) && media.duration > 0) {
          setPlayback({ duration: media.duration })
        } else {
          measureDuration(media, (duration) => setPlayback({ duration }))
        }
      }}
      onTimeUpdate={(event) => setPlayback({ time: event.currentTarget.currentTime })}
      onPlay={() => setPlayback({ playing: true })}
      onPause={() => setPlayback({ playing: false })}
      onEnded={() => setPlayback({ playing: false })}
      onSeeked={(event) => setPlayback({ time: event.currentTarget.currentTime })}
    />
  )
}

/**
 * How long a recording actually is.
 *
 * MediaRecorder writes a WebM with no duration in its header, so the element
 * reports Infinity until it has been asked to seek past the end — at which
 * point it reads the last cluster and knows. Nothing else gives the answer
 * without decoding the whole file, and the scrubber needs it before then.
 */
function measureDuration(media: HTMLAudioElement, done: (duration: number) => void): void {
  const onChange = (): void => {
    if (!Number.isFinite(media.duration)) return
    media.removeEventListener('durationchange', onChange)
    const found = media.duration
    media.currentTime = 0
    done(found)
  }
  media.addEventListener('durationchange', onChange)
  // Far past any plausible lecture; the element clamps to the real end.
  media.currentTime = 1e7
}

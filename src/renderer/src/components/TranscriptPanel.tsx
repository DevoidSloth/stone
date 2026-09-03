import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptSegment } from '@shared/types'
import { CITATION_RE, formatClock, parseClock, stripStamps } from '@shared/audio'
import { assetPathOf, embedKind, parseEmbed } from '@shared/attachments'
import { useStone } from '../store'
import { seekPlayer } from '../audio/player'
import { insertBlock } from '../editor/insert'
import { IconMic, IconSearch, IconSparkle, IconWaveform, IconX } from '../ui/icons'

/**
 * The transcript of the recording the player is on, and a way to ask about it.
 *
 * Three things a person wants from an hour of lecture they have already sat
 * through: to find the bit where a word was said, to jump the audio there, and
 * to ask a question the notes do not answer. The list does the first two and
 * the box at the bottom does the third — the transcript is handed to Claude as
 * context, and the timestamps it cites back come out as buttons that seek.
 */

/** Enough of a lecture for a question about it; past this the tail is dropped. */
const CONTEXT_LIMIT = 90_000

export function TranscriptPanel() {
  const playback = useStone((s) => s.playback)
  const transcripts = useStone((s) => s.transcripts)
  const transcribing = useStone((s) => s.transcribing)
  const transcribe = useStone((s) => s.transcribe)
  const openPlayer = useStone((s) => s.openPlayer)
  const loadTranscript = useStone((s) => s.loadTranscript)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const docs = useStone((s) => s.docs)
  const settings = useStone((s) => s.settings)

  const [query, setQuery] = useState('')

  const audio = playback?.audio ?? null

  useEffect(() => {
    if (audio) void loadTranscript(audio)
  }, [audio, loadTranscript])

  /** Recordings embedded in the note on screen, for when no player is open. */
  const inNote = useMemo(() => {
    const content = activeRelPath ? docs[activeRelPath]?.content : null
    if (!content) return []
    const folder = settings?.attachmentsFolder ?? 'Attachments'
    const found = new Set<string>()
    for (const match of content.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = (match[1] ?? match[2] ?? '').trim()
      if (!target || embedKind(target) !== 'audio') continue
      found.add(assetPathOf(parseEmbed(target).target, folder))
    }
    return [...found]
  }, [activeRelPath, docs, settings])

  if (!audio) {
    return (
      <div className="transcript">
        {inNote.length > 0 ? (
          <>
            <p className="panel__empty">Recordings in this note.</p>
            {inNote.map((path) => (
              <button
                key={path}
                type="button"
                className="panelrow transcript__pick"
                onClick={() => void openPlayer(path, activeRelPath)}
              >
                <IconWaveform size={13} />
                <span className="truncate">{path.split('/').pop()}</span>
              </button>
            ))}
          </>
        ) : (
          <p className="panel__empty">
            Nothing is playing. Start a recording, or press play on one embedded in a note, and its
            transcript appears here.
          </p>
        )}
      </div>
    )
  }

  const transcript = transcripts[audio]
  const live = transcribing?.audio === audio ? transcribing : null
  const segments: TranscriptSegment[] = transcript?.segments ?? live?.segments ?? []

  if (segments.length === 0) {
    return (
      <div className="transcript">
        <p className="panel__empty">
          <b>{audio.split('/').pop()}</b> has no transcript yet.
        </p>
        {live ? (
          <p className="panel__empty">{live.stage}…</p>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void transcribe(audio)}
          >
            <IconMic size={13} /> Transcribe it
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="transcript transcript--full">
      <Search query={query} onQuery={setQuery} count={segments.length} />
      <Segments segments={segments} query={query} time={playback?.time ?? 0} />
      {transcript && (
        <Actions
          segments={segments}
          audioName={audio.split('/').pop() ?? audio}
          noteText={activeRelPath ? (docs[activeRelPath]?.content ?? '') : ''}
        />
      )}
    </div>
  )
}

function Search({
  query,
  onQuery,
  count
}: {
  query: string
  onQuery: (value: string) => void
  count: number
}) {
  return (
    <div className="transcript__search">
      <IconSearch size={12} />
      <input
        className="transcript__field"
        placeholder={`Search ${count} segments`}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      {query && (
        <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => onQuery('')}>
          <IconX size={11} />
        </button>
      )}
    </div>
  )
}

function Segments({
  segments,
  query,
  time
}: {
  segments: TranscriptSegment[]
  query: string
  time: number
}) {
  const list = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLowerCase()

  const shown = useMemo(
    () => (needle ? segments.filter((s) => s.text.toLowerCase().includes(needle)) : segments),
    [segments, needle]
  )

  /** The segment the player is inside, by index into `shown`. */
  const current = useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) if (shown[i].start <= time) return i
    return -1
  }, [shown, time])

  // Follow the audio, but never while the person is reading somewhere else in
  // the list — a search is them looking, and scrolling under them is rude.
  useEffect(() => {
    if (needle || current < 0 || !list.current) return
    const row = list.current.children[current] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [current, needle])

  if (shown.length === 0) return <p className="panel__empty">Nothing matches “{query}”.</p>

  return (
    <div className="transcript__list" ref={list}>
      {shown.map((segment, index) => (
        <button
          key={`${segment.start}-${index}`}
          type="button"
          className={index === current ? 'transcript__seg transcript__seg--now' : 'transcript__seg'}
          onClick={() => seekPlayer(segment.start)}
        >
          <span className="transcript__time mono">{formatClock(segment.start)}</span>
          <span className="transcript__text">{highlight(segment.text, needle)}</span>
        </button>
      ))}
    </div>
  )
}

/** The matched run marked, so a search result reads at a glance. */
function highlight(text: string, needle: string) {
  if (!needle) return text
  const at = text.toLowerCase().indexOf(needle)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

// -------------------------------------------------------------- asking about it

function Actions({
  segments,
  audioName,
  noteText
}: {
  segments: TranscriptSegment[]
  audioName: string
  noteText: string
}) {
  const toast = useStone((s) => s.toast)
  const settings = useStone((s) => s.settings)

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const runId = useRef<string | null>(null)

  useEffect(() => {
    return window.stone.claude.onChunk((payload) => {
      if (payload.id === runId.current) setAnswer(payload.text)
    })
  }, [])

  /**
   * The lecture as Claude sees it: the transcript with its clock times, and the
   * notes the person took, stripped of the markers the recorder wrote. The
   * notes matter — half the questions worth asking are "what did I mean by
   * this", and that is unanswerable from the transcript alone.
   */
  const context = (): string => {
    const spoken = segments
      .map((segment) => `[${formatClock(segment.start)}] ${segment.text}`)
      .join('\n')
    const notes = stripStamps(noteText).trim()
    const body = [
      `--- transcript of ${audioName} ---`,
      spoken.length > CONTEXT_LIMIT ? `${spoken.slice(0, CONTEXT_LIMIT)}\n[transcript truncated]` : spoken,
      ...(notes ? ['', '--- the notes taken during it ---', notes.slice(0, 8000)] : [])
    ].join('\n')
    return body
  }

  const ask = async (): Promise<void> => {
    const text = question.trim()
    if (!text || busy) return
    const id = crypto.randomUUID()
    runId.current = id
    setBusy(true)
    setAnswer('')
    try {
      const result = await window.stone.claude.run({
        id,
        mode: 'lecture',
        prompt: text,
        context: context()
      })
      if (runId.current === id) setAnswer(result.text)
    } catch (err) {
      if (runId.current === id) toast((err as Error).message, 'error')
    } finally {
      if (runId.current === id) {
        setBusy(false)
        runId.current = null
      }
    }
  }

  const insertTranscript = (): void => {
    const markdown = segments
      .map((segment) => `**${formatClock(segment.start)}** ${segment.text}`)
      .join('\n\n')
    if (insertBlock(markdown)) toast('Transcript inserted.', 'success')
    else toast('Open a note to insert it into.', 'error')
  }

  return (
    <div className="transcript__foot">
      <div className="transcript__ask">
        <IconSparkle size={13} />
        <textarea
          className="field"
          rows={2}
          placeholder={
            settings?.claudeModel
              ? 'Ask about this lecture — “what did they say about eigenvalues?”'
              : 'Ask about this lecture'
          }
          value={question}
          disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask()
            }
          }}
        />
      </div>

      <div className="transcript__actions">
        <button type="button" className="btn btn--sm" onClick={insertTranscript}>
          Insert transcript
        </button>
        {busy ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              if (runId.current) void window.stone.claude.cancel(runId.current)
              runId.current = null
              setBusy(false)
            }}
          >
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void ask()}>
            Ask
          </button>
        )}
      </div>

      {(answer || busy) && (
        <div className="transcript__answer">
          <Answer text={answer || 'Thinking…'} />
          {answer && !busy && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                if (insertBlock(answer)) toast('Added to the note.', 'success')
              }}
            >
              Add to note
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Claude's answer, with every clock time in it turned into a seek.
 *
 * The point of asking a question about a lecture is usually to go and listen to
 * the part that answers it, so a citation that is only text is half an answer.
 */
function Answer({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: (string | { clock: string; seconds: number })[] = []
    let last = 0
    for (const match of text.matchAll(CITATION_RE)) {
      const seconds = parseClock(match[1])
      if (seconds === null) continue
      const at = match.index ?? 0
      if (at > last) out.push(text.slice(last, at))
      out.push({ clock: match[1], seconds })
      last = at + match[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text])

  return (
    <p className="transcript__answerBody">
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          <span key={index}>{part}</span>
        ) : (
          <button
            key={index}
            type="button"
            className="cm-stamp"
            onClick={() => seekPlayer(part.seconds)}
          >
            {part.clock}
          </button>
        )
      )}
    </p>
  )
}

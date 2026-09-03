import { useEffect, useRef, useState } from 'react'
import type { ClaudeActivity, ClaudeContext, ClaudeMode } from '@shared/types'
import { useStone } from '../store'
import { documentText, insertBlock, selectedText } from '../editor/insert'
import { IconSparkle, IconX } from '../ui/icons'
import { useFocusTrap } from '../lib/focus-trap'

/**
 * Ask Claude.
 *
 * Two things happen behind one box, and the mode row is the switch between
 * them. The first four modes are one-shot: a sentence goes out to the `claude`
 * CLI with every tool switched off, one block of markdown comes back, and it
 * lands below the caret. A diagram, a drawing, a program, a table — the whole
 * interaction is a keystroke and a sentence, and anything the answer got wrong
 * is faster to fix by asking again than by discussing it.
 *
 * Agent mode is the other thing. It runs in the vault with tools, so it can
 * read the notes before it answers, and it keeps the session, so a follow-up
 * can say "now add the error cases" and be understood. That makes it a
 * conversation, and a conversation cannot paste itself into the note halfway
 * through — the answer stays here with an Insert button under it until the
 * user says it is the one they wanted.
 *
 * Insertions go through CodeMirror rather than the store, so anything pasted
 * in is one undo away.
 */

/** Enough for a long note; past this the tail is dropped rather than the run. */
const CONTEXT_LIMIT = 60_000

/** The last few tool calls, which is as much as the line under the box holds. */
const ACTIVITY_SHOWN = 4

const MODES: Array<{ id: ClaudeMode; label: string; hint: string; placeholder: string }> = [
  {
    id: 'diagram',
    label: 'Diagram',
    hint: 'Mermaid, inserted below the cursor',
    placeholder: 'A class diagram for the vault store, its watcher, and the index…'
  },
  {
    id: 'drawing',
    label: 'Drawing',
    hint: 'An SVG picture, inserted below the cursor',
    placeholder: 'A labelled cross-section of a lithium cell, charging and discharging…'
  },
  {
    id: 'structure',
    label: 'Structure',
    hint: 'A memory, tree, or algorithm figure, inserted below the cursor',
    placeholder: 'The memory layout while reversing a singly linked list of four nodes…'
  },
  {
    id: 'code',
    label: 'Code',
    hint: 'A runnable block, inserted below the cursor',
    placeholder: 'Python that parses these timestamps and plots the gaps…'
  },
  {
    id: 'text',
    label: 'Markdown',
    hint: 'Markdown, inserted below the cursor',
    placeholder: 'A table comparing the three parsers…'
  },
  {
    id: 'agent',
    label: 'Agent',
    hint: 'Reads the vault, answers over several turns',
    placeholder: 'Find every note about the migration and draw me the timeline…'
  }
]

function modeSpec(mode: ClaudeMode) {
  return MODES.find((entry) => entry.id === mode) ?? MODES[0]
}

/** One question and the answer it got, for the agent's running transcript. */
interface Turn {
  prompt: string
  answer: string
}

export function ClaudeDialog() {
  const open = useStone((s) => s.claudeOpen)
  const seed = useStone((s) => s.claudeSeed)
  const setClaude = useStone((s) => s.setClaude)
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const toast = useStone((s) => s.toast)

  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<ClaudeMode>('diagram')
  const [selection, setSelection] = useState('')
  const [context, setContext] = useState<ClaudeContext>('none')
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [output, setOutput] = useState('')
  const dialog = useRef<HTMLFormElement>(null)

  useFocusTrap(dialog, open)
  const [activity, setActivity] = useState<ClaudeActivity[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const field = useRef<HTMLTextAreaElement>(null)
  const runId = useRef<string | null>(null)
  /** The agent's session, so the next turn continues this one. */
  const session = useRef<string | null>(null)
  const thread = useRef<HTMLDivElement>(null)

  const agent = mode === 'agent'
  const spec = modeSpec(mode)

  // Opening reads the editor's selection *before* the textarea takes focus, so
  // "diagram this" can mean the classes the user just highlighted.
  useEffect(() => {
    if (!open) return
    setPrompt(seed)
    setMode(settings?.claudeMode ?? 'diagram')
    setOutput('')
    setActivity([])
    setTurns([])
    setError(null)
    setBusy(false)
    session.current = null
    const picked = selectedText().trim()
    setSelection(picked)
    setContext(picked ? 'selection' : 'none')
    field.current?.focus()
    void window.stone.claude.status().then((s) => setMissing(!s.available))
    // Only on open: reseeding on every settings change would wipe what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed])

  useEffect(() => {
    return window.stone.claude.onChunk((payload) => {
      if (payload.id === runId.current) setOutput(payload.text)
    })
  }, [])

  useEffect(() => {
    return window.stone.claude.onActivity((payload) => {
      if (payload.id !== runId.current) return
      setActivity((current) => [...current, payload.activity].slice(-ACTIVITY_SHOWN))
    })
  }, [])

  // Escape has to work while a run is in flight, when the field is disabled and
  // holds no focus, so it is bound to the window rather than to the textarea.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [busy])

  // A new turn lands at the bottom, which is where the eye already is.
  useEffect(() => {
    const box = thread.current
    if (box) box.scrollTop = box.scrollHeight
  }, [turns, output])

  if (!open) return null

  function close(): void {
    if (runId.current) void window.stone.claude.cancel(runId.current)
    runId.current = null
    setClaude(false)
  }

  const chooseMode = (next: ClaudeMode): void => {
    if (next === mode) return
    if (runId.current) void window.stone.claude.cancel(runId.current)
    runId.current = null
    setMode(next)
    // A thread belongs to the mode that started it: the agent's session knows
    // nothing about a diagram asked for afterwards, and the reverse is worse.
    setTurns([])
    setOutput('')
    setActivity([])
    setError(null)
    setBusy(false)
    session.current = null
    void updateSettings({ claudeMode: next })
  }

  /** The note text going out with the prompt, already cut to size. */
  const contextText = (): string | null => {
    if (context === 'selection') return selection.slice(0, CONTEXT_LIMIT) || null
    if (context === 'note') return documentText().trim().slice(0, CONTEXT_LIMIT) || null
    return null
  }

  const insert = (text: string): void => {
    if (insertBlock(text)) {
      toast('Added to the note.', 'success')
      if (!agent) setClaude(false)
    } else {
      toast('Open a note to insert it into.', 'error')
    }
  }

  const submit = async (): Promise<void> => {
    const text = prompt.trim()
    if (!text || busy) return

    const id = crypto.randomUUID()
    runId.current = id
    setBusy(true)
    setOutput('')
    setActivity([])
    setError(null)

    try {
      const result = await window.stone.claude.run({
        id,
        mode,
        prompt: text,
        context: contextText(),
        sessionId: agent ? session.current : null
      })
      // A cancel that raced the reply: the user has moved on, so don't paste
      // into whatever they are doing now.
      if (runId.current !== id) return
      runId.current = null

      if (agent) {
        session.current = result.sessionId
        setTurns((current) => [...current, { prompt: text, answer: result.text }])
        setPrompt('')
        setOutput('')
        setBusy(false)
        // Context is sent once. The session already holds it, and resending the
        // note on every turn would push the conversation out of the window.
        setContext('none')
        field.current?.focus()
        return
      }

      if (insertBlock(result.text)) {
        setClaude(false)
        toast(mode === 'diagram' ? 'Diagram added to the note.' : 'Added to the note.', 'success')
      } else {
        // No note open to paste into. Keep the answer on screen rather than
        // throwing away a request that just cost real time.
        setOutput(result.text)
        setBusy(false)
        setError('Open a note to insert this, or copy it.')
      }
    } catch (err) {
      if (runId.current !== id) return
      runId.current = null
      const message = (err as Error).message
      if (message !== 'cancelled') setError(message)
      setBusy(false)
    }
  }

  const last = turns[turns.length - 1] ?? null
  const tools = settings?.claudeTools
  // What the agent may do, as a sentence rather than a list of switch names.
  // Reading is always first because it is the mode itself, not a permission.
  const can = [
    'read your notes',
    tools?.write ? 'edit them' : null,
    tools?.web ? 'search the web' : null,
    tools?.shell ? 'run commands' : null
  ].filter((entry): entry is string => entry !== null)
  const grants =
    can.length === 1 ? can[0] : `${can.slice(0, -1).join(', ')} and ${can[can.length - 1]}`

  return (
    <div className="overlay overlay--top" onMouseDown={close} role="presentation">
      <form
        className={agent ? 'modal modal--claude modal--claude-agent' : 'modal modal--claude'}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Ask Claude"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <header className="modal__head">
          <span className="claude__mark">
            <IconSparkle size={14} />
          </span>
          <h2 className="modal__title">Ask Claude</h2>
          <div className="claude__modes" role="group" aria-label="What to ask for">
            {MODES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-on={mode === entry.id}
                onClick={() => chooseMode(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label="Close"
            onClick={close}
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="modal__body claude__body">
          {turns.length > 0 && (
            <div className="claude__thread" ref={thread}>
              {turns.map((turn, index) => (
                <div className="claude__turn" key={index}>
                  <p className="claude__asked">{turn.prompt}</p>
                  <pre className="claude__out claude__out--turn">{turn.answer}</pre>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={field}
            className="field claude__field"
            rows={3}
            value={prompt}
            disabled={busy}
            placeholder={turns.length > 0 ? 'Ask a follow-up…' : spec.placeholder}
            aria-label="What should Claude make?"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, because this is a sentence, not a document.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />

          <div className="claude__context" role="group" aria-label="What to send as context">
            <span>Send with it</span>
            <div className="claude__modes claude__modes--inline">
              <button type="button" data-on={context === 'none'} onClick={() => setContext('none')}>
                Nothing
              </button>
              <button
                type="button"
                data-on={context === 'selection'}
                disabled={!selection}
                data-tip={
                  selection
                    ? `${selection.length.toLocaleString()} selected characters`
                    : 'Nothing is selected'
                }
                onClick={() => setContext('selection')}
              >
                Selection
              </button>
              <button type="button" data-on={context === 'note'} onClick={() => setContext('note')}>
                Whole note
              </button>
            </div>
          </div>

          {agent && (
            <p className="claude__note">
              Runs in the vault and can {grants}. Change what it may do in Settings.
            </p>
          )}

          {missing && (
            <p className="claude__note claude__note--warn">
              Claude Code was not found on this machine. Install it, or set the path to the CLI in
              Settings.
            </p>
          )}

          {busy && activity.length > 0 && (
            <ul className="claude__activity">
              {activity.map((item, index) => (
                <li key={index}>
                  <b>{item.tool}</b>
                  {item.detail ? ` ${item.detail}` : ''}
                </li>
              ))}
            </ul>
          )}

          {output && <pre className="claude__out">{output}</pre>}

          {error && <p className="claude__note claude__note--warn">{error}</p>}
        </div>

        <footer className="modal__foot">
          <span className="claude__hint">
            {busy
              ? // A drawing is minutes of silence and then a rush of output: the
                // geometry is worked out before the first tag is written, and a
                // timer alone next to a blank box reads as a hang.
                mode === 'drawing' && !output && seconds > 20
                ? `Working out the geometry… ${seconds}s — Esc to stop`
                : `Thinking… ${seconds}s — Esc to stop`
              : spec.hint}
          </span>
          {!busy && (last || output) && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(last?.answer ?? output)
                toast('Copied.', 'success')
              }}
            >
              Copy
            </button>
          )}
          {!busy && last && (
            <button type="button" className="btn" onClick={() => insert(last.answer)}>
              Insert
            </button>
          )}
          {busy ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (runId.current) void window.stone.claude.cancel(runId.current)
                runId.current = null
                setBusy(false)
              }}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="btn btn--primary" disabled={!prompt.trim()}>
              {turns.length > 0 ? 'Send' : 'Ask'}
            </button>
          )}
        </footer>
      </form>
    </div>
  )
}

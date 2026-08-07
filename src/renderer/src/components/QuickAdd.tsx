import { useEffect, useMemo, useRef, useState } from 'react'
import { parseQuickAdd } from '@shared/task-syntax'
import type { NLSpan } from '@shared/nl-date'
import { useStone } from '../store'
import { formatTime, relativeDay } from '../lib/dates'

/**
 * One line in, one task out. Dates can be written either way — "@2026-08-12" or
 * "next tuesday at 4" — and the phrase Stone read is underlined in place, so a
 * wrong guess is visible before you commit rather than after.
 */
export function QuickAdd() {
  const open = useStone((s) => s.quickAddOpen)
  const setQuickAdd = useStone((s) => s.setQuickAdd)
  const quickAddTask = useStone((s) => s.quickAddTask)
  const selectedDay = useStone((s) => s.selectedDay)
  const weekStartsOn = useStone((s) => s.settings?.weekStartsOn ?? 1)

  const [value, setValue] = useState('')
  const [literal, setLiteral] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setLiteral(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const parsed = useMemo(
    () => parseQuickAdd(value, new Date(), { weekStartsOn }),
    [value, weekStartsOn]
  )

  // With the reading dismissed, the phrase stays part of the task's name.
  const text = literal ? stripTokens(value) : parsed.text
  const due = literal ? null : parsed.due
  const recurrence = literal ? null : parsed.recurrence
  const day = due ?? selectedDay

  if (!open) return null

  const submit = (): void => {
    if (!text.trim()) return
    void quickAddTask({
      text,
      due: due ?? selectedDay,
      priority: parsed.priority,
      tags: parsed.tags,
      estimate: parsed.estimate,
      recurrence
    })
    setQuickAdd(false)
  }

  return (
    <div className="overlay overlay--top" onMouseDown={() => setQuickAdd(false)} role="presentation">
      <div
        className="quickadd"
        role="dialog"
        aria-modal="true"
        aria-label="Add a task"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quickadd__field">
          <div className="quickadd__mirror" ref={mirrorRef} aria-hidden="true">
            {highlight(value, literal ? [] : parsed.spans)}
          </div>
          <input
            ref={inputRef}
            className="quickadd__input"
            placeholder="Read chapter 4 tomorrow at 6pm !high #compilers"
            value={value}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setLiteral(false)
            }}
            onScroll={(e) => {
              // Keep the underlines glued to the text once it overflows.
              if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') setQuickAdd(false)
            }}
          />
        </div>

        <div className="quickadd__preview">
          {text ? (
            <>
              <span className="badge badge--due">
                {relativeDay(day)}
                {due?.includes('T') ? ` · ${formatTime(due)}` : ''}
              </span>
              {recurrence && <span className="badge badge--repeat">↻ {recurrence}</span>}
              {parsed.priority !== 'none' && (
                <span className={`badge badge--${parsed.priority}`}>{parsed.priority}</span>
              )}
              {parsed.estimate && (
                <span className="badge">
                  {parsed.estimate >= 60 ? `${parsed.estimate / 60}h` : `${parsed.estimate}m`}
                </span>
              )}
              {parsed.tags.map((tag) => (
                <span key={tag} className="badge badge--tag">
                  #{tag}
                </span>
              ))}
              <span style={{ color: 'var(--text)', fontSize: 'var(--t-base)' }}>{text}</span>
            </>
          ) : (
            <span className="quickadd__hint">
              tomorrow at 4pm · next friday · every weekday · !high sets priority · #tag files it
            </span>
          )}

          <span className="quickadd__actions">
            {parsed.spans.length > 0 && (
              <button
                type="button"
                className="quickadd__toggle"
                onClick={() => {
                  setLiteral((was) => !was)
                  inputRef.current?.focus()
                }}
              >
                {literal ? 'read the date' : 'keep as text'}
              </button>
            )}
            <span className="quickadd__hint">⏎ to add</span>
          </span>
        </div>
      </div>
    </div>
  )
}

/** Wrap each matched span so the mirror can wash it behind the real input. */
function highlight(value: string, spans: NLSpan[]) {
  if (spans.length === 0) return value
  const out: React.ReactNode[] = []
  let cursor = 0
  for (const [i, span] of merge(value, spans).entries()) {
    out.push(value.slice(cursor, span.start))
    out.push(
      <mark key={i} className="quickadd__match">
        {value.slice(span.start, span.end)}
      </mark>
    )
    cursor = span.end
  }
  out.push(value.slice(cursor))
  return out
}

/**
 * "next friday at 4pm" arrives as two spans. Joining ones separated by nothing
 * but a space keeps it a single pill instead of a row of fragments.
 */
function merge(value: string, spans: NLSpan[]): NLSpan[] {
  const out: NLSpan[] = []
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1]
    if (last && span.start < last.end) continue
    if (last && value.slice(last.end, span.start).trim() === '') last.end = span.end
    else out.push({ ...span })
  }
  return out
}

/** The literal reading still drops the explicit `!`/`#`/`+` tokens. */
function stripTokens(value: string): string {
  return value
    .replace(/(?:^|\s)#[\p{L}\p{N}_\-/]+/gu, '')
    .replace(/(?:^|\s)!(?:urgent|high|medium|med|low)\b/gi, '')
    .replace(/(?:^|\s)\+\d+(?:\.\d+)?(?:mins?|m|hrs?|h|d)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

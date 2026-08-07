/**
 * Stone's inline task syntax.
 *
 * A task is a plain markdown checkbox. Metadata rides along as tokens that stay
 * readable when the file is opened in any other editor:
 *
 *   - [ ] Finish the parser @2026-08-12 14:30 ~2026-08-10 !high +90m #compilers
 *          ^ text            ^ due            ^ scheduled  ^ pri  ^ est ^ tag
 *
 * Obsidian Tasks emoji syntax is also read (📅 ⏳ ⏫ 🔺 🔽 ✅) so existing vaults
 * import cleanly, but Stone always writes the token form.
 */

import { parseNaturalDate, toISODate, type NLDateOptions, type NLSpan } from './nl-date'
import type { Priority, Task, TaskStatus } from './types'

export { toISODate }

/** `- [ ] `, `* [x] `, `1. [/] ` — captures indent, marker, status char, rest. */
const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX/\-])\]\s?(.*)$/

const DUE_RE = /@(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/
const SCHED_RE = /~(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/
const REL_DUE_RE = /@(today|tomorrow|yesterday)\b/i
const PRIORITY_RE = /!(urgent|high|medium|med|low)\b/i
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu
const ESTIMATE_RE = /\+(\d+(?:\.\d+)?)(mins?|m|hrs?|h|d)\b/i

/**
 * Repeat rules. `&weekly` is the short form; `&every 3 days` covers the rest.
 * Kept as prose rather than an RRULE because the line has to stay readable in
 * any other editor — the same reason every other token here is plain text.
 */
export const RECUR_RE =
  /&(daily|weekly|fortnightly|monthly|yearly|annually|weekdays|every\s+\d+\s+(?:day|week|month|year)s?|every\s+(?:day|week|month|year))\b/i

// Obsidian Tasks compatibility.
const EMOJI_DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/
const EMOJI_SCHED_RE = /[⏳🛫]\s*(\d{4}-\d{2}-\d{2})/
const EMOJI_DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/
const EMOJI_RECUR_RE = /🔁\s*((?:every\s+)?[\w ]+?)(?=\s|$)/
const EMOJI_PRIORITY: Record<string, Priority> = {
  '🔺': 'urgent',
  '⏫': 'high',
  '🔼': 'medium',
  '🔽': 'low'
}

const STATUS_BY_CHAR: Record<string, TaskStatus> = {
  ' ': 'todo',
  x: 'done',
  X: 'done',
  '/': 'doing',
  '-': 'cancelled'
}

const CHAR_BY_STATUS: Record<TaskStatus, string> = {
  todo: ' ',
  done: 'x',
  doing: '/',
  cancelled: '-'
}

export function isTaskLine(line: string): boolean {
  return TASK_LINE_RE.test(line)
}

function resolveRelative(word: string, today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const w = word.toLowerCase()
  if (w === 'tomorrow') d.setDate(d.getDate() + 1)
  else if (w === 'yesterday') d.setDate(d.getDate() - 1)
  return toISODate(d)
}

function normalizePriority(word: string): Priority {
  const w = word.toLowerCase()
  if (w === 'med') return 'medium'
  return w as Priority
}

function minutesFrom(value: string, unit: string): number {
  const n = parseFloat(value)
  const u = unit.toLowerCase()
  if (u.startsWith('d')) return Math.round(n * 60 * 24)
  if (u.startsWith('h')) return Math.round(n * 60)
  return Math.round(n)
}

/**
 * Parse one line into a Task. Returns null when the line is not a checkbox.
 * `relPath` and `line` only build the id; parsing itself is position-free.
 */
export function parseTaskLine(
  raw: string,
  relPath: string,
  line: number,
  today = new Date()
): Task | null {
  const m = TASK_LINE_RE.exec(raw)
  if (!m) return null

  const [, indent, , statusChar, body] = m
  let rest = body
  let due: string | null = null
  let scheduled: string | null = null
  let priority: Priority = 'none'
  let estimate: number | null = null
  const tags: string[] = []

  const dueMatch = DUE_RE.exec(rest)
  if (dueMatch) {
    due = dueMatch[2] ? `${dueMatch[1]}T${dueMatch[2]}` : dueMatch[1]
    rest = rest.replace(dueMatch[0], '')
  } else {
    const rel = REL_DUE_RE.exec(rest)
    if (rel) {
      due = resolveRelative(rel[1], today)
      rest = rest.replace(rel[0], '')
    } else {
      const emoji = EMOJI_DUE_RE.exec(rest)
      if (emoji) {
        due = emoji[1]
        rest = rest.replace(emoji[0], '')
      }
    }
  }

  const schedMatch = SCHED_RE.exec(rest)
  if (schedMatch) {
    scheduled = schedMatch[2] ? `${schedMatch[1]}T${schedMatch[2]}` : schedMatch[1]
    rest = rest.replace(schedMatch[0], '')
  } else {
    const emoji = EMOJI_SCHED_RE.exec(rest)
    if (emoji) {
      scheduled = emoji[1]
      rest = rest.replace(emoji[0], '')
    }
  }

  const priMatch = PRIORITY_RE.exec(rest)
  if (priMatch) {
    priority = normalizePriority(priMatch[1])
    rest = rest.replace(priMatch[0], '')
  } else {
    for (const [glyph, level] of Object.entries(EMOJI_PRIORITY)) {
      if (rest.includes(glyph)) {
        priority = level
        rest = rest.replace(glyph, '')
        break
      }
    }
  }

  const estMatch = ESTIMATE_RE.exec(rest)
  if (estMatch) {
    estimate = minutesFrom(estMatch[1], estMatch[2])
    rest = rest.replace(estMatch[0], '')
  }

  let recurrence: string | null = null
  const recurMatch = RECUR_RE.exec(rest)
  if (recurMatch) {
    recurrence = recurMatch[1].toLowerCase()
    rest = rest.replace(recurMatch[0], '')
  } else {
    const emoji = EMOJI_RECUR_RE.exec(rest)
    if (emoji) {
      recurrence = emoji[1].trim().toLowerCase()
      rest = rest.replace(emoji[0], '')
    }
  }

  const doneStamp = EMOJI_DONE_RE.exec(rest)
  if (doneStamp) rest = rest.replace(doneStamp[0], '')

  TAG_RE.lastIndex = 0
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = TAG_RE.exec(rest)) !== null) tags.push(tagMatch[1])
  rest = rest.replace(TAG_RE, ' ')

  return {
    id: `${relPath}:${line}`,
    relPath,
    line,
    text: rest.replace(/\s{2,}/g, ' ').trim(),
    raw,
    status: STATUS_BY_CHAR[statusChar] ?? 'todo',
    priority,
    due,
    scheduled,
    tags,
    estimate,
    depth: Math.floor(indent.replace(/\t/g, '    ').length / 2),
    recurrence
  }
}

/**
 * Advance a date by a repeat rule. Returns null when the rule is unreadable, so
 * an unrecognised token can never silently reschedule something to the wrong day.
 */
export function nextOccurrence(from: string, rule: string): string | null {
  const iso = from.slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)
  const normalized = rule.trim().toLowerCase()

  const every = /^every\s+(\d+)?\s*(day|week|month|year)s?$/.exec(normalized)
  const unit = every ? every[2] : null
  const count = every ? Number(every[1] ?? 1) : 1

  if (normalized === 'weekdays') {
    // Friday and Saturday both land on the following Monday.
    do {
      date.setDate(date.getDate() + 1)
    } while (date.getDay() === 0 || date.getDay() === 6)
  } else if (normalized === 'daily' || unit === 'day') {
    date.setDate(date.getDate() + count)
  } else if (normalized === 'weekly' || unit === 'week') {
    date.setDate(date.getDate() + 7 * count)
  } else if (normalized === 'fortnightly') {
    date.setDate(date.getDate() + 14)
  } else if (normalized === 'monthly' || unit === 'month') {
    date.setMonth(date.getMonth() + count)
  } else if (normalized === 'yearly' || normalized === 'annually' || unit === 'year') {
    date.setFullYear(date.getFullYear() + count)
  } else {
    return null
  }

  const next = toISODate(date)
  // Preserve a time component so a 09:00 standup stays at 09:00.
  return from.includes('T') ? `${next}T${from.slice(11, 16)}` : next
}

/**
 * Completing a repeating task should leave the next one behind, not just tick
 * this one off. Returns the line to keep and the line to insert above it, or
 * null when the task does not repeat.
 */
export function rollRecurrence(raw: string): { completed: string; next: string } | null {
  const task = parseTaskLine(raw, '', 0)
  if (!task?.recurrence) return null
  const anchor = task.due ?? task.scheduled
  if (!anchor) return null
  const next = nextOccurrence(anchor, task.recurrence)
  if (!next) return null

  const completed = setStatusOnLine(raw, 'done')
  const rolled = task.due
    ? setDueOnLine(setStatusOnLine(raw, 'todo'), next)
    : setScheduledOnLine(setStatusOnLine(raw, 'todo'), next)
  return { completed, next: rolled }
}

/** Rewrite the checkbox character on a task line, leaving the rest untouched. */
export function setStatusOnLine(raw: string, status: TaskStatus): string {
  const m = TASK_LINE_RE.exec(raw)
  if (!m) return raw
  const [, indent, marker, , body] = m
  return `${indent}${marker} [${CHAR_BY_STATUS[status]}] ${body}`
}

export function cycleStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'todo':
      return 'doing'
    case 'doing':
      return 'done'
    case 'done':
      return 'todo'
    case 'cancelled':
      return 'todo'
  }
}

/**
 * Set or clear the due token on a line. Passing null removes it.
 * An existing token is replaced where it sits so word order is preserved.
 */
export function setDueOnLine(raw: string, due: string | null): string {
  const m = TASK_LINE_RE.exec(raw)
  if (!m) return raw

  const token = due ? `@${due.replace('T', ' ')}` : ''
  const existing = DUE_RE.exec(raw) ?? REL_DUE_RE.exec(raw) ?? EMOJI_DUE_RE.exec(raw)

  if (existing) {
    const replaced = raw.replace(existing[0], token)
    return replaced.replace(/[ \t]{2,}/g, ' ').trimEnd()
  }
  if (!due) return raw
  return `${raw.trimEnd()} ${token}`
}

/** Set or clear the `~scheduled` token, mirroring setDueOnLine. */
export function setScheduledOnLine(raw: string, scheduled: string | null): string {
  if (!TASK_LINE_RE.test(raw)) return raw
  const token = scheduled ? `~${scheduled.replace('T', ' ')}` : ''
  const existing = SCHED_RE.exec(raw) ?? EMOJI_SCHED_RE.exec(raw)
  if (existing) {
    return raw.replace(existing[0], token).replace(/[ \t]{2,}/g, ' ').trimEnd()
  }
  if (!scheduled) return raw
  return `${raw.trimEnd()} ${token}`
}

export function setPriorityOnLine(raw: string, priority: Priority): string {
  if (!TASK_LINE_RE.test(raw)) return raw
  const token = priority === 'none' ? '' : `!${priority}`
  const existing = PRIORITY_RE.exec(raw)
  if (existing) {
    return raw.replace(existing[0], token).replace(/[ \t]{2,}/g, ' ').trimEnd()
  }
  if (!token) return raw
  return `${raw.trimEnd()} ${token}`
}

/** Build a fresh task line from parts. Used by quick-add. */
export function buildTaskLine(input: {
  text: string
  due?: string | null
  scheduled?: string | null
  priority?: Priority
  tags?: string[]
  estimate?: number | null
  recurrence?: string | null
}): string {
  const parts = [`- [ ] ${input.text.trim()}`]
  if (input.due) parts.push(`@${input.due.replace('T', ' ')}`)
  if (input.scheduled) parts.push(`~${input.scheduled.replace('T', ' ')}`)
  if (input.priority && input.priority !== 'none') parts.push(`!${input.priority}`)
  if (input.estimate) {
    parts.push(input.estimate % 60 === 0 ? `+${input.estimate / 60}h` : `+${input.estimate}m`)
  }
  if (input.recurrence) parts.push(`&${input.recurrence}`)
  for (const tag of input.tags ?? []) parts.push(`#${tag}`)
  return parts.join(' ')
}

export interface QuickAddResult {
  text: string
  due: string | null
  priority: Priority
  tags: string[]
  estimate: number | null
  recurrence: string | null
  /** Where the natural-language phrases sat in the input, for highlighting. */
  spans: NLSpan[]
}

/**
 * Pull structured fields out of free text typed into quick-add, so
 * "read ch. 4 tomorrow at 6 !high #os" becomes a task with a real due date.
 *
 * Natural language runs first and hands the leftovers to the token parser, so
 * both notations work in one line. Tokens win where they overlap: they were
 * typed deliberately, whereas a phrase is only ever an inference.
 */
export function parseQuickAdd(
  input: string,
  today = new Date(),
  options: NLDateOptions = {}
): QuickAddResult {
  const nl = parseNaturalDate(input, { now: today, ...options })
  const parsed = parseTaskLine(`- [ ] ${nl.text}`, '', 0, today)

  const base = parsed ?? {
    text: nl.text.trim(),
    due: null,
    priority: 'none' as Priority,
    tags: [] as string[],
    estimate: null,
    recurrence: null
  }

  let due = base.due ?? (nl.date && nl.time ? `${nl.date}T${nl.time}` : nl.date)
  // "@2026-08-12 at 4pm" — an explicit day with the time only spelt out.
  if (due && !due.includes('T') && nl.time) due = `${due}T${nl.time}`

  return {
    text: base.text,
    due,
    priority: base.priority,
    tags: base.tags,
    estimate: base.estimate,
    recurrence: base.recurrence ?? nl.recurrence,
    spans: nl.spans
  }
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4
}

/** Sort by priority, then soonest due, then original order. */
export function compareTasks(a: Task, b: Task): number {
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  if (p !== 0) return p
  if (a.due && b.due) return a.due.localeCompare(b.due)
  if (a.due) return -1
  if (b.due) return 1
  return a.line - b.line
}

/** `YYYY-MM-DD` for a due value that may carry a time component. */
export function dueDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null
}

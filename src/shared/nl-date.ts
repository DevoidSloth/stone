/**
 * Natural-language dates and times for task input.
 *
 * Files always carry the explicit token form (`@2026-08-12 14:30`). This module
 * exists so you never have to type it: quick-add reads "call the bank tomorrow
 * at 4pm", resolves the phrase, and writes the token. Disk stays unambiguous;
 * only the input box is forgiving.
 *
 * Deliberately input-only. Running this over vault lines would be destructive —
 * a note that says "we sat on it" must never sprout a Saturday due date.
 */

export interface NLSpan {
  /** Index into the original input. */
  start: number
  /** Exclusive. */
  end: number
}

export interface NLDateResult {
  /** `YYYY-MM-DD`, or null when nothing date-like was found. */
  date: string | null
  /** `HH:MM` on a 24-hour clock, or null when no time was given. */
  time: string | null
  /** A repeat rule in the vocabulary `nextOccurrence` reads, from "every 2 weeks". */
  recurrence: string | null
  /** The input with every matched phrase cut out and whitespace tidied. */
  text: string
  /** Where the matches sat in the input, so callers can highlight them. */
  spans: NLSpan[]
}

export interface NLDateOptions {
  /** Treated as "now". Defaults to the current moment. */
  now?: Date
  weekStartsOn?: 0 | 1
  /** true → `5/6` is 5 June; false → 5 May. Defaults to the host locale. */
  dayFirst?: boolean
}

// ------------------------------------------------------------------ calendar

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const next = midnight(d)
  next.setDate(next.getDate() + days)
  return next
}

/** Month arithmetic that clamps: 31 Jan + 1 month is 28 Feb, not 3 March. */
function addMonths(d: Date, months: number): Date {
  const day = d.getDate()
  const next = new Date(d.getFullYear(), d.getMonth(), 1)
  next.setMonth(next.getMonth() + months)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  return addDays(d, -((d.getDay() - weekStartsOn + 7) % 7))
}

/** Null when the parts do not name a real day, so 31 Feb is rejected not rolled. */
function makeDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day)
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null
  return d
}

/**
 * A bare "5 Jan" means the next 5 Jan, not one in the past. Tries this year
 * first, then next — the second attempt also covers 29 Feb landing on a leap year.
 */
function nearestFuture(month: number, day: number, today: Date): Date | null {
  for (let offset = 0; offset <= 4; offset++) {
    const candidate = makeDate(today.getFullYear() + offset, month, day)
    if (candidate && candidate.getTime() >= today.getTime()) return candidate
  }
  return null
}

let cachedDayFirst: boolean | null = null

/** Whether this machine writes day before month, probed rather than guessed. */
export function localeDayFirst(): boolean {
  if (cachedDayFirst !== null) return cachedDayFirst
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'numeric'
    }).formatToParts(new Date(2000, 0, 2))
    const first = parts.find((p) => p.type === 'day' || p.type === 'month')
    cachedDayFirst = first?.type === 'day'
  } catch {
    cachedDayFirst = false
  }
  return cachedDayFirst
}

// -------------------------------------------------------------- vocabularies

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  weds: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
}

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11
}

interface DayPart {
  hhmm: string
  pm: boolean
}

/** Unambiguous as words — safe to read as a time even with no date nearby. */
const HARD_DAY_PARTS: Record<string, DayPart> = {
  noon: { hhmm: '12:00', pm: true },
  midday: { hhmm: '12:00', pm: true },
  midnight: { hhmm: '00:00', pm: false }
}

/**
 * Ordinary English words that only mean a time next to a date. "Friday night"
 * is 8pm; "book night shift" is not.
 */
const SOFT_DAY_PARTS: Record<string, DayPart> = {
  morning: { hhmm: '09:00', pm: false },
  afternoon: { hhmm: '14:00', pm: true },
  evening: { hhmm: '18:00', pm: true },
  night: { hhmm: '20:00', pm: true },
  tonight: { hhmm: '20:00', pm: true }
}

const ALL_DAY_PARTS = { ...HARD_DAY_PARTS, ...SOFT_DAY_PARTS }

/** Longest first, so `thursday` wins the alternation over `thu`. */
function alt(words: string[]): string {
  return [...words].sort((a, b) => b.length - a.length).join('|')
}

const WD = alt(Object.keys(WEEKDAY_INDEX))
const MO = alt(Object.keys(MONTH_INDEX))
const UNIT = 'minutes|minute|mins|min|hours|hour|hrs|hr|days|day|weeks|week|months|month|years|year'
const ORD = '(?:st|nd|rd|th)?'

// -------------------------------------------------------------------- engine

interface Ctx {
  now: Date
  today: Date
  weekStartsOn: 0 | 1
  dayFirst: boolean
  /** Set once a phrase has established morning-or-evening for a later bare hour. */
  pm: boolean | null
}

interface Hit {
  date: Date | null
  time: string | null
  /** Meridiem this phrase implies for a bare hour that follows it. */
  pm: boolean | null
}

interface Rule {
  re: RegExp
  run: (m: RegExpExecArray, ctx: Ctx) => Hit | null
}

function on(date: Date | null): Hit | null {
  return date ? { date, time: null, pm: null } : null
}

/** An instant, split into the day and the wall clock reading. */
function at(moment: Date): Hit {
  return {
    date: midnight(moment),
    time: `${pad(moment.getHours())}:${pad(moment.getMinutes())}`,
    pm: null
  }
}

/**
 * Walk the rules in order and return the first that both matches and resolves.
 * A rule that matches but rejects (13/45, 31 Feb) keeps scanning the same string,
 * so "buy 3 pints on 12/08" still finds the date.
 */
function scan(rules: Rule[], text: string, ctx: Ctx): { hit: Hit; span: NLSpan } | null {
  for (const rule of rules) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++
        continue
      }
      const hit = rule.run(m, ctx)
      if (hit) return { hit, span: { start: m.index, end: m.index + m[0].length } }
    }
  }
  return null
}

// --------------------------------------------------------------------- dates

function numericDate(a: string, b: string, y: string | undefined, ctx: Ctx): Hit | null {
  const first = Number(a)
  const second = Number(b)
  let day: number
  let month: number

  // A value over 12 can only be a day, whatever the local convention says.
  if (first > 12 && second <= 12) {
    day = first
    month = second
  } else if (second > 12 && first <= 12) {
    month = first
    day = second
  } else if (ctx.dayFirst) {
    day = first
    month = second
  } else {
    month = first
    day = second
  }
  if (month < 1 || month > 12) return null

  if (y === undefined) return on(nearestFuture(month - 1, day, ctx.today))
  const year = y.length === 2 ? 2000 + Number(y) : Number(y)
  return on(makeDate(year, month - 1, day))
}

function monthDay(monthWord: string, dayWord: string, y: string | undefined, ctx: Ctx): Hit | null {
  const month = MONTH_INDEX[monthWord.toLowerCase().replace(/\.$/, '')]
  const day = Number(dayWord)
  if (month === undefined || day < 1 || day > 31) return null
  if (y === undefined) return on(nearestFuture(month, day, ctx.today))
  return on(makeDate(Number(y), month, day))
}

/** `weekday` on or after today — typing "monday" on a Monday means today. */
function upcomingWeekday(index: number, ctx: Ctx): Date {
  return addDays(ctx.today, (index - ctx.today.getDay() + 7) % 7)
}

function weekdayIn(index: number, weekOffset: number, ctx: Ctx): Date {
  const week = addDays(startOfWeek(ctx.today, ctx.weekStartsOn), weekOffset * 7)
  return addDays(week, (index - week.getDay() + 7) % 7)
}

function shiftBy(n: number, unit: string, ctx: Ctx): Hit | null {
  const u = unit.toLowerCase()
  if (u.startsWith('min')) return at(new Date(ctx.now.getTime() + n * 60_000))
  if (u.startsWith('h')) return at(new Date(ctx.now.getTime() + n * 3_600_000))
  if (u.startsWith('d')) return on(addDays(ctx.today, n))
  if (u.startsWith('w')) return on(addDays(ctx.today, n * 7))
  if (u.startsWith('mo')) return on(addMonths(ctx.today, n))
  if (u.startsWith('y')) return on(addMonths(ctx.today, n * 12))
  return null
}

/**
 * `this X` is the end of the current X, `next X` the start of the following one,
 * `last X` the start of the previous one — so "due this week" lands on Sunday
 * while "next week" lands on Monday.
 */
function period(qualifier: string, unit: string, ctx: Ctx): Hit | null {
  const q = qualifier.toLowerCase()
  const u = unit.toLowerCase()
  const { today, weekStartsOn } = ctx

  if (u === 'weekend') {
    const saturday = upcomingWeekday(6, ctx)
    return on(q === 'next' ? addDays(saturday, 7) : q === 'last' ? addDays(saturday, -7) : saturday)
  }
  if (u === 'week') {
    const start = startOfWeek(today, weekStartsOn)
    if (q === 'next') return on(addDays(start, 7))
    if (q === 'last') return on(addDays(start, -7))
    return on(addDays(start, 6))
  }
  if (u === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1)
    if (q === 'next') return on(addMonths(first, 1))
    if (q === 'last') return on(addMonths(first, -1))
    return on(new Date(today.getFullYear(), today.getMonth() + 1, 0))
  }
  if (u === 'year') {
    if (q === 'next') return on(new Date(today.getFullYear() + 1, 0, 1))
    if (q === 'last') return on(new Date(today.getFullYear() - 1, 0, 1))
    return on(new Date(today.getFullYear(), 11, 31))
  }
  return null
}

const DATE_RULES: Rule[] = [
  // 2026-08-12
  {
    re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    run: (m) => on(makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  },
  // 12/08, 12/08/26, 12/08/2026
  {
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?!\d)/g,
    run: (m, ctx) => numericDate(m[1], m[2], m[3], ctx)
  },
  // 12-08-2026 — hyphens need the year, or "3-4 people" would read as a date.
  {
    re: /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/g,
    run: (m, ctx) => numericDate(m[1], m[2], m[3], ctx)
  },
  // 12 August, 12th of August 2026
  {
    re: new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MO})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
    run: (m, ctx) => monthDay(m[2], m[1], m[3], ctx)
  },
  // August 12, Aug 12th 2026
  {
    re: new RegExp(`\\b(${MO})\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
    run: (m, ctx) => monthDay(m[1], m[2], m[3], ctx)
  },
  // in 3 days, in an hour, in 20 mins
  {
    re: new RegExp(`\\bin\\s+(an?|\\d+)\\s*(${UNIT})\\b`, 'gi'),
    run: (m, ctx) => shiftBy(/^\d+$/.test(m[1]) ? Number(m[1]) : 1, m[2], ctx)
  },
  // 3 weeks from now
  {
    re: new RegExp(`\\b(\\d+)\\s*(${UNIT})\\s+from\\s+now\\b`, 'gi'),
    run: (m, ctx) => shiftBy(Number(m[1]), m[2], ctx)
  },
  // end of the month, eow
  {
    re: /\b(?:end\s+of\s+(?:the\s+)?(week|month|year)|(eow|eom|eoy))\b/gi,
    run: (m, ctx) => {
      const unit = m[1]
        ? m[1].toLowerCase()
        : { eow: 'week', eom: 'month', eoy: 'year' }[m[2].toLowerCase()]!
      return period('this', unit, ctx)
    }
  },
  // this morning, tomorrow evening handled separately — this one owns "today".
  {
    re: /\bthis\s+(morning|afternoon|evening|night)\b/gi,
    run: (m, ctx) => {
      const part = SOFT_DAY_PARTS[m[1].toLowerCase()]
      return { date: ctx.today, time: part.hhmm, pm: part.pm }
    }
  },
  // this week, next month, last year
  {
    re: /\b(this|next|last)\s+(week|month|year|weekend)\b/gi,
    run: (m, ctx) => period(m[1], m[2], ctx)
  },
  // next friday, this coming tuesday
  {
    re: new RegExp(`\\b(this|next|last|coming)\\s+(?:coming\\s+)?(${WD})\\b`, 'gi'),
    run: (m, ctx) => {
      const index = WEEKDAY_INDEX[m[2].toLowerCase()]
      const q = m[1].toLowerCase()
      if (q === 'next') return on(weekdayIn(index, 1, ctx))
      if (q === 'last') return on(weekdayIn(index, -1, ctx))
      return on(upcomingWeekday(index, ctx))
    }
  },
  // today, tomorrow, tonight
  {
    re: /\b(today|tod|tonight|tomorrow|tomorow|tommorow|tmrw|tmrow|tmr|tmw|yesterday|yday)\b/gi,
    run: (m, ctx) => {
      const word = m[1].toLowerCase()
      if (word === 'tonight') return { date: ctx.today, time: '20:00', pm: true }
      if (word === 'today' || word === 'tod') return on(ctx.today)
      if (word === 'yesterday' || word === 'yday') return on(addDays(ctx.today, -1))
      return on(addDays(ctx.today, 1))
    }
  },
  // the weekend
  {
    re: /\b(?:the\s+)?weekend\b/gi,
    run: (_m, ctx) => on(upcomingWeekday(6, ctx))
  },
  // bare friday — last, so "next friday" is never read as plain "friday"
  {
    re: new RegExp(`\\b(${WD})\\b`, 'gi'),
    run: (m, ctx) => on(upcomingWeekday(WEEKDAY_INDEX[m[1].toLowerCase()], ctx))
  }
]

// --------------------------------------------------------------------- times

/**
 * Bare hours have no meridiem, so pick the reading a person means: 1–6 is
 * afternoon, 7–11 is morning. An earlier phrase ("tonight at 9") overrides this.
 */
function guessMeridiem(hour: number): number {
  if (hour >= 1 && hour <= 6) return hour + 12
  return hour
}

function clock(hour: number, minute: number, meridiem: string | null, ctx: Ctx): Hit | null {
  if (minute > 59) return null
  let h = hour

  if (meridiem) {
    if (h < 1 || h > 12) return null
    const isPm = meridiem[0].toLowerCase() === 'p'
    h = isPm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h
  } else if (h <= 12) {
    if (ctx.pm === true) h = h === 12 ? 12 : h + 12
    else if (ctx.pm === false) h = h === 12 ? 0 : h
    else h = guessMeridiem(h)
  }

  if (h > 23) return null
  return { date: null, time: `${pad(h)}:${pad(minute)}`, pm: null }
}

const CLOCK_RULES: Rule[] = [
  // at 4, at 4:30pm, at 16.00, at 5 o'clock
  {
    re: /\bat\s+(\d{1,2})(?:[:.](\d{2}))?(?!\d)(?!\s*(?:st|nd|rd|th)\b)\s*(a\.?m\.?|p\.?m\.?)?(?:\s*o'?\s*clock)?/gi,
    run: (m, ctx) => clock(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3] ?? null, ctx)
  },
  // 4pm, 4:30 pm, 4.30pm
  {
    re: /\b(\d{1,2})(?:[:.](\d{2}))?(?!\d)\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi,
    run: (m, ctx) => clock(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3], ctx)
  },
  // 16:00 — a colon only, so "3.5 hours" is never a time
  {
    re: /\b(\d{1,2}):(\d{2})(?!\d)/g,
    run: (m, ctx) => clock(Number(m[1]), Number(m[2]), null, ctx)
  }
]

// ---------------------------------------------------------------- recurrence

/**
 * "every 2 weeks", "each monday". Only the explicit `every`/`each` form counts —
 * matching a bare "weekly" would turn "weekly report" into a repeating task.
 */
const RECUR_RULE = new RegExp(
  `\\b(?:every|each)\\s+(other\\s+)?(\\d+\\s+)?(weekdays?|days?|weeks?|months?|years?|${WD})\\b`,
  'gi'
)

/** The repeat rule plus, for "every friday", the first day it falls on. */
function recurrence(m: RegExpExecArray, ctx: Ctx): { rule: string; date: Date | null } | null {
  const n = m[1] ? 2 : m[2] ? Number(m[2].trim()) : 1
  if (!Number.isFinite(n) || n < 1) return null
  const word = m[3].toLowerCase().replace(/s$/, '')

  const weekday = WEEKDAY_INDEX[word] ?? WEEKDAY_INDEX[m[3].toLowerCase()]
  if (weekday !== undefined) {
    return {
      rule: n === 2 ? 'fortnightly' : n === 1 ? 'weekly' : `every ${n} weeks`,
      date: upcomingWeekday(weekday, ctx)
    }
  }
  if (word === 'weekday') return { rule: 'weekdays', date: null }

  const plain: Record<string, string> = {
    day: 'daily',
    week: 'weekly',
    month: 'monthly',
    year: 'yearly'
  }
  if (!plain[word]) return null
  if (n === 1) return { rule: plain[word], date: null }
  if (n === 2 && word === 'week') return { rule: 'fortnightly', date: null }
  return { rule: `every ${n} ${word}s`, date: null }
}

function dayPartRule(words: string[]): Rule {
  return {
    re: new RegExp(`\\b(?:in\\s+the\\s+)?(${alt(words)})\\b`, 'gi'),
    run: (m) => {
      const part = ALL_DAY_PARTS[m[1].toLowerCase()]
      return { date: null, time: part.hhmm, pm: part.pm }
    }
  }
}

// ------------------------------------------------------------------- masking

/**
 * Regions the date scanner must not read: explicit task tokens, tags, links,
 * code and URLs. Blanked to spaces rather than removed so every index still
 * points at the original string.
 */
const PROTECTED: RegExp[] = [
  /`[^`]*`/g,
  /\[\[[^\]]*\]\]/g,
  /\]\([^)]*\)/g,
  /https?:\/\/\S+/g,
  /(?:^|\s)#[\p{L}\p{N}_\-/]+/gu,
  /(?:^|\s)[@~&]\S+/g,
  /(?:^|\s)![a-z]+\b/gi,
  /(?:^|\s)\+\d+(?:\.\d+)?[a-z]+\b/gi,
  /[\u{1F300}-\u{1FAFF}\u{2190}-\u{2BFF}]\s*\d{4}-\d{2}-\d{2}/gu
]

function mask(input: string): string {
  let out = input
  for (const re of PROTECTED) {
    out = out.replace(re, (hit) => ' '.repeat(hit.length))
  }
  return out
}

/** Words that only exist to introduce the date, and should vanish with it. */
const LEAD_INS = new Set(['on', 'by', 'at', 'due', 'before', 'until', 'till', 'the'])

/** Pull a span leftwards over "due by", so nothing dangles once it is cut. */
function absorbLeadIn(input: string, span: NLSpan): NLSpan {
  let start = span.start
  for (let i = 0; i < 2; i++) {
    let gap = start
    while (gap > 0 && /[ \t]/.test(input[gap - 1])) gap--
    if (gap === start || gap === 0) break
    let word = gap
    while (word > 0 && /[A-Za-z]/.test(input[word - 1])) word--
    if (word > 0 && !/[\s(]/.test(input[word - 1])) break
    if (!LEAD_INS.has(input.slice(word, gap).toLowerCase())) break
    start = word
  }
  return { start, end: span.end }
}

function cut(input: string, spans: NLSpan[]): string {
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const span of ordered) {
    if (span.start < cursor) continue
    out += input.slice(cursor, span.start)
    cursor = span.end
  }
  out += input.slice(cursor)
  return out
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;:\-–—]+\s*$/, '')
    .trim()
}

// -------------------------------------------------------------------- public

/**
 * Read a due date and time out of free text.
 *
 * Finds at most one date phrase and one time phrase, preferring the more
 * specific reading ("next friday" over "friday"). A time with no date rolls to
 * tomorrow when today's has already gone, matching how people speak: at 6pm,
 * "at 9" means tomorrow morning.
 */
export function parseNaturalDate(input: string, options: NLDateOptions = {}): NLDateResult {
  const now = options.now ?? new Date()
  const ctx: Ctx = {
    now,
    today: midnight(now),
    weekStartsOn: options.weekStartsOn ?? 1,
    dayFirst: options.dayFirst ?? localeDayFirst(),
    pm: null
  }

  let masked = mask(input)
  const spans: NLSpan[] = []
  let date: Date | null = null
  let time: string | null = null
  let repeat: string | null = null

  // Repeats claim their words first, so "every monday" is not read as "monday".
  RECUR_RULE.lastIndex = 0
  const recurMatch = RECUR_RULE.exec(masked)
  if (recurMatch) {
    const resolved = recurrence(recurMatch, ctx)
    if (resolved) {
      repeat = resolved.rule
      date = resolved.date
      const span = { start: recurMatch.index, end: recurMatch.index + recurMatch[0].length }
      spans.push(span)
      masked = blank(masked, span)
    }
  }

  const dateMatch = scan(DATE_RULES, masked, ctx)
  if (dateMatch) {
    date = dateMatch.hit.date
    time = dateMatch.hit.time
    ctx.pm = dateMatch.hit.pm
    spans.push(dateMatch.span)
    masked = blank(masked, dateMatch.span)
  }

  // Day parts run first so "tomorrow evening at 7" reads 7 as evening.
  const partWords = Object.keys(date ? ALL_DAY_PARTS : HARD_DAY_PARTS)
  const partMatch = scan([dayPartRule(partWords)], masked, ctx)
  if (partMatch) {
    time = partMatch.hit.time
    ctx.pm = partMatch.hit.pm
    spans.push(partMatch.span)
    masked = blank(masked, partMatch.span)
  }

  const clockMatch = scan(CLOCK_RULES, masked, ctx)
  if (clockMatch) {
    time = clockMatch.hit.time
    spans.push(clockMatch.span)
  }

  // A bare time is about the next time the clock reads that.
  if (!date && time) {
    const [h, mm] = time.split(':').map(Number)
    const todayAt = new Date(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate(), h, mm)
    date = todayAt.getTime() < now.getTime() ? addDays(ctx.today, 1) : ctx.today
  }

  // A repeat needs a day to count from, and "every day" plainly starts today.
  if (!date && repeat) date = ctx.today

  // "every weekday at 9am" added on a Friday afternoon starts Monday, not Saturday.
  if (date && repeat === 'weekdays') {
    while (date.getDay() === 0 || date.getDay() === 6) date = addDays(date, 1)
  }

  if (!date) {
    return { date: null, time: null, recurrence: null, text: input.trim(), spans: [] }
  }

  const absorbed = spans.map((span) => absorbLeadIn(input, span))
  return {
    date: toISODate(date),
    time,
    recurrence: repeat,
    text: cut(input, absorbed),
    spans: absorbed
  }
}

function blank(text: string, span: NLSpan): string {
  return text.slice(0, span.start) + ' '.repeat(span.end - span.start) + text.slice(span.end)
}

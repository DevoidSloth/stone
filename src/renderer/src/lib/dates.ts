import { toISODate } from '@shared/task-syntax'

export { toISODate }

export const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** Parse `YYYY-MM-DD` as a local date. `new Date(iso)` would read it as UTC. */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function addMonths(iso: string, months: number): string {
  const d = fromISODate(iso)
  const targetDay = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  // Clamp so 31 Jan + 1 month lands on 28/29 Feb rather than spilling into March.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(targetDay, lastDay))
  return toISODate(d)
}

export function startOfWeek(iso: string, weekStartsOn: 0 | 1): string {
  const d = fromISODate(iso)
  const shift = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - shift)
  return toISODate(d)
}

export function today(): string {
  return toISODate(new Date())
}

export function isToday(iso: string): boolean {
  return iso.slice(0, 10) === today()
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

/** Every `YYYY-MM-DD` in a year, in order. */
export function yearDays(year: number): string[] {
  const out: string[] = []
  const d = new Date(year, 0, 1)
  while (d.getFullYear() === year) {
    out.push(toISODate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** The 42 cells of a month grid, including the leading and trailing spill. */
export function monthGrid(anchorISO: string, weekStartsOn: 0 | 1): string[] {
  const anchor = fromISODate(anchorISO)
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = fromISODate(startOfWeek(toISODate(first), weekStartsOn))
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(toISODate(d))
  }
  return cells
}

export function formatTime(iso: string): string {
  if (!iso.includes('T')) return ''
  const [, time] = iso.split('T')
  const [h, m] = time.slice(0, 5).split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

export function formatRange(startISO: string, endISO: string, allDay: boolean): string {
  if (allDay) return 'All day'
  const start = formatTime(startISO)
  const end = formatTime(endISO)
  return end && end !== start ? `${start} – ${end}` : start
}

export function minutesInto(iso: string): number {
  if (!iso.includes('T')) return 0
  const [h, m] = iso.split('T')[1].slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

/** "Today", "Tomorrow", "3 days ago", else a short date. */
export function relativeDay(iso: string): string {
  const target = fromISODate(iso)
  const now = fromISODate(today())
  const diff = Math.round((target.getTime() - now.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return WEEKDAYS_LONG[target.getDay()]
  if (diff < 0 && diff > -7) return `${Math.abs(diff)} days ago`
  const sameYear = target.getFullYear() === now.getFullYear()
  return `${MONTHS[target.getMonth()].slice(0, 3)} ${target.getDate()}${sameYear ? '' : `, ${target.getFullYear()}`}`
}

export function formatLongDate(iso: string): string {
  const d = fromISODate(iso)
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

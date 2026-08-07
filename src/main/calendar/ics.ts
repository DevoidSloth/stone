import ICAL from 'ical.js'
import fs from 'node:fs/promises'
import type { CalEvent } from '@shared/types'

/** Malformed RRULEs can iterate forever; stop long before that becomes a hang. */
const MAX_OCCURRENCES = 2000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local wall-clock ISO. Calendars are read in the user's own time zone. */
function toLocalISO(date: Date, allDay: boolean): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return allDay ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function registerTimezones(root: ICAL.Component): void {
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      // Registering the component (not the Timezone) lets ical.js derive the tzid.
      const tz = new ICAL.Timezone(vtz)
      if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(vtz)
    } catch {
      // A bad VTIMEZONE should not sink the whole feed.
    }
  }
}

export interface IcsParseOptions {
  accountId: string
  color: string
  windowStart: Date
  windowEnd: Date
}

/**
 * Expand an ICS document into concrete events inside a window, including
 * recurring series and their per-instance overrides.
 */
export function parseIcs(text: string, options: IcsParseOptions): CalEvent[] {
  const { accountId, color, windowStart, windowEnd } = options
  const out: CalEvent[] = []

  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(text))
  } catch (err) {
    throw new Error(`That does not look like a valid calendar feed: ${(err as Error).message}`)
  }

  registerTimezones(root)

  const all = root.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c))
  const masters = all.filter((e) => !e.isRecurrenceException())
  const overrides = all.filter((e) => e.isRecurrenceException())

  for (const master of masters) {
    for (const override of overrides) {
      if (override.uid === master.uid) {
        try {
          master.relateException(override.component)
        } catch {
          // Override outside the series range; ical.js rejects it, which is fine.
        }
      }
    }
  }

  const push = (
    event: ICAL.Event,
    start: Date,
    end: Date,
    allDay: boolean,
    suffix: string
  ): void => {
    out.push({
      id: `ics:${accountId}:${event.uid}${suffix}`,
      accountId,
      source: 'ics',
      title: event.summary || '(no title)',
      start: toLocalISO(start, allDay),
      end: toLocalISO(end, allDay),
      allDay,
      location: event.location || null,
      notes: event.description || null,
      relPath: null,
      readOnly: true,
      color
    })
  }

  for (const event of masters) {
    if (!event.startDate) continue
    const allDay = Boolean(event.startDate.isDate)

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate()
      const end = event.endDate ? event.endDate.toJSDate() : new Date(start.getTime() + 3600_000)
      if (end >= windowStart && start <= windowEnd) push(event, start, end, allDay, '')
      continue
    }

    try {
      const iterator = event.iterator()
      let next: ICAL.Time | null
      let count = 0
      while ((next = iterator.next()) && count < MAX_OCCURRENCES) {
        count++
        const startDate = next.toJSDate()
        if (startDate > windowEnd) break

        const details = event.getOccurrenceDetails(next)
        const occStart = details.startDate.toJSDate()
        const occEnd = details.endDate.toJSDate()
        if (occEnd < windowStart) continue

        push(details.item, occStart, occEnd, allDay, `:${next.toString()}`)
      }
    } catch {
      // Unexpandable series: fall back to the master instance so it is not lost.
      const start = event.startDate.toJSDate()
      const end = event.endDate ? event.endDate.toJSDate() : new Date(start.getTime() + 3600_000)
      if (end >= windowStart && start <= windowEnd) push(event, start, end, allDay, '')
    }
  }

  return out
}

/** `webcal://` is just `https://` with a scheme that opens a calendar client. */
export function normalizeFeedUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://')
}

export async function fetchIcs(url: string): Promise<string> {
  const target = normalizeFeedUrl(url)

  if (/^file:\/\//i.test(target) || /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/')) {
    const filePath = target.replace(/^file:\/\//i, '')
    return fs.readFile(decodeURIComponent(filePath), 'utf8')
  }

  const response = await fetch(target, {
    headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'Stone/0.1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    throw new Error(`The calendar server returned ${response.status} ${response.statusText}.`)
  }
  return response.text()
}

// --------------------------------------------------------------- generating

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** RFC 5545 caps lines at 75 octets; continuations start with a single space. */
function fold(line: string): string {
  if (line.length <= 73) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 73))
  rest = rest.slice(73)
  while (rest.length > 72) {
    parts.push(` ${rest.slice(0, 72)}`)
    rest = rest.slice(72)
  }
  if (rest.length) parts.push(` ${rest}`)
  return parts.join('\r\n')
}

function toUtcStamp(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function toDateStamp(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

/** Export events as an ICS file, for importing into any other calendar app. */
export function buildIcs(events: CalEvent[], calendarName = 'Stone'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stone//Notes Tasks Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`
  ]

  for (const event of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.id.replace(/[^A-Za-z0-9:_.-]/g, '-')}@stone`)
    lines.push(`DTSTAMP:${toUtcStamp(new Date().toISOString())}`)
    if (event.allDay) {
      const endExclusive = new Date(`${event.end.slice(0, 10)}T00:00:00`)
      endExclusive.setDate(endExclusive.getDate() + 1)
      lines.push(`DTSTART;VALUE=DATE:${toDateStamp(event.start)}`)
      lines.push(`DTEND;VALUE=DATE:${toDateStamp(endExclusive.toISOString())}`)
    } else {
      lines.push(`DTSTART:${toUtcStamp(event.start)}`)
      lines.push(`DTEND:${toUtcStamp(event.end)}`)
    }
    lines.push(fold(`SUMMARY:${icsEscape(event.title)}`))
    if (event.location) lines.push(fold(`LOCATION:${icsEscape(event.location)}`))
    if (event.notes) lines.push(fold(`DESCRIPTION:${icsEscape(event.notes)}`))
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

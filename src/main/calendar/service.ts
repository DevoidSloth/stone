import type { CalEvent, CalendarAccount, NoteMeta, Settings, Task } from '@shared/types'
import type { Vault } from '../vault/store'
import { fetchIcs, parseIcs } from './ics'
import * as graph from './graph'
import { isMac, listMacCalendars, listMacEvents, removeMacEvent, saveMacEvent } from './macos'

const FEED_TTL_MS = 10 * 60 * 1000

interface FeedCache {
  text: string
  fetchedAt: number
}

const feedCache = new Map<string, FeedCache>()

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function timeStringOf(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [h, m] = value.trim().split(':')
    return `${pad(Number(h))}:${m}`
  }
  if (value instanceof Date) return `${pad(value.getHours())}:${pad(value.getMinutes())}`
  /*
   * gray-matter parses frontmatter with js-yaml 3, which still honours the
   * YAML 1.1 sexagesimal integer rule: an unquoted `17:00` arrives here as
   * 1020, not as a string. Without this branch every unquoted time in a note
   * is silently dropped and the note never becomes an event.
   */
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440) {
    return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
  }
  return null
}

function isoDateOf(value: unknown): string | null {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    if (m) return m[1]
  }
  return null
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() + minutes)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Notes become events when their frontmatter says when they happen.
 *
 *   date: 2026-08-12   start: 14:00   end: 15:30
 *   start: 2026-08-12T14:00           duration: 90
 *
 * A note with only a `date` is an all-day entry.
 */
export function eventsFromNotes(notes: NoteMeta[], from: string, to: string): CalEvent[] {
  const out: CalEvent[] = []

  for (const note of notes) {
    const fm = note.frontmatter
    const explicitStart = typeof fm.start === 'string' && fm.start.includes('T') ? fm.start : null
    const day = isoDateOf(fm.date ?? fm.day) ?? note.date
    if (!explicitStart && !day) continue

    const startTime = timeStringOf(fm.start ?? fm.time)
    const endTime = timeStringOf(fm.end)
    const allDay = !explicitStart && !startTime

    // A bare `date:` only anchors a note to a day — every daily note has one,
    // and turning those into all-day events would bury the real calendar.
    // Becoming an event takes an explicit time, or `event: true`.
    const isEvent =
      Boolean(explicitStart || startTime || endTime || fm.duration) || fm.event === true
    if (!isEvent) continue

    let start: string
    let end: string

    if (explicitStart) {
      start = explicitStart.slice(0, 16)
      end =
        typeof fm.end === 'string' && fm.end.includes('T')
          ? fm.end.slice(0, 16)
          : addMinutes(start, Number(fm.duration ?? 60))
    } else if (startTime) {
      start = `${day}T${startTime}`
      end = endTime ? `${day}T${endTime}` : addMinutes(start, Number(fm.duration ?? 60))
    } else {
      start = day!
      end = isoDateOf(fm.end) ?? day!
    }

    if (end.slice(0, 10) < from || start.slice(0, 10) > to) continue

    out.push({
      id: `stone:${note.relPath}`,
      accountId: 'stone',
      source: 'stone',
      title: note.title,
      start,
      end,
      allDay,
      location: typeof fm.location === 'string' ? fm.location : null,
      notes: note.excerpt,
      relPath: note.relPath,
      readOnly: false,
      color: null
    })
  }

  return out
}

/** Tasks with a due time show up as short blocks; date-only ones stay all-day. */
export function eventsFromTasks(tasks: Task[], from: string, to: string): CalEvent[] {
  return tasks
    .filter((t) => t.due && t.status !== 'cancelled')
    .filter((t) => {
      const day = t.due!.slice(0, 10)
      return day >= from && day <= to
    })
    .map<CalEvent>((task) => {
      const timed = task.due!.includes('T')
      return {
        id: `task:${task.id}`,
        accountId: 'stone-tasks',
        source: 'stone',
        title: task.text,
        start: timed ? task.due!.slice(0, 16) : task.due!.slice(0, 10),
        end: timed ? addMinutes(task.due!.slice(0, 16), task.estimate ?? 30) : task.due!.slice(0, 10),
        allDay: !timed,
        location: null,
        notes: null,
        relPath: task.relPath,
        readOnly: false,
        color: null
      }
    })
}

export class CalendarService {
  constructor(private vault: Vault) {}

  /** Every calendar Stone can currently see, across all sources. */
  async listAccounts(settings: Settings): Promise<{ accounts: CalendarAccount[]; errors: string[] }> {
    const accounts: CalendarAccount[] = [
      { id: 'stone', source: 'stone', name: 'Vault notes', color: '#D9A441', writable: true, enabled: true },
      { id: 'stone-tasks', source: 'stone', name: 'Tasks', color: '#6E7BFF', writable: true, enabled: true }
    ]
    const errors: string[] = []

    if (isMac()) {
      try {
        accounts.push(...(await listMacCalendars()))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }

    if (await graph.isConnected()) {
      try {
        accounts.push(...(await graph.listGraphCalendars()))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }

    for (const sub of settings.icsSubscriptions) {
      accounts.push({
        id: sub.id,
        source: 'ics',
        name: sub.name,
        color: sub.color,
        writable: false,
        enabled: true
      })
    }

    // Preserve the user's enable/disable choices across restarts.
    const saved = new Map(settings.calendars.map((c) => [c.id, c.enabled]))
    for (const account of accounts) {
      if (saved.has(account.id)) account.enabled = saved.get(account.id)!
    }

    return { accounts, errors }
  }

  private enabledIds(settings: Settings, source: CalendarAccount['source']): string[] | null {
    const configured = settings.calendars.filter((c) => c.source === source)
    if (configured.length === 0) return []
    const enabled = configured.filter((c) => c.enabled).map((c) => c.id)
    return enabled
  }

  private isEnabled(settings: Settings, id: string): boolean {
    const found = settings.calendars.find((c) => c.id === id)
    return found ? found.enabled : true
  }

  /**
   * Merge every source for a window. Remote failures are reported alongside the
   * events rather than thrown, so one dead feed cannot blank the calendar.
   */
  async eventsInRange(
    settings: Settings,
    fromISO: string,
    toISO: string
  ): Promise<{ events: CalEvent[]; errors: string[] }> {
    const from = fromISO.slice(0, 10)
    const to = toISO.slice(0, 10)
    const errors: string[] = []
    const events: CalEvent[] = []

    if (this.isEnabled(settings, 'stone')) {
      events.push(...eventsFromNotes(this.vault.listNotes(), from, to))
    }
    if (this.isEnabled(settings, 'stone-tasks')) {
      events.push(...eventsFromTasks(this.vault.allTasks(), from, to))
    }

    const rangeStart = `${from}T00:00:00`
    const rangeEnd = `${to}T23:59:59`

    const jobs: Promise<void>[] = []

    if (isMac()) {
      const ids = this.enabledIds(settings, 'macos')
      jobs.push(
        (async () => {
          try {
            events.push(...(await listMacEvents(rangeStart, rangeEnd, ids ?? [])))
          } catch (err) {
            errors.push(`Apple Calendar: ${(err as Error).message}`)
          }
        })()
      )
    }

    if (await graph.isConnected()) {
      const ids = this.enabledIds(settings, 'graph')
      jobs.push(
        (async () => {
          try {
            events.push(...(await graph.listGraphEvents(rangeStart, rangeEnd, ids ?? [])))
          } catch (err) {
            errors.push(`Outlook: ${(err as Error).message}`)
          }
        })()
      )
    }

    for (const sub of settings.icsSubscriptions) {
      if (!this.isEnabled(settings, sub.id)) continue
      jobs.push(
        (async () => {
          try {
            const cached = feedCache.get(sub.url)
            let text: string
            if (cached && Date.now() - cached.fetchedAt < FEED_TTL_MS) {
              text = cached.text
            } else {
              text = await fetchIcs(sub.url)
              feedCache.set(sub.url, { text, fetchedAt: Date.now() })
            }
            events.push(
              ...parseIcs(text, {
                accountId: sub.id,
                color: sub.color,
                windowStart: new Date(rangeStart),
                windowEnd: new Date(rangeEnd)
              })
            )
          } catch (err) {
            errors.push(`${sub.name}: ${(err as Error).message}`)
          }
        })()
      )
    }

    await Promise.all(jobs)
    events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    return { events, errors }
  }

  /** Force the next range query to refetch every subscribed feed. */
  clearFeedCache(): void {
    feedCache.clear()
  }

  async saveExternalEvent(
    account: CalendarAccount,
    input: {
      id?: string
      title: string
      start: string
      end: string
      allDay: boolean
      location?: string | null
      notes?: string | null
    }
  ): Promise<string> {
    if (account.source === 'macos') {
      return saveMacEvent({ ...input, calendarId: account.id })
    }
    if (account.source === 'graph') {
      return graph.saveGraphEvent({ ...input, calendarId: account.id })
    }
    throw new Error(`${account.name} is read-only.`)
  }

  async removeExternalEvent(id: string): Promise<void> {
    if (id.startsWith('macos:')) return removeMacEvent(id)
    if (id.startsWith('graph:')) return graph.removeGraphEvent(id)
    throw new Error('That event cannot be deleted from Stone.')
  }
}

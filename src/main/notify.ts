import { Notification } from 'electron'
import type { Task } from '@shared/types'

/**
 * Due-time reminders.
 *
 * Stone has always known when a task is due, and never did anything with it.
 * A scheduler in main polls the task list once a minute and fires an OS
 * notification as each one comes inside the lead window.
 *
 * The poll is deliberate rather than a timer per item: a vault can hold
 * thousands of dated tasks, and a rescheduled `setTimeout` for each one would
 * have to be torn down and rebuilt on every keystroke that touches a date.
 */

const TICK_MS = 60_000

/** Keys already fired, so an item never notifies twice in one session. */
const fired = new Set<string>()

export interface ReminderSource {
  tasks: () => Task[]
}

export interface ReminderOptions {
  enabled: boolean
  leadMinutes: number
}

let timer: NodeJS.Timeout | null = null

function toTime(value: string): number | null {
  // A bare date carries no time of day, so it cannot have a moment to fire at.
  if (!value.includes('T')) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function fire(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, silent: false })
  if (onClick) notification.on('click', onClick)
  notification.show()
}

/**
 * Check the window once. Exported so the caller can force a pass immediately
 * after settings change rather than waiting out the current tick.
 */
export async function checkReminders(
  source: ReminderSource,
  options: ReminderOptions,
  onFire?: (payload: { title: string; body: string; relPath: string | null }) => void
): Promise<void> {
  if (!options.enabled) return

  const now = Date.now()
  const lead = Math.max(0, options.leadMinutes) * 60_000
  const horizon = now + lead

  for (const task of source.tasks()) {
    if (task.status === 'done' || task.status === 'cancelled') continue
    const at = toTime(task.due ?? '') ?? toTime(task.scheduled ?? '')
    if (at === null) continue
    // Anything already past its moment has been missed, not reminded about.
    if (at < now || at > horizon) continue

    const key = `task:${task.relPath}:${task.line}:${at}`
    if (fired.has(key)) continue
    fired.add(key)

    const minutes = Math.max(0, Math.round((at - now) / 60_000))
    const body = minutes === 0 ? 'Due now' : `Due in ${minutes} min · ${task.relPath.replace(/\.md$/, '')}`
    fire(task.text || 'Task', body)
    onFire?.({ title: task.text || 'Task', body, relPath: task.relPath })
  }

  // The fired set would otherwise grow for the life of the process. Anything
  // older than the horizon can never match again, so it is safe to forget.
  if (fired.size > 500) fired.clear()
}

export function startReminders(
  source: ReminderSource,
  getOptions: () => ReminderOptions,
  onFire?: (payload: { title: string; body: string; relPath: string | null }) => void
): void {
  stopReminders()
  timer = setInterval(() => {
    void checkReminders(source, getOptions(), onFire)
  }, TICK_MS)
  void checkReminders(source, getOptions(), onFire)
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}

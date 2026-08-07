import { useEffect, useMemo } from 'react'
import { compareTasks, dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { colorFor } from './CalendarView'
import { TaskRow } from './TasksView'
import { Editor } from '../editor/Editor'
import {
  addDays,
  formatRange,
  fromISODate,
  MONTHS,
  today,
  WEEKDAYS_LONG
} from '../lib/dates'
import { IconCalendar, IconCheck, IconClock, IconLayers, IconPlus, IconTasks } from '../ui/icons'

/**
 * Today is where the three halves of Stone meet, so it is the one screen that
 * shows all of them at once: what is happening, what is owed, and the page you
 * write the day onto. The agenda column is hidden here — this view is the
 * agenda, at full size.
 */
export function TodayView() {
  const day = today()
  const events = useStone((s) => s.events)
  const tasks = useStone((s) => s.tasks)
  const accounts = useStone((s) => s.accounts)
  const activity = useStone((s) => s.activity)
  const notes = useStone((s) => s.notes)
  const tags = useStone((s) => s.tags)
  const dailyRelPath = useStone((s) => s.dailyRelPath)
  const dailyContent = useStone((s) => s.dailyContent)
  const loadDaily = useStone((s) => s.loadDaily)
  const setDailyDraft = useStone((s) => s.setDailyDraft)
  const openNote = useStone((s) => s.openNote)
  const createNote = useStone((s) => s.createNote)
  const setQuickAdd = useStone((s) => s.setQuickAdd)
  const setView = useStone((s) => s.setView)

  const date = fromISODate(day)

  useEffect(() => {
    void loadDaily(day)
  }, [day, loadDaily])

  /** Same resolution rule as the full page editor: open it, or create it. */
  const openWikilink = (target: string): void => {
    const needle = target.toLowerCase().replace(/\.md$/, '')
    const hit =
      notes.find((n) => n.relPath.replace(/\.md$/, '').toLowerCase() === needle) ??
      notes.find((n) => n.relPath.split('/').pop()!.replace(/\.md$/, '').toLowerCase() === needle) ??
      notes.find((n) => n.title.toLowerCase() === needle)
    if (hit) void openNote(hit.relPath)
    else void createNote(target)
  }

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => !e.id.startsWith('task:'))
        .filter((e) => e.start.slice(0, 10) <= day && e.end.slice(0, 10) >= day)
        .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1)),
    [events, day]
  )

  const dueToday = useMemo(
    () => tasks.filter((t) => t.status !== 'cancelled' && dueDay(t.due) === day).sort(compareTasks),
    [tasks, day]
  )

  const overdue = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
        .filter((t) => {
          const due = dueDay(t.due)
          return Boolean(due && due < day)
        })
        .sort(compareTasks),
    [tasks, day]
  )

  const doneToday = dueToday.filter((t) => t.status === 'done').length

  /** Consecutive days with any recorded activity, counting back from today. */
  const streak = useMemo(() => {
    let count = 0
    let cursor = day
    while (activity[cursor] && count < 999) {
      count++
      cursor = addDays(cursor, -1)
    }
    return count
  }, [activity, day])

  const nextUp = dayEvents.find((e) => !e.allDay && e.start.slice(11, 16) >= new Date().toTimeString().slice(0, 5))

  const summary = (): string => {
    const bits: string[] = []
    if (dayEvents.length) bits.push(`${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`)
    if (dueToday.length) bits.push(`${dueToday.length} due`)
    if (overdue.length) bits.push(`${overdue.length} overdue`)
    if (!bits.length) return 'Nothing scheduled. The day is yours.'
    return bits.join(' · ')
  }

  return (
    <div className="today">
      <header className="today__masthead">
        <div className="today__dateblock">
          <span className="today__dow">{WEEKDAYS_LONG[date.getDay()]}</span>
          <h1 className="today__date">
            {date.getDate()} <em>{MONTHS[date.getMonth()]}</em>
          </h1>
          <span className="today__summary">{summary()}</span>
        </div>

        <div className="today__stats">
          <Stat icon={<IconClock size={14} />} value={dayEvents.length} label="Events" />
          <Stat icon={<IconTasks size={14} />} value={dueToday.length} label="Due" tone={overdue.length ? 'rose' : undefined} />
          <Stat icon={<IconCheck size={14} />} value={doneToday} label="Done" tone="jade" />
          <Stat icon={<IconLayers size={14} />} value={streak} label={streak === 1 ? 'Day streak' : 'Day streak'} tone="citrine" />
        </div>
      </header>

      <div className="today__columns">
        <section className="today__col">
          <div className="today__colhead">
            <span className="eyebrow">Schedule</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView('calendar')}>
              <IconCalendar size={12} />
              Calendar
            </button>
          </div>

          {dayEvents.length === 0 ? (
            <div className="today__blank">
              <p>No events today.</p>
              <span>
                Connect a calendar in Settings, or give any note a <code>date:</code> to place it
                here.
              </span>
            </div>
          ) : (
            <div className="today__timeline stagger">
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`tevent ${event.id === nextUp?.id ? 'tevent--next' : ''}`}
                  style={{ '--chip': colorFor(event, accounts) } as React.CSSProperties}
                  onClick={() => (event.relPath ? void openNote(event.relPath) : undefined)}
                >
                  <span className="tevent__time">
                    {event.allDay ? 'All day' : formatRange(event.start, event.end, false)}
                  </span>
                  <span className="tevent__bar" />
                  <span className="tevent__body">
                    <b className="truncate">{event.title}</b>
                    {event.location && <span className="truncate">{event.location}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="today__col">
          <div className="today__colhead">
            <span className="eyebrow">
              {overdue.length > 0 ? 'Due and overdue' : 'Due today'}
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQuickAdd(true)}>
              <IconPlus size={12} />
              Add
            </button>
          </div>

          {dueToday.length === 0 && overdue.length === 0 ? (
            <div className="today__blank">
              <p>Nothing due.</p>
              <span>
                Write <code>- [ ] something @today</code> in any note and it lands here.
              </span>
            </div>
          ) : (
            <div className="today__tasks stagger">
              {overdue.map((task) => (
                <TaskRow key={task.id} task={task} showSource={false} />
              ))}
              {dueToday.map((task) => (
                <TaskRow key={task.id} task={task} showSource={false} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="today__journal">
        <div className="today__colhead">
          <span className="eyebrow">Journal</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => dailyRelPath && void openNote(dailyRelPath)}
          >
            Open as page
          </button>
        </div>
        {dailyRelPath ? (
          <div className="today__editor">
            <Editor
              docKey={dailyRelPath}
              value={dailyContent}
              onChange={setDailyDraft}
              notes={notes}
              tags={tags}
              onOpenWikilink={openWikilink}
              onSelectTag={() => undefined}
            />
          </div>
        ) : (
          <div className="today__blank">
            <p>Opening the day note…</p>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
  tone
}: {
  icon: React.ReactNode
  value: number
  label: string
  tone?: 'jade' | 'rose' | 'citrine'
}) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <span className="stat__icon">{icon}</span>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  )
}

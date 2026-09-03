import { useMemo } from 'react'
import { compareTasks, dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { colorFor } from './CalendarView'
import { TaskRow } from './TasksView'
import { formatRange, fromISODate, isToday, MONTHS, relativeDay, today, WEEKDAYS_LONG } from '../lib/dates'
import { IconArrowRight, IconPlus } from '../ui/icons'

/**
 * The day column. Whatever you are doing in the main pane, the day you selected
 * is here: what is scheduled, what is due, and a way into the day's note. This
 * is the whole premise of the app made visible at all times.
 */
export function AgendaPane() {
  const selectedDay = useStone((s) => s.selectedDay)
  const events = useStone((s) => s.events)
  const tasks = useStone((s) => s.tasks)
  const accounts = useStone((s) => s.accounts)
  const notes = useStone((s) => s.notes)
  const openDaily = useStone((s) => s.openDaily)
  const openNote = useStone((s) => s.openNote)
  const setQuickAdd = useStone((s) => s.setQuickAdd)
  const setSelectedDay = useStone((s) => s.setSelectedDay)

  const date = fromISODate(selectedDay)

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => !e.id.startsWith('task:'))
        .filter((e) => e.start.slice(0, 10) <= selectedDay && e.end.slice(0, 10) >= selectedDay)
        .sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
          return a.start.localeCompare(b.start)
        }),
    [events, selectedDay]
  )

  const dayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'cancelled' && dueDay(t.due) === selectedDay)
        .sort(compareTasks),
    [tasks, selectedDay]
  )

  const overdue = useMemo(() => {
    if (!isToday(selectedDay)) return []
    const now = today()
    return tasks
      .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
      .filter((t) => {
        const due = dueDay(t.due)
        return Boolean(due && due < now)
      })
      .sort(compareTasks)
      .slice(0, 6)
  }, [tasks, selectedDay])

  const dailyNote = notes.find((n) => n.date === selectedDay)
  const empty = dayEvents.length === 0 && dayTasks.length === 0 && overdue.length === 0

  return (
    <aside className="agenda">
      <div className="agenda__inner">
        <header className="agenda__head">
          <span className="agenda__day">{date.getDate()}</span>
          <div className="agenda__dow">
            <b>{WEEKDAYS_LONG[date.getDay()]}</b>
            <span>
              {MONTHS[date.getMonth()]} {date.getFullYear()} · {relativeDay(selectedDay)}
            </span>
          </div>
          {!isToday(selectedDay) && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setSelectedDay(today())}
            >
              Today
            </button>
          )}
        </header>

        <div className="agenda__body">
          {overdue.length > 0 && (
            <section className="agenda__section">
              <div className="eyebrow" style={{ color: 'var(--red)' }}>
                Overdue
              </div>
              {overdue.map((task) => (
                <TaskRow key={task.id} task={task} showSource={false} />
              ))}
            </section>
          )}

          <section className="agenda__section">
            <div className="eyebrow">Schedule</div>
            {dayEvents.length === 0 ? (
              <p className="empty__body" style={{ textAlign: 'left' }}>
                Nothing scheduled.
              </p>
            ) : (
              dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="arow"
                  style={{ '--chip': colorFor(event, accounts) } as React.CSSProperties}
                  onClick={() => (event.relPath ? void openNote(event.relPath) : undefined)}
                >
                  <span className="arow__time" style={{ width: 62 }}>
                    {event.allDay ? 'All day' : formatRange(event.start, event.end, false)}
                  </span>
                  <span className="arow__bar" />
                  <span className="arow__title truncate" style={{ fontSize: 'var(--t-base)' }}>
                    {event.title}
                  </span>
                </button>
              ))
            )}
          </section>

          <section className="agenda__section">
            <div className="eyebrow">
              Due
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                style={{ marginLeft: 'auto' }}
                data-tip="Add a task"
                aria-label="Add a task"
                onClick={() => setQuickAdd(true)}
              >
                <IconPlus size={12} />
              </button>
            </div>
            {dayTasks.length === 0 ? (
              <p className="empty__body" style={{ textAlign: 'left' }}>
                Nothing due.
              </p>
            ) : (
              dayTasks.map((task) => <TaskRow key={task.id} task={task} showSource={false} />)
            )}
          </section>

          {empty && (
            <p className="empty__body" style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              A clear day. Good time to write something down.
            </p>
          )}

          <button
            type="button"
            className="btn"
            style={{ justifyContent: 'space-between' }}
            onClick={() => void openDaily(selectedDay)}
          >
            {dailyNote ? 'Open the day note' : 'Start a note for this day'}
            <IconArrowRight size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}

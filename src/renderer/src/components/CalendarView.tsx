import { useMemo, useState } from 'react'
import type { CalEvent } from '@shared/types'
import { useStone, type CalendarMode } from '../store'
import {
  addDays,
  addMonths,
  formatRange,
  formatTime,
  fromISODate,
  isToday,
  minutesInto,
  MONTHS,
  monthGrid,
  relativeDay,
  startOfWeek,
  today,
  WEEKDAYS_LONG
} from '../lib/dates'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPin,
  IconPlus,
  IconRefresh,
  IconNote
} from '../ui/icons'

const HOUR_PX = 46
const DAY_START_HOUR = 6

export function colorFor(event: CalEvent, accounts: { id: string; color: string }[]): string {
  if (event.color) return event.color
  const account = accounts.find((a) => a.id === event.accountId)
  if (account) return account.color
  return event.id.startsWith('task:') ? 'var(--iris)' : 'var(--citrine)'
}

/** Index events by day, expanding multi-day spans onto each day they cover. */
function byDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  const push = (day: string, event: CalEvent): void => {
    const list = map.get(day)
    if (list) list.push(event)
    else map.set(day, [event])
  }

  for (const event of events) {
    const start = event.start.slice(0, 10)
    const end = event.end.slice(0, 10)
    if (end <= start) {
      push(start, event)
      continue
    }
    let cursor = start
    let guard = 0
    while (cursor <= end && guard < 400) {
      push(cursor, event)
      cursor = addDays(cursor, 1)
      guard++
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return a.start.localeCompare(b.start)
    })
  }
  return map
}

export function CalendarView() {
  const events = useStone((s) => s.events)
  const accounts = useStone((s) => s.accounts)
  const errors = useStone((s) => s.calendarErrors)
  const loading = useStone((s) => s.calendarLoading)
  const anchor = useStone((s) => s.anchor)
  const selectedDay = useStone((s) => s.selectedDay)
  const mode = useStone((s) => s.calendarMode)
  const settings = useStone((s) => s.settings)
  const setAnchor = useStone((s) => s.setAnchor)
  const setSelectedDay = useStone((s) => s.setSelectedDay)
  const setCalendarMode = useStone((s) => s.setCalendarMode)
  const loadCalendar = useStone((s) => s.loadCalendar)
  const openDaily = useStone((s) => s.openDaily)

  const [active, setActive] = useState<CalEvent | null>(null)

  const weekStartsOn = settings?.weekStartsOn ?? 1
  const grouped = useMemo(() => byDay(events), [events])
  const anchorDate = fromISODate(anchor)

  const step = (direction: number): void => {
    if (mode === 'month') setAnchor(addMonths(anchor, direction))
    else if (mode === 'week') setAnchor(addDays(anchor, direction * 7))
    else setAnchor(addDays(anchor, direction * 14))
  }

  return (
    <div className="cal">
      <div className="cal__head">
        <div>
          <div className="cal__month">{MONTHS[anchorDate.getMonth()]}</div>
        </div>
        <span className="cal__year">{anchorDate.getFullYear()}</span>

        <div className="cal__nav">
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => step(-1)}
            aria-label="Previous"
          >
            <IconChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setAnchor(today())
              setSelectedDay(today())
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => step(1)}
            aria-label="Next"
          >
            <IconChevronRight size={14} />
          </button>
        </div>

        <div className="cal__tools">
          <div className="segmented">
            {(['month', 'week', 'agenda'] as CalendarMode[]).map((id) => (
              <button
                key={id}
                type="button"
                className="segmented__btn"
                aria-selected={mode === id}
                onClick={() => setCalendarMode(id)}
              >
                {id[0].toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title="Refresh connected calendars"
            aria-label="Refresh connected calendars"
            onClick={() => void loadCalendar(true)}
          >
            <IconRefresh size={14} style={{ opacity: loading ? 0.4 : 1 }} />
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void openDaily(selectedDay)}>
            <IconPlus size={13} />
            Day note
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ padding: '0 var(--sp-4) var(--sp-3)' }}>
          <div className="banner">
            <span>{errors.join(' · ')}</span>
          </div>
        </div>
      )}

      {mode === 'month' && (
        <MonthGrid
          anchor={anchor}
          selectedDay={selectedDay}
          weekStartsOn={weekStartsOn}
          grouped={grouped}
          accounts={accounts}
          onSelectDay={setSelectedDay}
          onOpenEvent={setActive}
        />
      )}

      {mode === 'week' && (
        <WeekGrid
          anchor={anchor}
          weekStartsOn={weekStartsOn}
          grouped={grouped}
          accounts={accounts}
          onSelectDay={setSelectedDay}
          onOpenEvent={setActive}
        />
      )}

      {mode === 'agenda' && (
        <AgendaList anchor={anchor} grouped={grouped} accounts={accounts} onOpenEvent={setActive} />
      )}

      {active && <EventCard event={active} accounts={accounts} onClose={() => setActive(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------- month

interface GridProps {
  anchor: string
  selectedDay?: string
  weekStartsOn: 0 | 1
  grouped: Map<string, CalEvent[]>
  accounts: { id: string; color: string }[]
  onSelectDay: (day: string) => void
  onOpenEvent: (event: CalEvent) => void
}

function MonthGrid({
  anchor,
  selectedDay,
  weekStartsOn,
  grouped,
  accounts,
  onSelectDay,
  onOpenEvent
}: GridProps) {
  const cells = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn])
  const month = fromISODate(anchor).getMonth()
  const headers = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAYS_LONG[(i + weekStartsOn) % 7]),
    [weekStartsOn]
  )

  return (
    <>
      <div className="cal__weekdays">
        {headers.map((name) => (
          <div key={name} className="cal__weekday">
            {name.slice(0, 3)}
          </div>
        ))}
      </div>

      <div className="cal__grid">
        {cells.map((day) => {
          const list = grouped.get(day) ?? []
          const outside = fromISODate(day).getMonth() !== month
          const classes = ['day']
          if (outside) classes.push('day--outside')
          if (isToday(day)) classes.push('day--today')
          if (day === selectedDay) classes.push('day--selected')

          return (
            <div
              key={day}
              className={classes.join(' ')}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectDay(day)
                }
              }}
            >
              <span className="day__num">{fromISODate(day).getDate()}</span>
              <div className="day__events">
                {list.slice(0, 4).map((event) => (
                  <EventChip
                    key={`${event.id}-${day}`}
                    event={event}
                    accounts={accounts}
                    onOpen={onOpenEvent}
                  />
                ))}
                {list.length > 4 && <span className="day__more">+{list.length - 4} more</span>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function EventChip({
  event,
  accounts,
  onOpen
}: {
  event: CalEvent
  accounts: { id: string; color: string }[]
  onOpen: (event: CalEvent) => void
}) {
  const isTask = event.id.startsWith('task:')
  return (
    <button
      type="button"
      className={`chip ${isTask ? 'chip--task' : ''}`}
      style={{ '--chip': colorFor(event, accounts) } as React.CSSProperties}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(event)
      }}
      title={event.title}
    >
      <span className="chip__dot" />
      {!event.allDay && <span className="chip__time">{formatTime(event.start)}</span>}
      <span className="chip__label">{event.title}</span>
    </button>
  )
}

// -------------------------------------------------------------------- week

function WeekGrid({ anchor, weekStartsOn, grouped, accounts, onSelectDay, onOpenEvent }: GridProps) {
  const start = startOfWeek(anchor, weekStartsOn)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start])
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()
  const topOf = (minutes: number): number => ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_PX
  const hours = Array.from({ length: 24 - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR)

  return (
    <div className="week">
      <div className="week__cols">
        <div />
        {days.map((day) => (
          <button
            key={day}
            type="button"
            className={`week__colhead ${isToday(day) ? 'week__colhead--today' : ''}`}
            onClick={() => onSelectDay(day)}
          >
            <span className="week__dow">{WEEKDAYS_LONG[fromISODate(day).getDay()].slice(0, 3)}</span>
            <span className="week__num">{fromISODate(day).getDate()}</span>
          </button>
        ))}
      </div>

      <div className="week__allday">
        <div className="week__alldaylabel">all day</div>
        {days.map((day) => (
          <div key={day} className="week__alldaycol">
            {(grouped.get(day) ?? [])
              .filter((e) => e.allDay)
              .slice(0, 3)
              .map((event) => (
                <EventChip
                  key={`${event.id}-${day}`}
                  event={event}
                  accounts={accounts}
                  onOpen={onOpenEvent}
                />
              ))}
          </div>
        ))}
      </div>

      <div className="week__scroll">
        <div className="week__body">
          <div className="week__gutter">
            {hours.map((h) => (
              <div key={h} className="week__hour">
                {h === 0 ? '' : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const timed = (grouped.get(day) ?? []).filter((e) => !e.allDay)
            return (
              <div
                key={day}
                className="week__col"
                style={{ height: hours.length * HOUR_PX }}
                onDoubleClick={() => onSelectDay(day)}
              >
                {isToday(day) && nowMinutes >= DAY_START_HOUR * 60 && (
                  <div className="week__now" style={{ top: topOf(nowMinutes) }} />
                )}
                {timed.map((event) => {
                  const startMin = Math.max(minutesInto(event.start), DAY_START_HOUR * 60)
                  const endMin = Math.max(minutesInto(event.end), startMin + 25)
                  return (
                    <button
                      key={`${event.id}-${day}`}
                      type="button"
                      className="wevent"
                      style={
                        {
                          top: topOf(startMin),
                          height: Math.max(((endMin - startMin) / 60) * HOUR_PX - 2, 18),
                          '--chip': colorFor(event, accounts)
                        } as React.CSSProperties
                      }
                      onClick={() => onOpenEvent(event)}
                    >
                      <b>{event.title}</b>
                      <span>{formatTime(event.start)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ agenda

function AgendaList({
  anchor,
  grouped,
  accounts,
  onOpenEvent
}: {
  anchor: string
  grouped: Map<string, CalEvent[]>
  accounts: { id: string; color: string }[]
  onOpenEvent: (event: CalEvent) => void
}) {
  const days = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 45; i++) out.push(addDays(anchor, i))
    return out.filter((day) => (grouped.get(day) ?? []).length > 0)
  }, [anchor, grouped])

  if (days.length === 0) {
    return (
      <div className="empty">
        <div className="empty__inner">
          <p className="empty__title">Nothing scheduled</p>
          <p className="empty__body">
            The next six weeks are clear. Connect a calendar in Settings, or give a note a{' '}
            <code>date:</code> to put it here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="agendaview">
      {days.map((day) => (
        <div key={day} className={`agendaday ${isToday(day) ? 'agendaday--today' : ''}`}>
          <div className="agendaday__when">
            <span className="agendaday__num">{fromISODate(day).getDate()}</span>
            <span className="agendaday__dow">
              {WEEKDAYS_LONG[fromISODate(day).getDay()].slice(0, 3)}
            </span>
            <span className="agendaday__dow" style={{ color: 'var(--s-6)' }}>
              {relativeDay(day)}
            </span>
          </div>
          <div className="agendaday__items">
            {(grouped.get(day) ?? []).map((event) => (
              <button
                key={`${event.id}-${day}`}
                type="button"
                className="arow"
                style={{ '--chip': colorFor(event, accounts) } as React.CSSProperties}
                onClick={() => onOpenEvent(event)}
              >
                <span className="arow__time">
                  {event.allDay ? 'All day' : formatRange(event.start, event.end, false)}
                </span>
                <span className="arow__bar" />
                <span className="arow__title truncate">{event.title}</span>
                {event.location && <span className="arow__where truncate">{event.location}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// -------------------------------------------------------------- event card

function EventCard({
  event,
  accounts,
  onClose
}: {
  event: CalEvent
  accounts: { id: string; color: string; name?: string }[]
  onClose: () => void
}) {
  const openNote = useStone((s) => s.openNote)
  const account = accounts.find((a) => a.id === event.accountId)

  return (
    <div className="overlay overlay--center" onClick={onClose} role="presentation">
      <div
        className="eventcard"
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="eventcard__accent"
          style={{ '--chip': colorFor(event, accounts) } as React.CSSProperties}
        />
        <div className="eventcard__body">
          <h2 className="eventcard__title">{event.title}</h2>

          <div className="eventcard__meta">
            <div>
              <IconClock size={14} />
              <span>
                {relativeDay(event.start)} · {formatRange(event.start, event.end, event.allDay)}
              </span>
            </div>
            {event.location && (
              <div>
                <IconPin size={14} />
                <span>{event.location}</span>
              </div>
            )}
            {account?.name && (
              <div>
                <span className="calrow__src">{account.name}</span>
              </div>
            )}
          </div>

          {event.notes && <p className="eventcard__notes">{event.notes}</p>}

          <div className="eventcard__foot">
            {event.relPath && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void openNote(event.relPath!)
                  onClose()
                }}
              >
                <IconNote size={13} />
                Open note
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

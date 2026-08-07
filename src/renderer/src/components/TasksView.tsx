import { useMemo, useState } from 'react'
import type { Priority, Task } from '@shared/types'
import { compareTasks, dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { addDays, relativeDay, today } from '../lib/dates'
import { IconHash, IconPlus } from '../ui/icons'

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'someday' | 'done'

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
  someday: 'No date',
  done: 'Done'
}

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'someday', 'done']

function bucketOf(task: Task, now: string, weekEnd: string): Bucket {
  if (task.status === 'done') return 'done'
  const due = dueDay(task.due)
  if (!due) return 'someday'
  if (due < now) return 'overdue'
  if (due === now) return 'today'
  if (due === addDays(now, 1)) return 'tomorrow'
  if (due <= weekEnd) return 'week'
  return 'later'
}

export function TaskRow({ task, showSource = true }: { task: Task; showSource?: boolean }) {
  const toggleTask = useStone((s) => s.toggleTask)
  const openNote = useStone((s) => s.openNote)

  const due = dueDay(task.due)
  const overdue = Boolean(due && due < today() && task.status !== 'done')

  return (
    <div className={`task ${task.status === 'done' ? 'task--done' : ''}`}>
      <button
        type="button"
        className="task__box"
        data-status={task.status}
        role="checkbox"
        aria-checked={task.status === 'done'}
        aria-label={`Mark "${task.text}" ${task.status === 'done' ? 'not done' : 'done'}`}
        onClick={() => void toggleTask(task)}
      />

      <div className="task__main">
        <button
          type="button"
          className="task__text"
          onClick={() => void openNote(task.relPath)}
          title="Open the note this task lives in"
        >
          {task.text || '(empty task)'}
        </button>

        <div className="task__meta">
          {due && (
            <span className={`badge ${overdue ? 'badge--overdue' : 'badge--due'}`}>
              {relativeDay(due)}
              {task.due?.includes('T') ? ` ${task.due.slice(11, 16)}` : ''}
            </span>
          )}
          {task.priority !== 'none' && (
            <span className={`badge badge--${task.priority}`}>{task.priority}</span>
          )}
          {task.estimate && (
            <span className="badge">
              {task.estimate >= 60 ? `${(task.estimate / 60).toFixed(task.estimate % 60 ? 1 : 0)}h` : `${task.estimate}m`}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="badge badge--tag">
              #{tag}
            </span>
          ))}
          {showSource && (
            <button
              type="button"
              className="task__source"
              onClick={() => void openNote(task.relPath)}
            >
              {task.relPath.replace(/\.md$/, '')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function TasksView() {
  const tasks = useStone((s) => s.tasks)
  const tags = useStone((s) => s.tags)
  const setQuickAdd = useStone((s) => s.setQuickAdd)

  const [showDone, setShowDone] = useState(false)
  const [priority, setPriority] = useState<Priority | null>(null)
  const [tag, setTag] = useState<string | null>(null)

  const now = today()
  const weekEnd = addDays(now, 7)

  const filtered = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'cancelled')
      .filter((t) => (showDone ? true : t.status !== 'done'))
      .filter((t) => (priority ? t.priority === priority : true))
      .filter((t) => (tag ? t.tags.includes(tag) : true))
  }, [tasks, showDone, priority, tag])

  const grouped = useMemo(() => {
    const map = new Map<Bucket, Task[]>()
    for (const task of filtered) {
      const bucket = bucketOf(task, now, weekEnd)
      const list = map.get(bucket)
      if (list) list.push(task)
      else map.set(bucket, [task])
    }
    for (const list of map.values()) list.sort(compareTasks)
    return map
  }, [filtered, now, weekEnd])

  const openCount = tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length
  const overdueCount = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled' && dueDay(t.due) && dueDay(t.due)! < now
  ).length

  return (
    <div className="tasks">
      <div className="tasks__filters">
        <div className="filtergroup">
          <div className="eyebrow">Status</div>
          <button
            type="button"
            className="filterbtn"
            aria-pressed={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            Show completed
            <span className="filterbtn__count">{tasks.filter((t) => t.status === 'done').length}</span>
          </button>
        </div>

        <div className="filtergroup">
          <div className="eyebrow">Priority</div>
          {(['urgent', 'high', 'medium', 'low'] as Priority[]).map((level) => {
            const count = tasks.filter((t) => t.priority === level && t.status !== 'done').length
            return (
              <button
                key={level}
                type="button"
                className="filterbtn"
                aria-pressed={priority === level}
                onClick={() => setPriority((p) => (p === level ? null : level))}
              >
                {level[0].toUpperCase() + level.slice(1)}
                <span className="filterbtn__count">{count}</span>
              </button>
            )
          })}
        </div>

        {tags.length > 0 && (
          <div className="filtergroup">
            <div className="eyebrow">Tags</div>
            {tags.slice(0, 14).map(({ tag: name, count }) => (
              <button
                key={name}
                type="button"
                className="filterbtn"
                aria-pressed={tag === name}
                onClick={() => setTag((t) => (t === name ? null : name))}
              >
                <IconHash size={11} />
                {name}
                <span className="filterbtn__count">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tasks__main">
        <div className="tasks__head">
          <h1 className="tasks__title">Tasks</h1>
          <span className="cal__year">
            {openCount} open{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
          </span>
          <div className="cal__tools">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setQuickAdd(true)}>
              <IconPlus size={13} />
              New task
            </button>
          </div>
        </div>

        <div className="tasks__list">
          {filtered.length === 0 && (
            <div className="empty">
              <div className="empty__inner">
                <p className="empty__title">Nothing on the list</p>
                <p className="empty__body">
                  Tasks are checkboxes in your notes. Write <code>- [ ] something @tomorrow !high</code>{' '}
                  and it shows up here.
                </p>
              </div>
            </div>
          )}

          {BUCKET_ORDER.map((bucket) => {
            const list = grouped.get(bucket)
            if (!list?.length) return null
            return (
              <section key={bucket} className={`taskgroup taskgroup--${bucket}`}>
                <header className="taskgroup__head">
                  <span className="eyebrow">{BUCKET_LABEL[bucket]}</span>
                  <span className="taskgroup__count">{list.length}</span>
                  <span className="taskgroup__rule" />
                </header>
                {list.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

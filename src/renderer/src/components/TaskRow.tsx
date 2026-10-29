import type { Task } from '@shared/types'
import { dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { relativeDay, today } from '../lib/dates'
import { IconCheck, IconCopy, IconNote } from '../ui/icons'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'

/** One task line, rendered wherever tasks show up — the database/query view, embeds. */
export function TaskRow({ task, showSource = true }: { task: Task; showSource?: boolean }) {
  const toggleTask = useStone((s) => s.toggleTask)
  const openNote = useStone((s) => s.openNote)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()

  const due = dueDay(task.due)
  const overdue = Boolean(due && due < today() && task.status !== 'done')

  const items = (): MenuItem[] => [
    {
      id: 'toggle',
      label: task.status === 'done' ? 'Mark as not done' : 'Mark as done',
      icon: <IconCheck size={14} />,
      run: () => void toggleTask(task)
    },
    {
      id: 'open',
      label: 'Open the note it lives in',
      icon: <IconNote size={14} />,
      run: () => void openNote(task.relPath, { line: task.line })
    },
    {
      id: 'open-split',
      label: 'Open in a new tab',
      run: () => void openNote(task.relPath, { line: task.line, newTab: true })
    },
    {
      id: 'copy',
      label: 'Copy the task text',
      separated: true,
      icon: <IconCopy size={14} />,
      run: () => void navigator.clipboard.writeText(task.text)
    }
  ]

  return (
    <div
      className={`task ${task.status === 'done' ? 'task--done' : ''}`}
      onContextMenu={(event) => openMenu(event, items())}
    >
      {menu && <ContextMenu state={menu} onClose={closeMenu} />}
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
          data-tip="Open the note this task lives in"
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

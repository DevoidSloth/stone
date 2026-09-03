import { useMemo } from 'react'
import type { NoteMeta, PropertyType, SavedView, Task } from '@shared/types'
import { formatProperty } from '@shared/properties'
import { parseQuery } from '@shared/query'
import { builtInValue, runView } from '@shared/view-query'
import { compareTasks, dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { relativeDay } from '../lib/dates'
import { PageIcon } from './PageDressing'

/**
 * A query, rendered where it was written.
 *
 * Notion calls this an inline database and Obsidian gets it from Dataview; both
 * exist because a note is where you are already looking. A daily note that
 * lists its own overdue tasks is worth more than the same list one screen away,
 * and this is the smallest thing that makes the note assemble itself.
 *
 * It reads the same store the database screen does, so it updates when the
 * vault does, and it renders compactly on purpose: this is a passage inside a
 * document, not a screen, and a full table would swamp the prose around it.
 */
export function EmbeddedQuery({ source }: { source: string }) {
  const notes = useStone((s) => s.notes)
  const tasks = useStone((s) => s.tasks)
  const schema = useStone((s) => s.properties)
  const savedViews = useStone((s) => s.settings?.savedViews ?? [])
  const openNote = useStone((s) => s.openNote)
  const toggleTask = useStone((s) => s.toggleTask)

  const parsed = useMemo(() => parseQuery(source), [source])

  const typeOf = useMemo(() => {
    const map = new Map(schema.map((p) => [p.key, p.type]))
    return (key: string): PropertyType => {
      if (key === 'edited') return 'date'
      if (key === 'tag') return 'multi'
      return map.get(key) ?? 'text'
    }
  }, [schema])

  const view: SavedView | null = useMemo(() => {
    if (parsed.viewRef) {
      const needle = parsed.viewRef.toLowerCase()
      return (
        savedViews.find((v) => v.id === parsed.viewRef || v.name.toLowerCase() === needle) ?? null
      )
    }
    return parsed.view
  }, [parsed, savedViews])

  const rows = useMemo(() => {
    if (!view) return []
    const matched = runView(view, notes, typeOf)
    return parsed.limit ? matched.slice(0, parsed.limit) : matched
  }, [view, notes, typeOf, parsed.limit])

  const taskRows = useMemo<Task[]>(() => {
    if (!view || view.source !== 'tasks') return []
    const allowed = new Set(rows.map((n) => n.relPath))
    const matched = tasks.filter((t) => allowed.has(t.relPath)).sort(compareTasks)
    return parsed.limit ? matched.slice(0, parsed.limit) : matched
  }, [view, rows, tasks, parsed.limit])

  if (parsed.viewRef && !view) {
    return (
      <div className="embedq embedq--error">
        No saved view called “{parsed.viewRef}”. Create it under Views, or describe the query here
        instead.
      </div>
    )
  }

  if (!view) {
    return (
      <div className="embedq embedq--error">
        An empty query. Write something like <code>from: Projects</code> and{' '}
        <code>where: status is active</code>.
      </div>
    )
  }

  const count = view.source === 'tasks' ? taskRows.length : rows.length

  return (
    <div className="embedq">
      <div className="embedq__head">
        <span className="eyebrow">{parsed.viewRef ?? 'Query'}</span>
        <span className="embedq__count">{count}</span>
      </div>

      {parsed.warnings.map((warning) => (
        <p key={warning} className="embedq__warning">
          {warning}
        </p>
      ))}

      {count === 0 && <p className="embedq__empty">Nothing matches.</p>}

      {view.source === 'tasks'
        ? taskRows.map((task) => (
            <div key={task.id} className="embedq__task">
              <input
                type="checkbox"
                checked={task.status === 'done'}
                aria-label={task.text}
                onChange={() => void toggleTask(task)}
              />
              <button
                type="button"
                className="embedq__label truncate"
                onClick={() => void openNote(task.relPath, { line: task.line })}
              >
                {task.text}
              </button>
              {task.due && <span className="embedq__meta">{relativeDay(dueDay(task.due)!)}</span>}
            </div>
          ))
        : rows.map((note) => (
            <button
              key={note.relPath}
              type="button"
              className="embedq__row"
              onClick={() => void openNote(note.relPath)}
            >
              <span className="embedq__label truncate">
                {note.icon && <PageIcon icon={note.icon} className="dbtable__icon" />}
                {note.title}
              </span>
              {/* Extra columns are shown as trailing metadata rather than as a
                  grid — inside prose, a table would read as a different document. */}
              {view.columns
                .filter((c) => c !== 'title')
                .map((column) => (
                  <span key={column} className="embedq__meta truncate">
                    {formatProperty(builtInValue(note as NoteMeta, column), typeOf(column))}
                  </span>
                ))}
            </button>
          ))}
    </div>
  )
}

import { useMemo, useState, type ReactElement } from 'react'
import type {
  FilterOp,
  NoteMeta,
  PropertyType,
  SavedView,
  Task,
  ViewFilter,
  ViewKind,
  ViewSort
} from '@shared/types'
import { compareProperty, formatProperty } from '@shared/properties'
import { dueDay } from '@shared/task-syntax'
import { useStone } from '../store'
import { relativeDay } from '../lib/dates'
import {
  IconBoard,
  IconGallery,
  IconList,
  IconPlus,
  IconTable,
  IconTimeline,
  IconTrash,
  IconX
} from '../ui/icons'
import { TaskRow } from './TasksView'

/**
 * Database views.
 *
 * Notion's core idea, over a folder of markdown: a saved query with a shape.
 * The rows are notes (or the tasks inside them), the columns are frontmatter
 * keys Stone inferred a type for, and the whole definition lives in settings so
 * a view is a thing you keep rather than a filter you re-apply.
 *
 * Nothing here writes to the vault. A view is a lens; the files stay files.
 */

const KINDS: { id: ViewKind; label: string; icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'table', label: 'Table', icon: IconTable },
  { id: 'board', label: 'Board', icon: IconBoard },
  { id: 'gallery', label: 'Gallery', icon: IconGallery },
  { id: 'list', label: 'List', icon: IconList },
  { id: 'timeline', label: 'Timeline', icon: IconTimeline }
]

const OPS: { id: FilterOp; label: string }[] = [
  { id: 'is', label: 'is' },
  { id: 'is-not', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'not-contains', label: 'does not contain' },
  { id: 'before', label: 'is before' },
  { id: 'after', label: 'is after' },
  { id: 'empty', label: 'is empty' },
  { id: 'not-empty', label: 'is not empty' }
]

/** Columns every note has, alongside whatever frontmatter provides. */
const BUILT_IN = ['title', 'folder', 'tag', 'edited', 'tasks']

function builtInValue(note: NoteMeta, key: string): unknown {
  switch (key) {
    case 'title':
      return note.title
    case 'folder':
      return note.relPath.includes('/') ? note.relPath.slice(0, note.relPath.lastIndexOf('/')) : ''
    case 'tag':
      return note.tags
    case 'edited':
      return new Date(note.mtime).toISOString().slice(0, 10)
    case 'tasks':
      return note.taskCount === 0 ? '' : `${note.doneCount}/${note.taskCount}`
    default:
      return note.frontmatter[key]
  }
}

function matches(note: NoteMeta, filter: ViewFilter): boolean {
  const raw = builtInValue(note, filter.property)
  const values = Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)]
  const haystack = values.join(' ').toLowerCase()
  const needle = filter.value.trim().toLowerCase()

  switch (filter.op) {
    case 'empty':
      return values.length === 0 || haystack === ''
    case 'not-empty':
      return values.length > 0 && haystack !== ''
    case 'is':
      return values.some((v) => v.toLowerCase() === needle)
    case 'is-not':
      return !values.some((v) => v.toLowerCase() === needle)
    case 'contains':
      return haystack.includes(needle)
    case 'not-contains':
      return !haystack.includes(needle)
    case 'before':
      return haystack !== '' && haystack < needle
    case 'after':
      return haystack !== '' && haystack > needle
    default:
      return true
  }
}

function applySorts(notes: NoteMeta[], sorts: ViewSort[], typeOf: (k: string) => PropertyType): NoteMeta[] {
  if (sorts.length === 0) return notes
  return [...notes].sort((a, b) => {
    for (const sort of sorts) {
      const type = typeOf(sort.property)
      const result = compareProperty(
        builtInValue(a, sort.property),
        builtInValue(b, sort.property),
        type
      )
      if (result !== 0) return sort.direction === 'asc' ? result : -result
    }
    return 0
  })
}

export function newView(kind: ViewKind = 'table'): SavedView {
  return {
    id: `view-${Date.now().toString(36)}`,
    name: 'Untitled view',
    icon: '🗂️',
    kind,
    source: 'notes',
    folder: '',
    filters: [],
    sorts: [{ property: 'edited', direction: 'desc' }],
    groupBy: null,
    columns: ['title', 'folder', 'edited']
  }
}

// ------------------------------------------------------------------ builder

function ViewBuilder({
  view,
  columns,
  onChange,
  onClose
}: {
  view: SavedView
  columns: string[]
  onChange: (next: SavedView) => void
  onClose: () => void
}) {
  const folders = useStone((s) => s.folders)

  return (
    <div className="builder">
      <div className="builder__head">
        <span className="eyebrow">Configure</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--icon"
          aria-label="Close"
          onClick={onClose}
        >
          <IconX size={13} />
        </button>
      </div>

      <label className="builder__row">
        <span>Name</span>
        <input
          className="field"
          value={view.name}
          onChange={(e) => onChange({ ...view, name: e.target.value })}
        />
      </label>

      <label className="builder__row">
        <span>Icon</span>
        <input
          className="field builder__icon"
          value={view.icon}
          maxLength={4}
          onChange={(e) => onChange({ ...view, icon: e.target.value })}
        />
      </label>

      <label className="builder__row">
        <span>Rows are</span>
        <select
          className="field"
          value={view.source}
          onChange={(e) => onChange({ ...view, source: e.target.value as SavedView['source'] })}
        >
          <option value="notes">Notes</option>
          <option value="tasks">Tasks</option>
        </select>
      </label>

      <label className="builder__row">
        <span>In folder</span>
        <select
          className="field"
          value={view.folder}
          onChange={(e) => onChange({ ...view, folder: e.target.value })}
        >
          <option value="">The whole vault</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>

      <label className="builder__row">
        <span>Group by</span>
        <select
          className="field"
          value={view.groupBy ?? ''}
          onChange={(e) => onChange({ ...view, groupBy: e.target.value || null })}
        >
          <option value="">Nothing</option>
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>

      <div className="builder__section eyebrow">Filters</div>
      {view.filters.map((filter, index) => (
        <div key={index} className="builder__filter">
          <select
            className="field"
            value={filter.property}
            onChange={(e) => {
              const filters = [...view.filters]
              filters[index] = { ...filter, property: e.target.value }
              onChange({ ...view, filters })
            }}
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
          <select
            className="field"
            value={filter.op}
            onChange={(e) => {
              const filters = [...view.filters]
              filters[index] = { ...filter, op: e.target.value as FilterOp }
              onChange({ ...view, filters })
            }}
          >
            {OPS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
          {filter.op !== 'empty' && filter.op !== 'not-empty' && (
            <input
              className="field"
              value={filter.value}
              placeholder="value"
              onChange={(e) => {
                const filters = [...view.filters]
                filters[index] = { ...filter, value: e.target.value }
                onChange({ ...view, filters })
              }}
            />
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Remove filter"
            onClick={() =>
              onChange({ ...view, filters: view.filters.filter((_, i) => i !== index) })
            }
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          onChange({
            ...view,
            filters: [...view.filters, { property: columns[0] ?? 'title', op: 'contains', value: '' }]
          })
        }
      >
        <IconPlus size={12} />
        Add a filter
      </button>

      <div className="builder__section eyebrow">Sort</div>
      {view.sorts.map((sort, index) => (
        <div key={index} className="builder__filter">
          <select
            className="field"
            value={sort.property}
            onChange={(e) => {
              const sorts = [...view.sorts]
              sorts[index] = { ...sort, property: e.target.value }
              onChange({ ...view, sorts })
            }}
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
          <select
            className="field"
            value={sort.direction}
            onChange={(e) => {
              const sorts = [...view.sorts]
              sorts[index] = { ...sort, direction: e.target.value as 'asc' | 'desc' }
              onChange({ ...view, sorts })
            }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Remove sort"
            onClick={() => onChange({ ...view, sorts: view.sorts.filter((_, i) => i !== index) })}
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          onChange({
            ...view,
            sorts: [...view.sorts, { property: columns[0] ?? 'title', direction: 'asc' }]
          })
        }
      >
        <IconPlus size={12} />
        Add a sort
      </button>

      <div className="builder__section eyebrow">Columns</div>
      <div className="builder__columns">
        {columns.map((column) => (
          <button
            key={column}
            type="button"
            className="filterbtn"
            aria-pressed={view.columns.includes(column)}
            onClick={() =>
              onChange({
                ...view,
                columns: view.columns.includes(column)
                  ? view.columns.filter((c) => c !== column)
                  : [...view.columns, column]
              })
            }
          >
            {column}
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- shapes

function TableShape({ rows, columns, typeOf }: { rows: NoteMeta[]; columns: string[]; typeOf: (k: string) => PropertyType }) {
  const openNote = useStone((s) => s.openNote)
  return (
    <div className="dbtable__wrap">
      <table className="dbtable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((note) => (
            <tr key={note.relPath} onClick={() => void openNote(note.relPath)}>
              {columns.map((column) => (
                <td key={column}>
                  {column === 'title' ? (
                    <span className="dbtable__title">
                      {note.icon && <span className="dbtable__icon">{note.icon}</span>}
                      {note.title}
                    </span>
                  ) : (
                    formatProperty(builtInValue(note, column), typeOf(column))
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoardShape({ groups }: { groups: { key: string; notes: NoteMeta[] }[] }) {
  const openNote = useStone((s) => s.openNote)
  return (
    <div className="board">
      {groups.map((group) => (
        <section key={group.key} className="board__column">
          <header className="board__head">
            <span className="eyebrow">{group.key || 'No value'}</span>
            <span className="board__count">{group.notes.length}</span>
          </header>
          <div className="board__cards">
            {group.notes.map((note) => (
              <button
                key={note.relPath}
                type="button"
                className="board__card"
                onClick={() => void openNote(note.relPath)}
              >
                <b className="truncate">
                  {note.icon && <span className="dbtable__icon">{note.icon}</span>}
                  {note.title}
                </b>
                {note.excerpt && <span className="board__excerpt">{note.excerpt.slice(0, 110)}</span>}
                {note.tags.length > 0 && (
                  <span className="board__tags">{note.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function GalleryShape({ rows }: { rows: NoteMeta[] }) {
  const openNote = useStone((s) => s.openNote)
  return (
    <div className="gallery">
      {rows.map((note) => (
        <button
          key={note.relPath}
          type="button"
          className="gallery__card"
          onClick={() => void openNote(note.relPath)}
        >
          <span className={`gallery__cover ${note.cover ? `cover--${note.cover}` : ''}`}>
            {note.icon && <span className="gallery__icon">{note.icon}</span>}
          </span>
          <b className="truncate">{note.title}</b>
          <span className="gallery__excerpt">{note.excerpt.slice(0, 90)}</span>
        </button>
      ))}
    </div>
  )
}

function ListShape({ rows }: { rows: NoteMeta[] }) {
  const openNote = useStone((s) => s.openNote)
  return (
    <div className="dblist">
      {rows.map((note) => (
        <button
          key={note.relPath}
          type="button"
          className="dblist__row"
          onClick={() => void openNote(note.relPath)}
        >
          <span className="dblist__icon">{note.icon ?? '·'}</span>
          <b className="truncate">{note.title}</b>
          <span className="dblist__meta truncate">{note.excerpt.slice(0, 120)}</span>
          <span className="dblist__date">{relativeDay(new Date(note.mtime).toISOString().slice(0, 10))}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Timeline: notes that carry a date, laid out newest first under a day rail.
 * Notes with no date are listed at the end rather than dropped, because a
 * silently shorter list reads as a bug.
 */
function TimelineShape({ rows }: { rows: NoteMeta[] }) {
  const openNote = useStone((s) => s.openNote)

  const dated = rows.filter((n) => n.date).sort((a, b) => (b.date! > a.date! ? 1 : -1))
  const undated = rows.filter((n) => !n.date)

  const byDay = new Map<string, NoteMeta[]>()
  for (const note of dated) {
    const list = byDay.get(note.date!) ?? []
    list.push(note)
    byDay.set(note.date!, list)
  }

  return (
    <div className="timeline">
      {[...byDay.entries()].map(([day, notes]) => (
        <section key={day} className="timeline__day">
          <header className="timeline__date">
            <b>{relativeDay(day)}</b>
            <span>{day}</span>
          </header>
          <div className="timeline__items">
            {notes.map((note) => (
              <button
                key={note.relPath}
                type="button"
                className="timeline__item"
                onClick={() => void openNote(note.relPath)}
              >
                {note.icon && <span className="dbtable__icon">{note.icon}</span>}
                <b className="truncate">{note.title}</b>
              </button>
            ))}
          </div>
        </section>
      ))}

      {undated.length > 0 && (
        <section className="timeline__day">
          <header className="timeline__date">
            <b>No date</b>
            <span>{undated.length}</span>
          </header>
          <div className="timeline__items">
            {undated.map((note) => (
              <button
                key={note.relPath}
                type="button"
                className="timeline__item"
                onClick={() => void openNote(note.relPath)}
              >
                <b className="truncate">{note.title}</b>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// -------------------------------------------------------------------- shell

export function DatabaseView() {
  const settings = useStone((s) => s.settings)
  const notes = useStone((s) => s.notes)
  const tasks = useStone((s) => s.tasks)
  const schema = useStone((s) => s.properties)
  const activeViewId = useStone((s) => s.activeViewId)
  const setActiveView = useStone((s) => s.setActiveView)
  const saveView = useStone((s) => s.saveView)
  const deleteView = useStone((s) => s.deleteView)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SavedView | null>(null)

  const views = settings?.savedViews ?? []
  const view = draft ?? views.find((v) => v.id === activeViewId) ?? views[0] ?? null

  const columns = useMemo(
    () => [...BUILT_IN, ...schema.map((p) => p.key)],
    [schema]
  )

  const typeOf = useMemo(() => {
    const map = new Map(schema.map((p) => [p.key, p.type]))
    return (key: string): PropertyType => {
      if (key === 'edited') return 'date'
      if (key === 'tag') return 'multi'
      return map.get(key) ?? 'text'
    }
  }, [schema])

  const rows = useMemo(() => {
    if (!view) return []
    let list = notes
    if (view.folder) list = list.filter((n) => n.relPath.startsWith(`${view.folder}/`))
    for (const filter of view.filters) list = list.filter((n) => matches(n, filter))
    return applySorts(list, view.sorts, typeOf)
  }, [notes, view, typeOf])

  const taskRows = useMemo<Task[]>(() => {
    if (!view || view.source !== 'tasks') return []
    const allowed = new Set(rows.map((n) => n.relPath))
    return tasks
      .filter((t) => allowed.has(t.relPath))
      .sort((a, b) => (dueDay(a.due) ?? '9999').localeCompare(dueDay(b.due) ?? '9999'))
  }, [tasks, rows, view])

  const groups = useMemo(() => {
    if (!view?.groupBy) return [{ key: '', notes: rows }]
    const map = new Map<string, NoteMeta[]>()
    for (const note of rows) {
      const raw = builtInValue(note, view.groupBy)
      const keys = Array.isArray(raw) ? raw.map(String) : [raw == null ? '' : String(raw)]
      for (const key of keys.length > 0 ? keys : ['']) {
        const list = map.get(key) ?? []
        list.push(note)
        map.set(key, list)
      }
    }
    return [...map.entries()]
      .map(([key, list]) => ({ key, notes: list }))
      .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key)))
  }, [rows, view])

  const commit = (next: SavedView): void => {
    setDraft(next)
  }

  const persist = (): void => {
    if (draft) void saveView(draft)
    setDraft(null)
    setEditing(false)
  }

  if (views.length === 0 && !draft) {
    return (
      <div className="empty">
        <div className="empty__inner">
          <p className="empty__title">No views yet</p>
          <p className="empty__body">
            A view is a saved query over your notes — every note tagged <code>#project</code> as a
            board, or everything in Journal as a timeline. The definition lives in settings; your
            files are untouched.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setDraft(newView())
              setEditing(true)
            }}
          >
            <IconPlus size={13} />
            New view
          </button>
        </div>
      </div>
    )
  }

  if (!view) return null

  return (
    <div className="dbview">
      <div className="dbview__head">
        <div className="dbview__tabs">
          {views.map((saved) => (
            <button
              key={saved.id}
              type="button"
              className="dbview__tab"
              aria-selected={saved.id === view.id}
              onClick={() => {
                setDraft(null)
                setEditing(false)
                setActiveView(saved.id)
              }}
            >
              <span>{saved.icon}</span>
              {saved.name}
            </button>
          ))}
          <button
            type="button"
            className="dbview__tab dbview__tab--add"
            aria-label="New view"
            onClick={() => {
              setDraft(newView())
              setEditing(true)
            }}
          >
            <IconPlus size={13} />
          </button>
        </div>

        <div className="dbview__tools">
          <div className="dbview__kinds">
            {KINDS.map(({ id, label, icon: Glyph }) => (
              <button
                key={id}
                type="button"
                className="dbview__kind"
                aria-pressed={view.kind === id}
                title={label}
                aria-label={label}
                onClick={() => commit({ ...view, kind: id })}
              >
                <Glyph size={14} />
              </button>
            ))}
          </div>

          <span className="dbview__count">
            {view.source === 'tasks' ? taskRows.length : rows.length}
          </span>

          <button type="button" className="btn btn--sm" onClick={() => setEditing((v) => !v)}>
            Configure
          </button>

          {draft ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={persist}>
              Save view
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Delete view"
              onClick={() => void deleteView(view.id)}
            >
              <IconTrash size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="dbview__body">
        <div className="dbview__canvas">
          {view.source === 'tasks' ? (
            <div className="tasks__list">
              {taskRows.length === 0 ? (
                <p className="panel__empty">No tasks match this view.</p>
              ) : (
                taskRows.map((task) => <TaskRow key={task.id} task={task} />)
              )}
            </div>
          ) : rows.length === 0 ? (
            <p className="panel__empty">No notes match this view.</p>
          ) : view.kind === 'table' ? (
            <TableShape rows={rows} columns={view.columns} typeOf={typeOf} />
          ) : view.kind === 'board' ? (
            <BoardShape groups={groups} />
          ) : view.kind === 'gallery' ? (
            <GalleryShape rows={rows} />
          ) : view.kind === 'timeline' ? (
            <TimelineShape rows={rows} />
          ) : (
            <ListShape rows={rows} />
          )}
        </div>

        {editing && (
          <ViewBuilder
            view={view}
            columns={columns}
            onChange={commit}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  )
}

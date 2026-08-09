import { useMemo, useState, type ReactElement } from 'react'
import type {
  FilterOp,
  NoteMeta,
  PropertyType,
  RollupFn,
  SavedView,
  Task,
  ViewKind,
  ViewRollup
} from '@shared/types'
import { formatProperty } from '@shared/properties'
import { buildRelationIndex, evaluateRollup } from '@shared/rollups'
import { BUILT_IN, builtInValue, runView } from '@shared/view-query'
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

const ROLLUP_FNS: RollupFn[] = [
  'count',
  'sum',
  'average',
  'min',
  'max',
  'earliest',
  'latest',
  'list'
]

function ViewBuilder({
  view,
  columns,
  relationKeys,
  onChange,
  onClose
}: {
  view: SavedView
  columns: string[]
  relationKeys: string[]
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

      {/* -------------------------------------------------------- rollups */}

      <div className="builder__section eyebrow">Rollups</div>
      <p className="hint">
        Follow a relation — a frontmatter key holding <code>[[links]]</code> — and summarise the
        notes on the other end.
      </p>

      {(view.rollups ?? []).map((rollup, index) => {
        const update = (patch: Partial<ViewRollup>): void => {
          const rollups = [...(view.rollups ?? [])]
          rollups[index] = { ...rollup, ...patch }
          onChange({ ...view, rollups })
        }
        return (
          <div className="builder__filter" key={rollup.id}>
            <input
              className="field"
              value={rollup.name}
              placeholder="Column name"
              onChange={(e) => update({ name: e.target.value })}
            />

            <select
              className="field"
              value={rollup.direction}
              onChange={(e) => update({ direction: e.target.value as ViewRollup['direction'] })}
            >
              <option value="outgoing">Notes this links to</option>
              <option value="incoming">Notes that link here</option>
            </select>

            <select
              className="field"
              value={rollup.relation}
              onChange={(e) => update({ relation: e.target.value })}
            >
              {relationKeys.length === 0 && <option value="">No relations in this vault</option>}
              {relationKeys.map((key) => (
                <option key={key} value={key}>
                  via {key}
                </option>
              ))}
            </select>

            <select
              className="field"
              value={rollup.fn}
              onChange={(e) => update({ fn: e.target.value as RollupFn })}
            >
              {ROLLUP_FNS.map((fn) => (
                <option key={fn} value={fn}>
                  {fn}
                </option>
              ))}
            </select>

            {rollup.fn !== 'count' && (
              <select
                className="field"
                value={rollup.target}
                onChange={(e) => update({ target: e.target.value })}
              >
                <option value="open-tasks">open tasks</option>
                <option value="tasks">all tasks</option>
                <option value="words">words</option>
                <option value="title">title</option>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label="Remove rollup"
              onClick={() =>
                onChange({ ...view, rollups: (view.rollups ?? []).filter((_, i) => i !== index) })
              }
            >
              <IconX size={12} />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          onChange({
            ...view,
            rollups: [
              ...(view.rollups ?? []),
              {
                id: `rollup-${Date.now().toString(36)}`,
                name: 'Rollup',
                relation: relationKeys[0] ?? '',
                direction: 'incoming',
                fn: 'count',
                target: 'open-tasks'
              }
            ]
          })
        }
      >
        <IconPlus size={12} />
        Add a rollup
      </button>
    </div>
  )
}

// ------------------------------------------------------------------- shapes

/** Columns that are derived from the file itself and cannot be typed into. */
const READ_ONLY_COLUMNS = new Set(['folder', 'edited', 'tasks', 'tag'])

/**
 * One cell.
 *
 * A frontmatter column is editable in place; the built-in ones are not, because
 * they describe the file rather than live in it — you change `edited` by editing
 * the note, and `folder` by moving it.
 *
 * The click that starts an edit has to be kept from the row, whose job is to
 * open the note. That is the whole reason this is a component rather than a
 * fragment: it owns the stopPropagation, and the draft state that lets a cell
 * be typed into without every keystroke writing to disk.
 */
function Cell({
  note,
  column,
  type,
  editable,
  onCommit
}: {
  note: NoteMeta
  column: string
  type: PropertyType
  editable: boolean
  onCommit: (value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (column === 'title') {
    return (
      <td>
        <span className="dbtable__title">
          {note.icon && <span className="dbtable__icon">{note.icon}</span>}
          {note.title}
        </span>
      </td>
    )
  }

  const raw = builtInValue(note, column)
  const shown = formatProperty(raw, type)

  if (!editable) return <td>{shown}</td>

  if (!editing) {
    return (
      <td
        className="dbtable__cell--editable"
        onClick={(e) => {
          e.stopPropagation()
          setDraft(raw == null ? '' : String(Array.isArray(raw) ? raw.join(', ') : raw))
          setEditing(true)
        }}
      >
        {shown || <span className="dbtable__placeholder">—</span>}
      </td>
    )
  }

  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    onCommit(trimmed === '' ? null : trimmed)
  }

  if (type === 'checkbox') {
    return (
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          autoFocus
          checked={draft === 'true' || draft === 'Yes'}
          onChange={(e) => {
            setEditing(false)
            onCommit(e.target.checked ? 'true' : 'false')
          }}
          onBlur={() => setEditing(false)}
        />
      </td>
    )
  }

  return (
    <td onClick={(e) => e.stopPropagation()}>
      <input
        className="field field--cell"
        autoFocus
        type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
        }}
      />
    </td>
  )
}

function TableShape({
  rows,
  columns,
  typeOf,
  rollups,
  rollupValue,
  onEdit
}: {
  rows: NoteMeta[]
  columns: string[]
  typeOf: (k: string) => PropertyType
  rollups: ViewRollup[]
  rollupValue: (rollup: ViewRollup, relPath: string) => string
  onEdit: (relPath: string, key: string, value: string | null) => void
}) {
  const openNote = useStone((s) => s.openNote)
  return (
    <div className="dbtable__wrap">
      <table className="dbtable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            {rollups.map((rollup) => (
              <th key={rollup.id} className="dbtable__rollup">
                {rollup.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((note) => (
            <tr key={note.relPath} onClick={() => void openNote(note.relPath)}>
              {columns.map((column) => (
                <Cell
                  key={column}
                  note={note}
                  column={column}
                  type={typeOf(column)}
                  editable={!READ_ONLY_COLUMNS.has(column) && column !== 'title'}
                  onCommit={(value) => onEdit(note.relPath, column, value)}
                />
              ))}
              {rollups.map((rollup) => (
                <td key={rollup.id} className="dbtable__rollup">
                  {rollupValue(rollup, note.relPath)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The board, which is the one shape where the view stops being a lens.
 *
 * Dragging a card from one column to another is a claim about the note — that
 * its status is now "doing", that its stage is now "shipped" — so it writes the
 * grouping property back to that note's frontmatter. Everything else in this
 * file still only reads; this is the deliberate exception, because a column you
 * cannot move a card into is a report pretending to be a board.
 *
 * Without a `groupBy` there is nothing a drop could mean, so the board stays
 * read-only rather than inventing a property to write.
 */
function BoardShape({
  groups,
  groupBy,
  onMove
}: {
  groups: { key: string; notes: NoteMeta[] }[]
  groupBy: string | null
  onMove: (relPath: string, value: string) => void
}) {
  const openNote = useStone((s) => s.openNote)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const editable = Boolean(groupBy) && groupBy !== 'tag' && groupBy !== 'edited'

  return (
    <div className="board">
      {groups.map((group) => (
        <section
          key={group.key}
          className="board__column"
          data-dropping={editable && over === group.key}
          onDragOver={(e) => {
            if (!editable || !dragging) return
            // Only a preventDefault here makes the column a valid drop target.
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setOver(group.key)
          }}
          onDragLeave={() => setOver((k) => (k === group.key ? null : k))}
          onDrop={(e) => {
            if (!editable || !dragging) return
            e.preventDefault()
            setOver(null)
            const relPath = e.dataTransfer.getData('text/stone-note') || dragging
            setDragging(null)
            if (relPath) onMove(relPath, group.key)
          }}
        >
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
                draggable={editable}
                data-dragging={dragging === note.relPath}
                onDragStart={(e) => {
                  setDragging(note.relPath)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/stone-note', note.relPath)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
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
  const relations = useStone((s) => s.relations)
  const activeViewId = useStone((s) => s.activeViewId)
  const setActiveView = useStone((s) => s.setActiveView)
  const saveView = useStone((s) => s.saveView)
  const deleteView = useStone((s) => s.deleteView)
  const setNoteProperty = useStone((s) => s.setNoteProperty)
  const createNote = useStone((s) => s.createNote)
  const toast = useStone((s) => s.toast)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SavedView | null>(null)

  const views = settings?.savedViews ?? []
  const view = draft ?? views.find((v) => v.id === activeViewId) ?? views[0] ?? null

  const columns = useMemo(
    () => [...BUILT_IN, ...schema.map((p) => p.key)],
    [schema]
  )

  /** Keys that actually hold links somewhere in the vault — the rollup sources. */
  const relationKeys = useMemo(
    () => [...new Set(relations.map((r) => r.property))].sort(),
    [relations]
  )

  const typeOf = useMemo(() => {
    const map = new Map(schema.map((p) => [p.key, p.type]))
    return (key: string): PropertyType => {
      if (key === 'edited') return 'date'
      if (key === 'tag') return 'multi'
      return map.get(key) ?? 'text'
    }
  }, [schema])

  const rows = useMemo(() => (view ? runView(view, notes, typeOf) : []), [notes, view, typeOf])

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

  // Rollups walk the relation graph, so the indexes are built once per change
  // rather than per cell — a table of 200 rows would otherwise rescan every edge
  // 200 times for a single column.
  const relationIndex = useMemo(() => buildRelationIndex(relations), [relations])
  const notesByPath = useMemo(() => new Map(notes.map((n) => [n.relPath, n])), [notes])
  const tasksByNote = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) map.set(task.relPath, [...(map.get(task.relPath) ?? []), task])
    return map
  }, [tasks])

  const rollupValue = useMemo(
    () =>
      (rollup: ViewRollup, relPath: string): string =>
        evaluateRollup(rollup, relPath, relationIndex, notesByPath, tasksByNote),
    [relationIndex, notesByPath, tasksByNote]
  )

  const commit = (next: SavedView): void => {
    setDraft(next)
  }

  /**
   * Create a row that already belongs in the view.
   *
   * A note added from inside a filtered view should satisfy that filter, or it
   * vanishes the moment it is created — so every `is` filter, and the column it
   * was dropped into, are written as frontmatter up front.
   */
  const addRow = async (groupKey?: string): Promise<void> => {
    if (!view) return
    const seed: string[] = []
    for (const filter of view.filters) {
      if (filter.op === 'is' && filter.value.trim() && !BUILT_IN.includes(filter.property)) {
        seed.push(`${filter.property}: ${filter.value.trim()}`)
      }
    }
    if (view.groupBy && groupKey && !BUILT_IN.includes(view.groupBy)) {
      seed.push(`${view.groupBy}: ${groupKey}`)
    }
    const content = seed.length > 0 ? `---\n${seed.join('\n')}\n---\n\n` : ''
    await createNote('Untitled', view.folder || undefined)
    const created = useStone.getState().activeRelPath
    if (created && content) {
      await window.stone.notes.save(created, content)
      await useStone.getState().refreshVault()
    }
  }

  const moveCard = (relPath: string, value: string): void => {
    if (!view?.groupBy) return
    if (BUILT_IN.includes(view.groupBy)) {
      toast(`"${view.groupBy}" comes from the file itself, so a card cannot be dragged into it.`, 'error')
      return
    }
    void setNoteProperty(relPath, view.groupBy, value || null)
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

          {view.source === 'notes' && (
            <button type="button" className="btn btn--sm" onClick={() => void addRow()}>
              <IconPlus size={12} />
              New
            </button>
          )}

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
            <TableShape
              rows={rows}
              columns={view.columns}
              typeOf={typeOf}
              rollups={view.rollups ?? []}
              rollupValue={rollupValue}
              onEdit={(relPath, key, value) => void setNoteProperty(relPath, key, value)}
            />
          ) : view.kind === 'board' ? (
            <BoardShape groups={groups} groupBy={view.groupBy} onMove={moveCard} />
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
            relationKeys={relationKeys}
            onChange={commit}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  )
}

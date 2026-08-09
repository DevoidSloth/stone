/**
 * Rollups: a value computed from the notes on the far side of a relation.
 *
 * This is the piece that turns a table over files into a database. A folder of
 * project notes and a folder of task notes are already connected if the tasks
 * name their project in frontmatter — but until something counts the open ones
 * per project, that connection is only visible one note at a time.
 *
 * Everything here is pure and works off the resolved relation edges the vault
 * hands over, so the same code serves the table view, an embedded query, and
 * anything later that wants the same number.
 */

import type { NoteMeta, RelationEdge, RollupFn, Task, ViewRollup } from './types'

/** Relation lookups, built once per render rather than scanned per row. */
export interface RelationIndex {
  /** `from` → property → targets. */
  outgoing: Map<string, Map<string, string[]>>
  /** `to` → property → sources. */
  incoming: Map<string, Map<string, string[]>>
}

export function buildRelationIndex(edges: RelationEdge[]): RelationIndex {
  const outgoing = new Map<string, Map<string, string[]>>()
  const incoming = new Map<string, Map<string, string[]>>()

  const push = (
    index: Map<string, Map<string, string[]>>,
    key: string,
    property: string,
    value: string
  ): void => {
    let byProperty = index.get(key)
    if (!byProperty) {
      byProperty = new Map()
      index.set(key, byProperty)
    }
    byProperty.set(property, [...(byProperty.get(property) ?? []), value])
  }

  for (const edge of edges) {
    push(outgoing, edge.from, edge.property, edge.to)
    push(incoming, edge.to, edge.property, edge.from)
  }
  return { outgoing, incoming }
}

/** The notes on the far side of one note's relation. */
export function relatedNotes(
  index: RelationIndex,
  relPath: string,
  relation: string,
  direction: 'outgoing' | 'incoming'
): string[] {
  const side = direction === 'outgoing' ? index.outgoing : index.incoming
  return side.get(relPath)?.get(relation) ?? []
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function dateKey(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text : null
}

/**
 * The value of one property on the far-side notes.
 *
 * `tasks` is a built-in target rather than a frontmatter key, because "how many
 * open tasks" is the question people actually ask of a relation and no vault
 * stores that as a property.
 */
function valuesFor(
  notes: NoteMeta[],
  tasksByNote: Map<string, Task[]>,
  target: string
): unknown[] {
  if (target === 'tasks') return notes.map((n) => n.taskCount)
  if (target === 'open-tasks') {
    return notes.map((n) => (tasksByNote.get(n.relPath) ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled').length)
  }
  if (target === 'title') return notes.map((n) => n.title)
  if (target === 'words') return notes.map((n) => n.words)
  return notes.map((n) => n.frontmatter[target])
}

export function applyRollupFn(fn: RollupFn, values: unknown[]): string {
  const present = values.filter((v) => v != null && v !== '')

  switch (fn) {
    case 'count':
      return String(values.length)

    case 'sum':
    case 'average': {
      const numbers = present.map(numeric).filter((n): n is number => n !== null)
      if (numbers.length === 0) return ''
      const total = numbers.reduce((a, b) => a + b, 0)
      const result = fn === 'sum' ? total : total / numbers.length
      // Trim the noise a division introduces, but keep a genuine decimal.
      return String(Math.round(result * 100) / 100)
    }

    case 'min':
    case 'max': {
      const numbers = present.map(numeric).filter((n): n is number => n !== null)
      if (numbers.length === 0) return ''
      return String(fn === 'min' ? Math.min(...numbers) : Math.max(...numbers))
    }

    case 'earliest':
    case 'latest': {
      const dates = present.map(dateKey).filter((d): d is string => d !== null).sort()
      if (dates.length === 0) return ''
      return fn === 'earliest' ? dates[0] : dates[dates.length - 1]
    }

    case 'list': {
      const seen = [...new Set(present.map((v) => String(v)))]
      return seen.slice(0, 8).join(', ') + (seen.length > 8 ? ` +${seen.length - 8}` : '')
    }

    default:
      return ''
  }
}

export function evaluateRollup(
  rollup: ViewRollup,
  relPath: string,
  index: RelationIndex,
  notesByPath: Map<string, NoteMeta>,
  tasksByNote: Map<string, Task[]>
): string {
  const targets = relatedNotes(index, relPath, rollup.relation, rollup.direction)
  const notes = targets
    .map((p) => notesByPath.get(p))
    .filter((n): n is NoteMeta => n !== undefined)

  if (rollup.fn === 'count') return String(notes.length)
  return applyRollupFn(rollup.fn, valuesFor(notes, tasksByNote, rollup.target))
}

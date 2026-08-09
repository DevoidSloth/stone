/**
 * The `stone` fenced block: a query written inside a note.
 *
 * ```stone
 * from: Projects
 * where: status is active
 * sort: due asc
 * as: board
 * group: status
 * ```
 *
 * or, naming something already saved:
 *
 * ```stone
 * view: Active projects
 * ```
 *
 * The syntax is `key: value` lines rather than anything cleverer, for three
 * reasons: it is the same shape as the frontmatter directly above it, it stays
 * readable when the vault is opened in another editor that will render this
 * block as plain code, and a typo produces a wrong line rather than a parse
 * error swallowing the whole query.
 *
 * A block is a *lens*, never a mutation. Nothing here can write.
 */

import type { SavedView, ViewFilter, ViewKind, ViewSort } from './types'

export interface ParsedQuery {
  /** Set when the block referenced a saved view by name or id. */
  viewRef: string | null
  /** The inline query, when one was written. */
  view: SavedView | null
  limit: number | null
  /** Problems worth showing the reader, rather than failing silently. */
  warnings: string[]
}

const KINDS: ViewKind[] = ['table', 'board', 'gallery', 'timeline', 'list']

const OPS: { text: string; op: ViewFilter['op'] }[] = [
  // Longest first: "is not" has to win against "is".
  { text: 'not contains', op: 'not-contains' },
  { text: 'does not contain', op: 'not-contains' },
  { text: 'is not empty', op: 'not-empty' },
  { text: 'is not', op: 'is-not' },
  { text: 'is empty', op: 'empty' },
  { text: 'contains', op: 'contains' },
  { text: 'before', op: 'before' },
  { text: 'after', op: 'after' },
  { text: 'is', op: 'is' }
]

/** `status is active` → a filter. Returns null when no operator is present. */
function parseFilter(text: string): ViewFilter | null {
  const trimmed = text.trim()
  for (const { text: word, op } of OPS) {
    const at = trimmed.toLowerCase().indexOf(` ${word}`)
    if (at === -1) continue
    const property = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + word.length + 1).trim()
    if (!property) continue
    return { property, op, value }
  }
  return null
}

/** `due asc` → a sort. Direction defaults to ascending. */
function parseSort(text: string): ViewSort | null {
  const parts = text.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return null
  const direction = (parts[1] ?? 'asc').toLowerCase()
  return {
    property: parts[0],
    direction: direction === 'desc' || direction === 'descending' ? 'desc' : 'asc'
  }
}

export function parseQuery(source: string): ParsedQuery {
  const warnings: string[] = []
  let viewRef: string | null = null
  let limit: number | null = null

  const view: SavedView = {
    id: 'embedded',
    name: 'Embedded query',
    icon: '',
    kind: 'list',
    source: 'notes',
    folder: '',
    filters: [],
    sorts: [],
    groupBy: null,
    columns: ['title']
  }

  let sawInline = false

  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const colon = line.indexOf(':')
    if (colon === -1) {
      warnings.push(`Ignored "${line}" — every line is written as \`key: value\`.`)
      continue
    }

    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    switch (key) {
      case 'view':
        viewRef = value
        break

      case 'from':
      case 'folder':
        view.folder = value
        sawInline = true
        break

      case 'source':
      case 'rows':
        view.source = value.toLowerCase() === 'tasks' ? 'tasks' : 'notes'
        sawInline = true
        break

      case 'as':
      case 'kind': {
        const kind = value.toLowerCase() as ViewKind
        if (KINDS.includes(kind)) view.kind = kind
        else warnings.push(`"${value}" is not a shape. Try: ${KINDS.join(', ')}.`)
        sawInline = true
        break
      }

      case 'where':
      case 'filter': {
        const filter = parseFilter(value)
        if (filter) view.filters.push(filter)
        else warnings.push(`Could not read the condition "${value}".`)
        sawInline = true
        break
      }

      case 'sort': {
        const sort = parseSort(value)
        if (sort) view.sorts.push(sort)
        sawInline = true
        break
      }

      case 'group':
      case 'groupby':
        view.groupBy = value || null
        sawInline = true
        break

      case 'columns':
        view.columns = value.split(',').map((c) => c.trim()).filter(Boolean)
        sawInline = true
        break

      case 'limit': {
        const n = Number(value)
        if (Number.isFinite(n) && n > 0) limit = Math.floor(n)
        else warnings.push(`"${value}" is not a row count.`)
        break
      }

      default:
        warnings.push(`Ignored unknown setting "${key}".`)
    }
  }

  // A block naming a saved view and *also* redefining it is ambiguous, and
  // silently picking one would make the other look broken.
  if (viewRef && sawInline) {
    warnings.push('This block names a saved view and describes one too — the saved view wins.')
  }

  return { viewRef, view: sawInline && !viewRef ? view : null, limit, warnings }
}

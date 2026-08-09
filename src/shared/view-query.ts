/**
 * Running a saved view against the vault.
 *
 * Lifted out of the database screen so an embedded query in a note can produce
 * exactly the same rows as the view it names. Two implementations of "what does
 * this filter mean" would drift within a week, and the drift would show up as a
 * note and a view disagreeing about the same question.
 */

import type { NoteMeta, PropertyType, SavedView, ViewFilter, ViewSort } from './types'
import { compareProperty } from './properties'

/** Columns every note has, alongside whatever frontmatter provides. */
export const BUILT_IN = ['title', 'folder', 'tag', 'edited', 'tasks']

export function builtInValue(note: NoteMeta, key: string): unknown {
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

export function matches(note: NoteMeta, filter: ViewFilter): boolean {
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

export function applySorts(
  notes: NoteMeta[],
  sorts: ViewSort[],
  typeOf: (k: string) => PropertyType
): NoteMeta[] {
  if (sorts.length === 0) return notes
  return [...notes].sort((a, b) => {
    for (const sort of sorts) {
      const result = compareProperty(
        builtInValue(a, sort.property),
        builtInValue(b, sort.property),
        typeOf(sort.property)
      )
      if (result !== 0) return sort.direction === 'asc' ? result : -result
    }
    return 0
  })
}

/** Filter, then sort — the rows a view resolves to. */
export function runView(
  view: SavedView,
  notes: NoteMeta[],
  typeOf: (k: string) => PropertyType
): NoteMeta[] {
  let list = notes
  if (view.folder) list = list.filter((n) => n.relPath.startsWith(`${view.folder}/`))
  for (const filter of view.filters) list = list.filter((n) => matches(n, filter))
  return applySorts(list, view.sorts, typeOf)
}

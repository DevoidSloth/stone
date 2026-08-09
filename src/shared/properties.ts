/**
 * Typed properties over YAML frontmatter.
 *
 * Notion's database columns are declared up front; a markdown vault has no such
 * schema, so Stone infers one from what the notes actually contain. The type is
 * derived per key across the whole vault rather than per note, because a column
 * that renders as a date in one row and free text in the next is worse than one
 * that is merely approximate.
 */

import type { PropertyDef, PropertyType } from './types'

/** Keys Stone owns and presents in its own UI rather than as properties. */
export const RESERVED_KEYS = new Set(['icon', 'cover', 'title', 'aliases', 'tags'])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?$/
const URL_RE = /^https?:\/\/\S+$/

const WIKILINK_ONLY_RE = /^\[\[([^\]]+)\]\]$/

function typeOfValue(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (value instanceof Date) return 'date'
  if (Array.isArray(value)) {
    // A list of links is still a relation — one that happens to point at several
    // notes. Calling it multi-select would turn "Projects: [[A]], [[B]]" into two
    // opaque tags and lose the only thing that made it worth writing as links.
    //
    // A nested array is the unquoted `key: [[Name]]` case, which YAML has
    // already stripped the brackets from — see `relationTargets`.
    const entries = value.filter((v) => v != null && v !== '')
    if (entries.length === 0) return 'multi'
    if (entries.every((v) => Array.isArray(v))) return 'relation'
    if (entries.every((v) => WIKILINK_ONLY_RE.test(String(v).trim()))) return 'relation'
    return 'multi'
  }
  if (typeof value === 'string') {
    if (ISO_DATE_RE.test(value.trim())) return 'date'
    if (URL_RE.test(value.trim())) return 'url'
    if (/^\[\[.+\]\]$/.test(value.trim())) return 'relation'
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) return 'number'
    return 'text'
  }
  return 'text'
}

/** Rank used when a key holds different shapes in different notes. */
const SPECIFICITY: Record<PropertyType, number> = {
  checkbox: 5,
  date: 4,
  number: 3,
  url: 3,
  relation: 3,
  multi: 2,
  select: 1,
  text: 0
}

export function valueToStrings(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (value instanceof Date) return [value.toISOString().slice(0, 10)]
  return [String(value)].filter(Boolean)
}

/**
 * Build the vault's property schema from every note's frontmatter.
 *
 * A text key whose values repeat across notes but never exceed a handful of
 * distinct strings is promoted to a select — that is what makes a column
 * filterable rather than just readable.
 */
export function inferProperties(
  frontmatters: Record<string, unknown>[]
): PropertyDef[] {
  const types = new Map<string, PropertyType>()
  const values = new Map<string, Map<string, number>>()
  const counts = new Map<string, number>()

  for (const fm of frontmatters) {
    for (const [key, value] of Object.entries(fm)) {
      if (RESERVED_KEYS.has(key) || value == null || value === '') continue
      counts.set(key, (counts.get(key) ?? 0) + 1)

      const seen = types.get(key)
      const next = typeOfValue(value)
      if (!seen) types.set(key, next)
      else if (seen !== next) {
        // Disagreement collapses to the less specific of the two, except that
        // any list beats a scalar — one note writing a bare string should not
        // demote a column the rest of the vault treats as multi-select.
        if (seen === 'multi' || next === 'multi') types.set(key, 'multi')
        else types.set(key, SPECIFICITY[seen] < SPECIFICITY[next] ? seen : next)
      }

      let bucket = values.get(key)
      if (!bucket) {
        bucket = new Map()
        values.set(key, bucket)
      }
      for (const v of valueToStrings(value)) bucket.set(v, (bucket.get(v) ?? 0) + 1)
    }
  }

  const out: PropertyDef[] = []
  for (const [key, count] of counts) {
    let type = types.get(key) ?? 'text'
    const bucket = values.get(key) ?? new Map()
    const distinct = [...bucket.keys()]

    if (type === 'text' && distinct.length > 0 && distinct.length <= Math.max(2, count / 2)) {
      const longest = distinct.reduce((a, b) => Math.max(a, b.length), 0)
      if (longest <= 32) type = 'select'
    }

    out.push({
      key,
      type,
      options:
        type === 'select' || type === 'multi'
          ? distinct.sort((a, b) => (bucket.get(b) ?? 0) - (bucket.get(a) ?? 0)).slice(0, 60)
          : [],
      count
    })
  }

  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * The link targets a relation property points at, unresolved.
 *
 * Accepts the shapes people actually write: one link, a YAML list of links, or
 * a single string holding several. Resolving these to notes is the vault's job
 * — aliases and basenames are only known there.
 *
 * The awkward case is an *unquoted* `project: [[Website rebuild]]`, which is
 * what everyone types because that is how a link looks. YAML reads it as a
 * sequence nested in a sequence, so by the time it arrives here the brackets
 * are gone and it is `[["Website rebuild"]]`. A nested array is therefore
 * treated as a link in its own right — otherwise the most common way of
 * writing a relation is the one way that silently does not work.
 */
export function relationTargets(value: unknown): string[] {
  const out: string[] = []

  const visit = (entry: unknown, nested: boolean): void => {
    if (entry == null) return

    if (Array.isArray(entry)) {
      // A bare inner array is YAML's rendering of `[[Name]]`; its items are
      // the link text. A top-level array is just a list of values.
      if (nested) {
        const name = entry.map((v) => String(v)).join(', ').trim()
        if (name) out.push(name)
        return
      }
      for (const item of entry) visit(item, true)
      return
    }

    const text = String(entry)
    for (const match of text.matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const name = match[1].trim()
      if (name) out.push(name)
    }
  }

  visit(value, false)
  return out
}

/** Render a property for display in a table cell or card. */
export function formatProperty(value: unknown, type: PropertyType): string {
  if (value == null || value === '') return ''
  if (type === 'checkbox') return value ? 'Yes' : 'No'
  if (type === 'date') {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value).slice(0, 16).replace('T', ' ')
  }
  if (Array.isArray(value)) return value.join(', ')
  if (type === 'relation') return String(value).replace(/^\[\[|\]\]$/g, '')
  return String(value)
}

/** Compare two property values for sorting, with empties always last. */
export function compareProperty(a: unknown, b: unknown, type: PropertyType): number {
  const aEmpty = a == null || a === ''
  const bEmpty = b == null || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  if (type === 'number') return Number(a) - Number(b)
  if (type === 'checkbox') return Number(Boolean(b)) - Number(Boolean(a))
  return formatProperty(a, type).localeCompare(formatProperty(b, type), undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

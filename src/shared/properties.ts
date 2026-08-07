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

function typeOfValue(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (value instanceof Date) return 'date'
  if (Array.isArray(value)) return 'multi'
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

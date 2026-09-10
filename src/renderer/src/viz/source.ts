/**
 * Reading the source of a program figure.
 *
 * The fences share a shape: a few `key: value` directives, then a body whose
 * indentation carries structure. They also share a set of trailing
 * annotations — a colour, a highlight, a second line of text — because a
 * figure is worth much less if the one node you are talking about cannot be
 * picked out from the rest.
 *
 * Two rules run through everything here. Directive keys are matched against a
 * list the caller supplies rather than "anything before a colon", so a heap
 * field called `next: null` is never mistaken for a setting. And a line that
 * cannot be understood raises with the line number, because a figure that
 * quietly drops the row you just typed is worse than one that says which row it
 * could not read.
 */

import { isAccent } from './svg'

/** A parse failure, reported to the reader with the line that caused it. */
export class VizError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`)
    this.name = 'VizError'
  }
}

export interface SourceLine {
  /** The line with indentation and trailing space removed. */
  text: string
  /** Indentation in columns, a tab counting as two. */
  indent: number
  /** 1-based, counted within the fence body, for error messages. */
  n: number
}

export interface ParsedSource {
  directives: Map<string, string>
  lines: SourceLine[]
}

function indentOf(raw: string): number {
  let columns = 0
  for (const ch of raw) {
    if (ch === ' ') columns += 1
    else if (ch === '\t') columns += 2
    else break
  }
  return columns
}

/**
 * Split a fence into its directives and its body.
 *
 * Directives may appear anywhere, not just at the top: someone tidying a long
 * `algo` block should be able to leave `speed:` next to the steps it governs.
 * A bare `---` is allowed as a visual break between the two and is dropped.
 * Blank lines and `#` comments are dropped as well — the body's structure is
 * carried by indentation, and a blank line inside a tree should not end it.
 */
export function readSource(source: string, keys: readonly string[]): ParsedSource {
  const allowed = new Set(keys)
  const directives = new Map<string, string>()
  const lines: SourceLine[] = []

  source.split('\n').forEach((raw, index) => {
    const text = raw.trim()
    if (!text || text === '---' || text.startsWith('#')) return

    const directive = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(text)
    if (directive && allowed.has(directive[1].toLowerCase())) {
      directives.set(directive[1].toLowerCase(), directive[2].trim())
      return
    }

    lines.push({ text, indent: indentOf(raw), n: index + 1 })
  })

  return { directives, lines }
}

/** Whether a directive reads as on. Absent is off; bare presence is on. */
export function flag(directives: Map<string, string>, key: string): boolean {
  if (!directives.has(key)) return false
  const value = (directives.get(key) ?? '').toLowerCase()
  return value === '' || value === 'true' || value === 'yes' || value === 'on'
}

export function numeric(directives: Map<string, string>, key: string, fallback: number): number {
  const raw = directives.get(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export interface Annotated {
  /** The text on the face of the thing. */
  label: string
  /** A second, smaller line — a height, an index, a type. */
  sub?: string
  accent?: string
  /** Ringed, for the node the paragraph beside the figure is about. */
  highlight?: boolean
  /** Faded, for a node not reached yet, or freed. */
  dim?: boolean
}

/**
 * Peel the annotations off the end of a label.
 *
 * The label comes first and may contain spaces — `struct Node` is one label,
 * not two. Everything after it is recognised by its sigil, and only from the
 * end, so a label may itself contain a `*` or a `#` as long as it is not the
 * last token. `|` splits off a second line, and is checked first because the
 * annotations may sit on either side of it.
 */
export function annotate(raw: string): Annotated {
  const parts = raw.split('|')
  let head = parts[0].trim()
  const sub = parts.length > 1 ? parts.slice(1).join('|').trim() : undefined

  const out: Annotated = { label: head, sub: sub || undefined }

  // Walk in from the end for as long as the last token is an annotation.
  for (;;) {
    const match = /\s(\S+)$/.exec(head)
    if (!match) break
    const token = match[1]
    if (token === '*') out.highlight = true
    else if (token === '~') out.dim = true
    else if (token.startsWith('#') && isAccent(token.slice(1))) out.accent = token.slice(1)
    else break
    head = head.slice(0, match.index)
  }

  // A one-token line can still be an annotation-free label, so the flags are
  // only stripped above, never from a label that is nothing but a flag.
  out.label = head.trim()
  return out
}

/** `.`, `_` and `null` all mean "there is no node here". */
export function isNull(text: string): boolean {
  const value = text.trim().toLowerCase()
  return value === '.' || value === '_' || value === 'null' || value === 'nil' || value === 'none'
}

/**
 * Split a list written the way a person writes one: spaces, commas, or both.
 *
 * `1, 2, 3` and `1 2 3` are the same list. Quoted items survive with their
 * spaces, so a cell may hold `"to do"`.
 */
export function items(text: string): string[] {
  const out: string[] = []
  let current = ''
  let quote = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ',' || ch === ' ' || ch === '\t') {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

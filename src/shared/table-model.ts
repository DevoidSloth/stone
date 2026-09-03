/**
 * The pipe-table primitives, shared.
 *
 * The editor's in-place table editing and the markdown-to-HTML pass both have
 * to answer the same two questions — where do the cells split, and which way
 * does each column align — and a table that renders left-aligned on paper
 * because the exporter has its own idea of the rule row is exactly the kind of
 * drift keeping one copy prevents.
 */

export type CellAlign = 'left' | 'center' | 'right'

export const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
/** The alignment row: pipes, dashes and colons, and at least one dash. */
export const TABLE_RULE_RE = /^[\s|:-]*-[\s|:-]*$/

/** Split a table row on unescaped pipes, dropping the outer pair. */
export function splitRow(text: string): string[] {
  const body = text.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += ch
  }
  cells.push(cell.trim())
  return cells
}

/** `:---`, `---:`, `:---:` — per-column alignment from the rule row. */
export function alignmentsOf(rule: string): CellAlign[] {
  return splitRow(rule).map((spec) => {
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

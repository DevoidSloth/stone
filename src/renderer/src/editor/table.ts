import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Text
} from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  alignmentsOf,
  splitRow,
  TABLE_ROW_RE,
  TABLE_RULE_RE,
  type CellAlign
} from '@shared/table-model'

/**
 * The table model behind in-place editing.
 *
 * A GFM table in the document is pipes and dashes; a table on screen is a grid
 * of cells. This is the one place that knows how to go both ways, so the widget
 * can stay a dumb renderer and every structural operation — add a row, delete a
 * column — is a pure function over a `string[][]`.
 *
 * Serialising pads every column to its widest cell. That is not cosmetic: the
 * source is what a reader sees in any other editor, and a table whose pipes
 * drift by a character per keystroke is unreadable there within a minute.
 */

/**
 * Cell splitting and alignment live in `@shared/table-model`, because the
 * markdown-to-HTML pass needs the same answers and must not grow its own.
 */
export {
  alignmentsOf,
  splitRow,
  TABLE_ROW_RE,
  TABLE_RULE_RE,
  type CellAlign
} from '@shared/table-model'

export interface TableModel {
  /** 1-based document lines the whole table occupies, rule row included. */
  fromLine: number
  toLine: number
  /** Header first, then the body. The rule row is not a row. */
  rows: string[][]
  align: CellAlign[]
}

/** The width every row is padded to: the widest row, or the rule's. */
function widthOf(rows: string[][], align: CellAlign[]): number {
  return Math.max(1, align.length, ...rows.map((r) => r.length))
}

/** A cell's text as it belongs in the source: pipes escaped, edges trimmed. */
function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * The table this line belongs to, or null.
 *
 * Scans outwards from the line so it works from any row, and insists on the
 * rule row in second position — without it, a run of pipes is just text.
 */
export function findTable(doc: Text, lineNumber: number): TableModel | null {
  if (lineNumber < 1 || lineNumber > doc.lines) return null
  if (!TABLE_ROW_RE.test(doc.line(lineNumber).text)) return null

  let fromLine = lineNumber
  while (fromLine > 1 && TABLE_ROW_RE.test(doc.line(fromLine - 1).text)) fromLine--

  let toLine = lineNumber
  while (toLine < doc.lines && TABLE_ROW_RE.test(doc.line(toLine + 1).text)) toLine++

  if (toLine <= fromLine) return null
  if (!TABLE_RULE_RE.test(doc.line(fromLine + 1).text)) return null

  const align = alignmentsOf(doc.line(fromLine + 1).text)
  const rows: string[][] = []
  for (let n = fromLine; n <= toLine; n++) {
    if (n === fromLine + 1) continue
    rows.push(splitRow(doc.line(n).text))
  }

  return { fromLine, toLine, rows, align }
}

/** The table at the caret, for the structural commands. */
export function tableAtCursor(state: EditorState): TableModel | null {
  const line = state.doc.lineAt(state.selection.main.head)
  return findTable(state.doc, line.number)
}

/** `| a | b |` with every column padded to its widest cell. */
export function serialize(rows: string[][], align: CellAlign[]): string {
  const width = widthOf(rows, align)
  const grid = rows.map((row) =>
    Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? ''))
  )

  const widths = Array.from({ length: width }, (_, i) =>
    // Three is the narrowest a rule cell can be and still carry both colons.
    Math.max(3, ...grid.map((row) => [...row[i]].length))
  )

  const pad = (text: string, i: number): string => {
    const gap = widths[i] - [...text].length
    const at = align[i] ?? 'left'
    if (at === 'right') return ' '.repeat(gap) + text
    if (at === 'center') {
      const left = Math.floor(gap / 2)
      return ' '.repeat(left) + text + ' '.repeat(gap - left)
    }
    return text + ' '.repeat(gap)
  }

  const rule = widths.map((w, i) => {
    const at = align[i] ?? 'left'
    if (at === 'center') return `:${'-'.repeat(w - 2)}:`
    if (at === 'right') return `${'-'.repeat(w - 1)}:`
    return '-'.repeat(w)
  })

  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  const [head, ...body] = grid
  return [line(head.map(pad)), line(rule), ...body.map((row) => line(row.map(pad)))].join('\n')
}

// ------------------------------------------------------------- operations

/** A copy of `rows` with every row padded to the table's full width. */
function rectangular(rows: string[][], align: CellAlign[]): string[][] {
  const width = widthOf(rows, align)
  return rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
}

export interface TableEdit {
  rows: string[][]
  align: CellAlign[]
  /** Where the caret should land afterwards, as a cell. */
  focus: { row: number; col: number }
}

/** Treat an edit as a model again, so operations compose into one write. */
export function asModel(model: TableModel, edit: TableEdit): TableModel {
  return { fromLine: model.fromLine, toLine: model.toLine, rows: edit.rows, align: edit.align }
}

export function setCell(model: TableModel, row: number, col: number, text: string): TableEdit {
  const rows = rectangular(model.rows, model.align)
  rows[row][col] = text
  return { rows, align: [...model.align], focus: { row, col } }
}

export function insertRow(model: TableModel, at: number): TableEdit {
  const rows = rectangular(model.rows, model.align)
  // Never above the header: the first row of a GFM table is not a body row.
  const index = Math.max(1, Math.min(at, rows.length))
  rows.splice(index, 0, new Array(rows[0].length).fill(''))
  return { rows, align: [...model.align], focus: { row: index, col: 0 } }
}

export function insertColumn(model: TableModel, at: number): TableEdit {
  const rows = rectangular(model.rows, model.align)
  const width = rows[0].length
  const index = Math.max(0, Math.min(at, width))
  for (const row of rows) row.splice(index, 0, '')
  const align = [...model.align]
  while (align.length < width) align.push('left')
  align.splice(index, 0, 'left')
  return { rows, align, focus: { row: 0, col: index } }
}

export function deleteRow(model: TableModel, at: number): TableEdit | null {
  const rows = rectangular(model.rows, model.align)
  // The header is the table's shape; removing it leaves something that is no
  // longer a table at all, so it is refused rather than silently reinterpreted.
  if (at <= 0 || rows.length <= 2) return null
  rows.splice(at, 1)
  return { rows, align: [...model.align], focus: { row: Math.min(at, rows.length - 1), col: 0 } }
}

export function deleteColumn(model: TableModel, at: number): TableEdit | null {
  const rows = rectangular(model.rows, model.align)
  const width = rows[0].length
  if (width <= 1 || at < 0 || at >= width) return null
  for (const row of rows) row.splice(at, 1)
  const align = [...model.align]
  align.splice(at, 1)
  return { rows, align, focus: { row: 0, col: Math.min(at, width - 2) } }
}

// ---------------------------------------------------------------- writing

/**
 * Where the caret goes after a table is rewritten.
 *
 * The widget is rebuilt from scratch on every structural change, so the DOM
 * node the user was typing in no longer exists. This records which cell to
 * restore focus to; `TableWidget` reads it as it mounts.
 */
export interface PendingFocus {
  fromLine: number
  row: number
  col: number
}

let pending: PendingFocus | null = null

export function setPendingFocus(fromLine: number, row: number, col: number): void {
  pending = { fromLine, row, col }
}

export function takePendingFocus(fromLine: number): { row: number; col: number } | null {
  if (!pending || pending.fromLine !== fromLine) return null
  const { row, col } = pending
  pending = null
  return { row, col }
}

export function clearPendingFocus(): void {
  pending = null
}

/**
 * Replace a table's source with a new grid.
 *
 * Returns false when the text is unchanged, which is the common case for a
 * cell that was focused but not edited — dispatching then would push a no-op
 * onto the undo stack and rebuild the DOM under the caret for nothing.
 */
export function writeTable(view: EditorView, model: TableModel, edit: TableEdit): boolean {
  const from = view.state.doc.line(model.fromLine).from
  const to = view.state.doc.line(model.toLine).to
  const insert = serialize(edit.rows, edit.align)
  if (view.state.sliceDoc(from, to) === insert) return false

  pending = { fromLine: model.fromLine, row: edit.focus.row, col: edit.focus.col }

  // The caret must not land inside the table's own lines: live-preview shows
  // source for whatever section the selection is in, so a caret left in the
  // range would replace the grid the user is editing with raw pipes. It is
  // normally already outside — clicking a cell does not move it — so this only
  // steps in for the case where it is not.
  const head = view.state.selection.main.head
  const inside = head >= from && head <= to
  const escape = from > 0 ? from - 1 : from + insert.length

  view.dispatch({
    changes: { from, to, insert },
    ...(inside ? { selection: EditorSelection.cursor(escape) } : {})
  })
  return true
}

/**
 * Show one table as raw markdown instead of as a grid.
 *
 * Tables are the one block that stays rendered while the caret is inside it,
 * because its cells are what you edit. That leaves no accidental route back to
 * the source, so this is the deliberate one: the value is the table's first
 * line, or null to go back to the grid.
 */
export const revealTableSource = StateEffect.define<number | null>()

/**
 * The table currently showing source, by its first line.
 *
 * It follows the document through edits and clears itself once the caret is no
 * longer in that table — leaving a note and coming back should not find one
 * table still stuck in raw markdown.
 */
export const tableSource = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(revealTableSource)) return effect.value
    }
    if (value === null) return null

    let line = value
    if (tr.docChanged) {
      const from = tr.startState.doc.line(Math.min(value, tr.startState.doc.lines)).from
      line = tr.newDoc.lineAt(tr.changes.mapPos(from, 1)).number
    }

    const table = findTable(tr.state.doc, line)
    if (!table) return null

    const head = tr.state.selection.main.head
    const inside =
      head >= tr.state.doc.line(table.fromLine).from && head <= tr.state.doc.line(table.toLine).to
    return inside ? table.fromLine : null
  }
})

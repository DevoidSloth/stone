import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type Text
} from '@codemirror/state'
import { getIndentUnit, syntaxTree } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'
import type { Command, EditorView } from '@codemirror/view'

/**
 * Lists that carry themselves.
 *
 * Enter at the end of a list item starts the next one, and Backspace at the
 * start of an item takes the marker back off — the two halves of the same
 * gesture, and the thing that makes typing a list feel like a list rather than
 * like typing hyphens.
 *
 * `@codemirror/lang-markdown` ships most of this as `insertNewlineContinueMarkup`
 * and `deleteMarkupBackward`, and plain bullets, ordered lists and blockquotes
 * are left to it. Two cases are handled here instead:
 *
 *  - **Tasks.** Its checkbox pattern is `[ xX]`, so Stone's `[/]` (doing) and
 *    `[-]` (cancelled) lines fall through it and continue as bare bullets,
 *    losing the checkbox. Ordered tasks lose it either way, since the ordered
 *    branch never looks for one. Every continued task starts unchecked, which
 *    is the only sensible reading of "another one of these".
 *  - **Backspace on an item that is not the first.** The stock command replaces
 *    the marker with spaces there rather than removing it, leaving an indent
 *    behind that quietly turns the next thing typed into a nested block.
 *
 * The rest of the file is the outline half of a list: nesting an item under the
 * one above it, lifting it back out, and moving it past its neighbours — each
 * carrying the item's children with it, and each leaving an ordered list
 * correctly numbered afterwards. CodeMirror has none of these, because none of
 * them are markdown: they are operations on a tree that only exists in the
 * reader's head, and every one of them has to reconstruct it from indentation
 * first.
 */

/** `  - `, `* `, `1. `, each optionally followed by a `[ ]` checkbox. */
const ITEM_RE = /^([ \t]*)(?:([-*+])|(\d+)([.)]))([ \t]+)(\[[ xX/-]\](?:[ \t]+|$))?/

export interface Item {
  indent: string
  /** `-`, `*`, `+`, or `3.` — whatever opens the item. */
  marker: string
  /** The number of an ordered item, or null for a bullet. */
  ordinal: number | null
  /** The gap between marker and content, preserved so alignment survives. */
  space: string
  /** `[x] ` including its trailing space, or null when this is a plain bullet. */
  checkbox: string | null
  /** Column just past the marker: where a checkbox would start. */
  markerEnd: number
  /** Column the item's own text starts at. */
  contentStart: number
  body: string
}

export function itemAt(line: Line): Item | null {
  const m = ITEM_RE.exec(line.text)
  if (!m) return null
  const marker = m[2] ?? `${m[3]}${m[4]}`
  return {
    indent: m[1],
    marker,
    ordinal: m[3] ? Number(m[3]) : null,
    space: m[5],
    checkbox: m[6] ?? null,
    markerEnd: m[1].length + marker.length + m[5].length,
    contentStart: m[0].length,
    body: line.text.slice(m[0].length)
  }
}

/**
 * Whether this position is prose rather than code.
 *
 * A fenced block full of shell script is exactly where a line starting with `-`
 * is a flag and not a bullet, and continuing it would be wrong.
 */
function inProse(state: EditorState, pos: number): boolean {
  if (!markdownLanguage.isActiveAt(state, pos, -1) && !markdownLanguage.isActiveAt(state, pos, 1)) {
    return false
  }
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
  }
  return true
}

/** One level of indentation off the front, tabs counting as a level each. */
function dedent(indent: string, unit: number): string {
  if (indent.endsWith('\t')) return indent.slice(0, -1)
  return indent.slice(0, Math.max(0, indent.length - unit))
}

/**
 * Renumber the items after the one at `pos`, starting from `startAt`.
 *
 * Inserting `3.` in front of what used to be item 3 leaves every number below
 * it one short. Walking the syntax tree rather than the lines is what keeps a
 * nested list, or a paragraph indented under an item, from being counted.
 */
function renumberFollowing(state: EditorState, pos: number, startAt: number): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1)
  while (node && node.name !== 'ListItem') node = node.parent
  if (!node || node.parent?.name !== 'OrderedList') return changes

  let n = startAt
  for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (sibling.name !== 'ListItem') continue
    const m = /^([ \t]*)(\d+)(?=[.)])/.exec(state.doc.sliceString(sibling.from, sibling.from + 12))
    if (!m) break
    changes.push({
      from: sibling.from + m[1].length,
      to: sibling.from + m[0].length,
      insert: String(n)
    })
    n++
  }
  return changes
}

/**
 * Enter on a task line: start the next task, unchecked.
 *
 * Returns false for anything that is not a task, so plain lists and quotes
 * reach the stock command bound after this one.
 */
export const continueTask: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  // Multiple carets, or a caret with a selection, are the stock command's
  // problem: it handles both, and half-handling them here would be worse.
  if (!range.empty || state.selection.ranges.length > 1) return false

  const line = state.doc.lineAt(range.from)
  const item = itemAt(line)
  if (!item || !item.checkbox) return false
  if (range.from - line.from < item.contentStart) return false
  if (!inProse(state, range.from)) return false

  // An empty task means the list is finished. Nested, that steps out one level;
  // at the margin it clears the line, so Enter twice ends a list the way it
  // does everywhere else.
  if (item.body.trim() === '') {
    const insert = item.indent
      ? `${dedent(item.indent, getIndentUnit(state))}${item.marker}${item.space}[ ] `
      : ''
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(line.from + insert.length),
      scrollIntoView: true,
      userEvent: 'input'
    })
    return true
  }

  const marker =
    item.ordinal === null ? item.marker : `${item.ordinal + 1}${item.marker.slice(-1)}`
  const insert = `\n${item.indent}${marker}${item.space}[ ] `

  // Trailing spaces are litter on the line being left behind — but only when
  // the caret is at the end of it. Splitting an item mid-sentence must not eat
  // the space in front of the caret.
  let from = range.from
  if (range.from === line.to) {
    while (from > line.from + item.contentStart && /[ \t]/.test(line.text[from - line.from - 1])) {
      from--
    }
  }

  const changes: ChangeSpec[] = [{ from, to: range.from, insert }]
  if (item.ordinal !== null) {
    changes.push(...renumberFollowing(state, range.from, item.ordinal + 2))
  }

  view.dispatch({
    changes,
    selection: EditorSelection.cursor(from + insert.length),
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/**
 * Backspace at the start of an item's text: take one piece of markup off.
 *
 * A task loses its checkbox first and becomes a bullet, then the bullet goes,
 * leaving the line's indentation — one visible thing per press, each of them
 * undoable on its own.
 */
export const removeListMarkup: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (!range.empty || state.selection.ranges.length > 1) return false

  const line = state.doc.lineAt(range.from)
  const item = itemAt(line)
  if (!item || range.from - line.from !== item.contentStart) return false
  if (!inProse(state, range.from)) return false

  // With no checkbox these are the same column, and the marker itself goes.
  const from = line.from + (item.checkbox ? item.markerEnd : item.indent.length)
  view.dispatch({
    changes: { from, to: line.from + item.contentStart, insert: '' },
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
    userEvent: 'delete'
  })
  return true
}

// ------------------------------------------------------------- structure

/**
 * The visual columns a run of leading whitespace occupies.
 *
 * Indentation is compared by column rather than by character because a list is
 * allowed to mix the two: a tab and four spaces are the same nesting level to
 * every markdown renderer, and an outline that disagreed with the renderer
 * about which item is whose child would move the wrong lines.
 */
export function columnsOf(indent: string, unit: number): number {
  let cols = 0
  for (const ch of indent) cols = ch === '\t' ? (Math.floor(cols / unit) + 1) * unit : cols + 1
  return cols
}

/** The leading whitespace of a line, as columns. */
function indentOf(text: string, unit: number): number {
  return columnsOf(/^[ \t]*/.exec(text)![0], unit)
}

/**
 * The last line belonging to the item on `lineNumber` — the item itself plus
 * everything indented under it.
 *
 * Blank lines inside the subtree are stepped over rather than ending it, since
 * a list with air between its items is still one list, but a run of blanks at
 * the end is not swept in: `end` only ever advances onto a line that is really
 * indented under the item.
 */
export function subtreeEnd(doc: Text, lineNumber: number, unit: number): number {
  const item = itemAt(doc.line(lineNumber))
  if (!item) return lineNumber
  const indent = columnsOf(item.indent, unit)
  let end = lineNumber
  for (let n = lineNumber + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    if (indentOf(text, unit) <= indent) break
    end = n
  }
  return end
}

/**
 * The whole list the item on `lineNumber` sits in.
 *
 * Every one of these gestures rewrites a block of lines rather than a set of
 * ranges, and the block has to be the entire list: nesting item three changes
 * the numbering of items four and five, which are not in the selection and not
 * in the subtree.
 */
function listBounds(doc: Text, lineNumber: number, unit: number): { first: number; last: number } {
  let first = lineNumber
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = doc.line(n).text
    // A blank is only inside the list if a list line turns up above it, which
    // is exactly what leaving `first` alone until then decides.
    if (!text.trim()) continue
    if (!itemAt(doc.line(n)) && indentOf(text, unit) === 0) break
    first = n
  }

  let last = lineNumber
  for (let n = lineNumber + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    if (!itemAt(doc.line(n)) && indentOf(text, unit) === 0) break
    last = n
  }

  return { first, last }
}

/** The item above this one at the same level, or null when it is the first. */
function previousSibling(doc: Text, lineNumber: number, cols: number, unit: number): number | null {
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    const indent = indentOf(text, unit)
    if (indent > cols) continue
    if (indent < cols) return null
    return itemAt(doc.line(n)) ? n : null
  }
  return null
}

/** The item below this subtree at the same level, or null when it is the last. */
function nextSibling(doc: Text, after: number, cols: number, unit: number): number | null {
  for (let n = after + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    const indent = indentOf(text, unit)
    if (indent > cols) continue
    if (indent < cols) return null
    return itemAt(doc.line(n)) ? n : null
  }
  return null
}

/**
 * The column a new child of `parent` should sit at.
 *
 * A list that already nests answers this itself — matching the children it has
 * keeps a two-space vault two-space, whatever the editor's indent unit happens
 * to be set to. Only a parent with no children yet falls back to the setting.
 */
function childIndent(doc: Text, parent: number, cols: number, unit: number): number {
  const end = subtreeEnd(doc, parent, unit)
  for (let n = parent + 1; n <= end; n++) {
    const line = doc.line(n)
    if (!itemAt(line)) continue
    const indent = indentOf(line.text, unit)
    if (indent > cols) return indent
  }
  return cols + unit
}

/** The column an item lifted out of its parent should land on. */
function parentIndent(doc: Text, lineNumber: number, cols: number, unit: number): number {
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    const indent = indentOf(text, unit)
    if (indent >= cols) continue
    return itemAt(doc.line(n)) ? indent : Math.max(0, cols - unit)
  }
  return Math.max(0, cols - unit)
}

/**
 * Re-indent one line to `cols`, keeping whatever it indents *with*.
 *
 * A vault written with tabs stays written with tabs: the character already on
 * the line decides, and only a line with no indentation of its own to copy
 * takes spaces.
 */
function reindent(text: string, cols: number, unit: number): string {
  const indent = /^[ \t]*/.exec(text)![0]
  const body = text.slice(indent.length)
  if (!body) return text
  const next = Math.max(0, cols)
  if (indent.includes('\t')) return '\t'.repeat(Math.round(next / unit)) + body
  return ' '.repeat(next) + body
}

// ------------------------------------------------------------ renumbering

const ORDINAL_RE = /^([ \t]*)(\d+)([.)])([ \t])/

/**
 * Put every ordered run in a block back in sequence.
 *
 * A run is the items at one column with nothing shallower between them, so a
 * nested list does not interrupt the one it is nested in, and a bullet at the
 * same level ends the run rather than being counted into it.
 *
 * A run whose items are *all* the same number is left exactly as it is. `1.`
 * on every line is legal CommonMark and a deliberate style — the renderer
 * numbers it — and rewriting it would be the editor overruling the author on a
 * line they never touched.
 */
function renumber(lines: string[], unit: number): string[] {
  const out = [...lines]
  const open = new Map<number, number[]>()
  const runs: number[][] = []

  const close = (keep: (level: number) => boolean): void => {
    for (const [level, run] of [...open]) {
      if (keep(level)) continue
      runs.push(run)
      open.delete(level)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    if (!text.trim()) continue
    const cols = indentOf(text, unit)
    close((level) => level <= cols)

    if (!ORDINAL_RE.test(text)) {
      // A bullet, or prose, at this level: whatever numbering was running here
      // has ended, but a deeper one carries on above it.
      close((level) => level !== cols)
      continue
    }

    const run = open.get(cols)
    if (run) run.push(i)
    else open.set(cols, [i])
  }
  close(() => false)

  for (const run of runs) {
    if (run.length < 2) continue
    const ordinals = run.map((i) => Number(ORDINAL_RE.exec(out[i])![2]))
    if (ordinals.every((n) => n === ordinals[0])) continue
    let n = ordinals[0]
    for (const i of run) {
      out[i] = out[i].replace(ORDINAL_RE, (_all, indent, _ordinal, dot, space) =>
        `${indent}${n}${dot}${space}`
      )
      n++
    }
  }

  return out
}

// --------------------------------------------------------------- rewriting

/**
 * Replace a block of lines with new ones, carrying the selection across.
 *
 * The caret is put back by line and by distance from the end of that line,
 * which is what keeps it where the word it was next to went: nesting an item
 * lengthens its indentation in front of the caret, and moving one changes the
 * line's number without touching its text.
 */
function rewrite(
  view: EditorView,
  first: number,
  last: number,
  lines: string[],
  /** Where the line at each original index within the block ended up. */
  moved: (index: number) => number
): boolean {
  const { state } = view
  const doc = state.doc
  const from = doc.line(first).from
  const to = doc.line(last).to
  const insert = lines.join('\n')
  if (insert === doc.sliceString(from, to)) return false

  const starts: number[] = []
  let at = from
  for (const line of lines) {
    starts.push(at)
    at += line.length + 1
  }

  const place = (pos: number): number => {
    const line = doc.lineAt(pos)
    const index = moved(line.number - first)
    const start = starts[index]
    if (start === undefined) return Math.min(pos, from + insert.length)
    return Math.max(start, start + lines[index].length - (line.to - pos))
  }

  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.create(
      state.selection.ranges.map((range) =>
        EditorSelection.range(place(range.anchor), place(range.head))
      ),
      state.selection.mainIndex
    ),
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/**
 * The items a gesture acts on: every item the selection touches, minus the ones
 * that are already somebody's child. Indenting a parent indents its children
 * with it, and shifting them a second time for being selected too would double
 * the nesting of half the list.
 */
function selectedItems(state: EditorState, unit: number): number[] {
  const doc = state.doc
  const range = state.selection.main
  const items: number[] = []
  for (let n = doc.lineAt(range.from).number; n <= doc.lineAt(range.to).number; n++) {
    if (!itemAt(doc.line(n))) continue
    const previous = items[items.length - 1]
    if (previous !== undefined && n <= subtreeEnd(doc, previous, unit)) continue
    items.push(n)
  }
  return items
}

/**
 * Whether a *numbered* item sits above `index` at the same column.
 *
 * Asked of the lines after the shift, because that is the question that
 * matters: an item that has just been nested may be the only thing at its new
 * level, and a list that starts at `4.` because that is what the item happened
 * to be numbered before it moved is nobody's idea of a list. A bullet at the
 * same column is a different list, not a sibling to count from.
 */
function precededByOrdinal(lines: string[], index: number, cols: number, unit: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const text = lines[i]
    if (!text.trim()) continue
    const indent = indentOf(text, unit)
    if (indent > cols) continue
    if (indent < cols) return false
    return ORDINAL_RE.test(text)
  }
  return false
}

/** Everything both nesting commands do apart from choosing the new column. */
function shiftItems(view: EditorView, target: (cols: number, line: number) => number | null): boolean {
  const { state } = view
  // One caret at a time. Nesting rewrites whole blocks of lines, and two carets
  // in two different lists would each want a block of their own.
  if (state.selection.ranges.length > 1) return false

  const unit = getIndentUnit(state)
  const items = selectedItems(state, unit)
  if (items.length === 0) return false
  if (!inProse(state, state.selection.main.head)) return false

  const doc = state.doc
  const bounds = listBounds(doc, items[0], unit)
  const last = Math.max(bounds.last, ...items.map((n) => subtreeEnd(doc, n, unit)))
  const lines: string[] = []
  for (let n = bounds.first; n <= last; n++) lines.push(doc.line(n).text)

  let shifted = false
  for (const n of items) {
    const cols = indentOf(doc.line(n).text, unit)
    const to = target(cols, n)
    if (to === null || to === cols) continue
    const delta = to - cols
    for (let i = n; i <= subtreeEnd(doc, n, unit); i++) {
      const index = i - bounds.first
      lines[index] = reindent(lines[index], indentOf(lines[index], unit) + delta, unit)
    }

    // A numbered item that lands somewhere with no sibling above it has started
    // a list rather than joined one, and a list starts at one. `renumber` below
    // cannot decide this: from its side a run of a single `4.` is just a list
    // someone chose to begin at four, which is legal and meant.
    const index = n - bounds.first
    if (!precededByOrdinal(lines, index, to, unit)) {
      lines[index] = lines[index].replace(ORDINAL_RE, (_all, indent, _ordinal, dot, space) =>
        `${indent}1${dot}${space}`
      )
    }
    shifted = true
  }

  // Tab on the first item of a list has nothing to nest it under. Swallowing it
  // is the point: falling through to a plain indent would push the item out to
  // a column no renderer reads as a child of anything.
  if (!shifted) return true

  return rewrite(view, bounds.first, last, renumber(lines, unit), (index) => index)
}

/**
 * Tab inside a list item: nest it, and its children, under the item above.
 *
 * Returns false outside a list so Tab keeps meaning a plain indent everywhere
 * else — inside a code fence most of all, where it is a character.
 */
export const indentListItem: Command = (view) =>
  shiftItems(view, (cols, line) => {
    const doc = view.state.doc
    const unit = getIndentUnit(view.state)
    const previous = previousSibling(doc, line, cols, unit)
    return previous === null ? null : childIndent(doc, previous, cols, unit)
  })

/** Shift-Tab inside a list item: lift it, and its children, out one level. */
export const outdentListItem: Command = (view) => {
  const state = view.state
  const unit = getIndentUnit(state)
  // At the margin there is nothing to come out of, and returning false lets
  // Shift-Tab go back to being an ordinary dedent.
  const items = selectedItems(state, unit)
  if (items.every((n) => indentOf(state.doc.line(n).text, unit) === 0)) return false

  return shiftItems(view, (cols, line) =>
    cols === 0 ? null : parentIndent(view.state.doc, line, cols, unit)
  )
}

/**
 * Alt-Up and Alt-Down inside a list: swap the item with its neighbour.
 *
 * The item's children come along, which is the whole difference between this
 * and the stock "move line up": an outline moves by subtrees, and moving one
 * line of a nested item leaves its children orphaned under whatever ends up
 * above them.
 */
function moveItem(view: EditorView, forward: boolean): boolean {
  const { state } = view
  const range = state.selection.main
  if (!range.empty || state.selection.ranges.length > 1) return false

  const doc = state.doc
  const unit = getIndentUnit(state)
  const line = doc.lineAt(range.head).number
  const item = itemAt(doc.line(line))
  if (!item) return false
  if (!inProse(state, range.head)) return false

  const cols = columnsOf(item.indent, unit)
  const end = subtreeEnd(doc, line, unit)

  // The two runs to swap. Each takes the blank lines between the items with it,
  // so the gaps in a spaced-out list stay where they were rather than piling up
  // at one end of it.
  // With no neighbour to swap with there is nothing to do — but "nothing" and
  // "let the stock move-line have it" are different answers. An item with
  // children cannot be handed over: moving its first line alone would leave the
  // children under whatever ended up above them. A leaf can, because moving one
  // line of it is moving all of it.
  const sibling = forward
    ? nextSibling(doc, end, cols, unit)
    : previousSibling(doc, line, cols, unit)
  if (sibling === null) return end > line

  let from: number
  let mid: number
  let to: number
  if (forward) {
    from = line
    mid = sibling
    to = subtreeEnd(doc, sibling, unit)
  } else {
    from = sibling
    mid = line
    to = end
  }

  const bounds = listBounds(doc, line, unit)
  const first = Math.min(bounds.first, from)
  const last = Math.max(bounds.last, to)

  const lines: string[] = []
  for (let n = first; n <= last; n++) lines.push(doc.line(n).text)

  // Indices within the block, and the swap itself: the second run first, then
  // the first run, everything outside the two left alone.
  const head = from - first
  const split = mid - first
  const tail = to - first + 1
  const swapped = [
    ...lines.slice(0, head),
    ...lines.slice(split, tail),
    ...lines.slice(head, split),
    ...lines.slice(tail)
  ]

  const moved = (index: number): number => {
    if (index < head || index >= tail) return index
    if (index < split) return index + (tail - split)
    return index - (split - head)
  }

  return rewrite(view, first, last, renumber(swapped, unit), moved)
}

export const moveListItemUp: Command = (view) => moveItem(view, false)
export const moveListItemDown: Command = (view) => moveItem(view, true)

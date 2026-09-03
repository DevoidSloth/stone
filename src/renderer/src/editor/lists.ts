import { EditorSelection, type ChangeSpec, type EditorState, type Line } from '@codemirror/state'
import { getIndentUnit, syntaxTree } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'
import type { Command } from '@codemirror/view'

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
 */

/** `  - `, `* `, `1. `, each optionally followed by a `[ ]` checkbox. */
const ITEM_RE = /^([ \t]*)(?:([-*+])|(\d+)([.)]))([ \t]+)(\[[ xX/-]\](?:[ \t]+|$))?/

interface Item {
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

function itemAt(line: Line): Item | null {
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

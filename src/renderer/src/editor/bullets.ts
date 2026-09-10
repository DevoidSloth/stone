import type { EditorSelection, Text } from '@codemirror/state'
import { columnsOf, itemAt } from './lists'

/**
 * How deeply nested every list item in the document is.
 *
 * Markdown has no such thing as a nesting level — it has leading whitespace,
 * and a renderer that turns runs of it into a tree. Two spaces, four spaces and
 * a tab are all "one level in" depending only on what the item above used, so
 * depth cannot be read off a single line: it comes from a stack, the same way
 * the parser builds it.
 *
 * Everything the bullet layer draws is keyed off this. Depth chooses the glyph
 * and the column the item hangs from, which is what lets the editor lay a list
 * out on a uniform grid while the file on disk keeps whatever indentation was
 * typed into it.
 *
 * Lezer's own tree would answer the same question, but only for the part of the
 * document it has parsed, and it has to be walked upward per line to get a
 * depth out. This is one pass, and it is the pass `buildLineDecorations` is
 * already making.
 */
export interface ListLine {
  /** Nesting level, 0 for an item against the margin. */
  depth: number
  /** Characters from the start of the line to the item's own text. */
  prefix: number
  /** `-`, `*`, `+`, or `12.` — whatever opens the item. */
  marker: string
  ordered: boolean
  /** A task draws a checkbox in the marker's place rather than a bullet. */
  task: boolean
}

/**
 * Every list line in the document, by line number.
 *
 * `isCode` marks the lines inside fenced blocks, where a leading `-` is a flag
 * or a YAML key and not a bullet. Those lines are read as plain text: an
 * indented fence inside a list item keeps the list open, and one at the margin
 * closes it, which is exactly what a paragraph there would do.
 */
export function listGeometry(
  doc: Text,
  unit: number,
  isCode?: (line: number) => boolean
): Map<number, ListLine> {
  const geometry = new Map<number, ListLine>()
  /** The column each open level starts at, innermost last. */
  const levels: number[] = []

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const item = isCode?.(n) ? null : itemAt(line)

    if (!item) {
      // A blank line is allowed between items; a paragraph indented under one
      // belongs to it. Anything else at the margin ends the list.
      if (!line.text.trim()) continue
      if (levels.length && columnsOf(/^[ \t]*/.exec(line.text)![0], unit) > levels[levels.length - 1]) {
        continue
      }
      levels.length = 0
      continue
    }

    const cols = columnsOf(item.indent, unit)
    while (levels.length && cols < levels[levels.length - 1]) levels.pop()
    if (!levels.length || cols > levels[levels.length - 1]) levels.push(cols)

    geometry.set(n, {
      depth: levels.length - 1,
      prefix: item.contentStart,
      marker: item.marker,
      ordered: item.ordinal !== null,
      task: item.checkbox !== null
    })
  }

  return geometry
}

/**
 * The items whose raw prefix should be showing, because the caret is in it.
 *
 * The rest of live preview reveals a whole line at a time, and for a list
 * marker that is too blunt. Clicking into the third word of an item three
 * levels deep would swap a 72-pixel grid for eight literal spaces and a hyphen,
 * jumping the line — and every line under it — sideways, for a piece of markup
 * nobody was going to edit.
 *
 * So the prefix reveals only when the selection actually reaches into it. The
 * caret can still get there — Left from the start of the text lands inside the
 * marker and it appears, whole and editable — but typing in an item leaves the
 * list where it is.
 */
export function revealedPrefixes(
  selection: EditorSelection,
  doc: Text,
  lists: Map<number, ListLine>
): Set<number> {
  const revealed = new Set<number>()
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number
    const last = doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      const item = lists.get(n)
      if (!item) continue
      const line = doc.line(n)
      // A caret exactly at the end of the prefix is in the item's text, not in
      // its marker — that is where Enter and Backspace leave it, and it must
      // not be a position that redraws the line.
      if (range.from < line.from + item.prefix && range.to >= line.from) revealed.add(n)
    }
  }
  return revealed
}

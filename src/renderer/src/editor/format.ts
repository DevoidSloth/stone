import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * The formatting commands, shared by the keymap and the selection toolbar.
 *
 * Every one of them is a toggle. Applying bold to text that is already bold
 * unwraps it rather than nesting a second pair of asterisks, because the
 * toolbar shows state and a button that only ever adds cannot be pressed twice
 * without producing `****text****`.
 */

/** Markers that wrap a run of text, longest first so `**` beats `*`. */
export type InlineMarker = '**' | '*' | '~~' | '==' | '`' | '_'

/** Trailing and leading whitespace inside a selection is not part of the word. */
function trimmedRange(text: string, from: number): { from: number; to: number; text: string } {
  const lead = /^\s*/.exec(text)![0].length
  const trail = /\s*$/.exec(text)![0].length
  const inner = text.slice(lead, text.length - trail)
  return { from: from + lead, to: from + text.length - trail, text: inner }
}

/**
 * True when the marker already wraps this range — either inside the selection
 * (`**bold**` selected whole) or immediately outside it (`bold` selected with
 * the asterisks left out, which is what a double-click gives you).
 */
function wrapState(
  view: EditorView,
  from: number,
  to: number,
  marker: string
): 'inside' | 'outside' | 'none' {
  const { state } = view
  const text = state.sliceDoc(from, to)

  /**
   * `**bold**` is not italic. A one-character probe would otherwise match half
   * of a two-character marker and report every bold run as italic too — and
   * unwrapping it would strip one asterisk from each side, leaving `*bold*`.
   */
  const halfOfADouble = (leftOf: string, rightOf: string): boolean =>
    marker.length === 1 && (leftOf === marker || rightOf === marker)

  if (text.length > marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)) {
    if (!halfOfADouble(text[marker.length], text[text.length - marker.length - 1])) return 'inside'
  }

  const before = state.sliceDoc(Math.max(0, from - marker.length), from)
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + marker.length))
  if (before === marker && after === marker) {
    const outerLeft = state.sliceDoc(Math.max(0, from - marker.length * 2), Math.max(0, from - marker.length))
    const outerRight = state.sliceDoc(
      Math.min(state.doc.length, to + marker.length),
      Math.min(state.doc.length, to + marker.length * 2)
    )
    if (!halfOfADouble(outerLeft, outerRight)) return 'outside'
  }

  return 'none'
}

export function isWrapped(view: EditorView, marker: InlineMarker): boolean {
  const { from, to } = view.state.selection.main
  if (from === to) return false
  const range = trimmedRange(view.state.sliceDoc(from, to), from)
  return wrapState(view, range.from, range.to, marker) !== 'none'
}

/** Wrap the selection in a marker, or unwrap it when it is already wrapped. */
export function wrapSelection(view: EditorView, marker: InlineMarker): boolean {
  const changes = view.state.changeByRange((range) => {
    // With no selection, drop an empty pair and put the caret between them.
    if (range.empty) {
      return {
        changes: { from: range.from, insert: `${marker}${marker}` },
        range: EditorSelection.cursor(range.from + marker.length)
      }
    }

    const inner = trimmedRange(view.state.sliceDoc(range.from, range.to), range.from)
    const state = wrapState(view, inner.from, inner.to, marker)

    if (state === 'inside') {
      const bare = inner.text.slice(marker.length, -marker.length)
      return {
        changes: { from: inner.from, to: inner.to, insert: bare },
        range: EditorSelection.range(inner.from, inner.from + bare.length)
      }
    }

    if (state === 'outside') {
      return {
        changes: [
          { from: inner.from - marker.length, to: inner.from },
          { from: inner.to, to: inner.to + marker.length }
        ],
        range: EditorSelection.range(inner.from - marker.length, inner.to - marker.length)
      }
    }

    return {
      changes: { from: inner.from, to: inner.to, insert: `${marker}${inner.text}${marker}` },
      range: EditorSelection.range(inner.from, inner.to + marker.length * 2)
    }
  })

  view.dispatch(changes)
  view.focus()
  return true
}

// ------------------------------------------------------------- line prefixes

const HEADING_RE = /^(\s*)(#{1,6})\s+/
const QUOTE_RE = /^(\s*)>\s?/
const BULLET_RE = /^(\s*)[-*+]\s+(?:\[[ xX/-]\]\s+)?/
const NUMBER_RE = /^(\s*)\d+[.)]\s+/
const TASK_RE = /^(\s*)[-*+]\s+\[[ xX/-]\]\s+/

/** The lines the selection touches, whole. */
function selectedLines(view: EditorView): { from: number; to: number; text: string }[] {
  const { from, to } = view.state.selection.main
  const first = view.state.doc.lineAt(from).number
  const last = view.state.doc.lineAt(to).number
  const lines: { from: number; to: number; text: string }[] = []
  for (let n = first; n <= last; n++) {
    const line = view.state.doc.line(n)
    lines.push({ from: line.from, to: line.to, text: line.text })
  }
  return lines
}

/** Strip whatever block marker a line already carries, keeping its indent. */
function bareLine(text: string): { indent: string; body: string } {
  const indent = /^\s*/.exec(text)![0]
  let body = text.slice(indent.length)
  body = body.replace(/^>\s?/, '')
  body = body.replace(/^#{1,6}\s+/, '')
  body = body.replace(/^[-*+]\s+\[[ xX/-]\]\s+/, '')
  body = body.replace(/^[-*+]\s+/, '')
  body = body.replace(/^\d+[.)]\s+/, '')
  return { indent, body }
}

export type BlockKind = 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'number' | 'task' | 'paragraph'

export function blockKindAt(view: EditorView): BlockKind {
  const text = view.state.doc.lineAt(view.state.selection.main.head).text
  const heading = HEADING_RE.exec(text)
  if (heading) {
    const level = Math.min(heading[2].length, 3)
    return `h${level}` as BlockKind
  }
  if (TASK_RE.test(text)) return 'task'
  if (QUOTE_RE.test(text)) return 'quote'
  if (BULLET_RE.test(text)) return 'bullet'
  if (NUMBER_RE.test(text)) return 'number'
  return 'paragraph'
}

/**
 * Turn every selected line into a block of this kind, or back into a paragraph
 * when they are all that kind already. Toggling matches how the same button
 * behaves in Notion and Obsidian.
 */
export function setBlockKind(view: EditorView, kind: BlockKind): boolean {
  const lines = selectedLines(view)
  const already = lines.every((line) => {
    const text = line.text
    switch (kind) {
      case 'h1':
        return /^\s*#\s/.test(text)
      case 'h2':
        return /^\s*##\s/.test(text)
      case 'h3':
        return /^\s*###\s/.test(text)
      case 'quote':
        return QUOTE_RE.test(text)
      case 'task':
        return TASK_RE.test(text)
      case 'bullet':
        return BULLET_RE.test(text) && !TASK_RE.test(text)
      case 'number':
        return NUMBER_RE.test(text)
      default:
        return false
    }
  })

  const target: BlockKind = already ? 'paragraph' : kind
  const changes: ChangeSpec[] = []
  let ordinal = 1

  for (const line of lines) {
    const { indent, body } = bareLine(line.text)
    // A blank line has nothing to mark up, and prefixing it leaves litter.
    if (!body.trim() && target !== 'paragraph') continue

    let prefix = ''
    switch (target) {
      case 'h1':
        prefix = '# '
        break
      case 'h2':
        prefix = '## '
        break
      case 'h3':
        prefix = '### '
        break
      case 'quote':
        prefix = '> '
        break
      case 'bullet':
        prefix = '- '
        break
      case 'task':
        prefix = '- [ ] '
        break
      case 'number':
        prefix = `${ordinal++}. `
        break
      default:
        prefix = ''
    }

    const next = `${indent}${prefix}${body}`
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }

  if (changes.length === 0) return false
  view.dispatch({ changes })
  view.focus()
  return true
}

// -------------------------------------------------------------------- links

const URL_LIKE = /^(?:https?:\/\/|www\.|mailto:)\S+$/i

/**
 * `[text](url)` around the selection. A selection that is itself a URL becomes
 * the target with the caret left in the label, which is the common case when
 * you paste a link and then decide to name it.
 */
export function makeLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)

  if (URL_LIKE.test(text.trim())) {
    const url = text.trim()
    const insert = `[](${url})`
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + 1)
    })
  } else {
    const insert = `[${text}]()`
    view.dispatch({
      changes: { from, to, insert },
      // Caret inside the empty parens, ready for the address.
      selection: EditorSelection.cursor(from + text.length + 3)
    })
  }
  view.focus()
  return true
}

/** `[[Selection]]`, so highlighted text can become a note link in one step. */
export function makeWikilink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to).trim()
  if (!text) return false
  if (text.startsWith('[[') && text.endsWith(']]')) {
    const bare = text.slice(2, -2)
    view.dispatch({
      changes: { from, to, insert: bare },
      selection: EditorSelection.range(from, from + bare.length)
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `[[${text}]]` },
      selection: EditorSelection.range(from, from + text.length + 4)
    })
  }
  view.focus()
  return true
}

/** Strip every inline marker from the selection, leaving the words. */
export function clearFormatting(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  if (from === to) return false
  const text = view.state.sliceDoc(from, to)
  const bare = text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      (alias ?? target).trim()
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  if (bare === text) return false
  view.dispatch({
    changes: { from, to, insert: bare },
    selection: EditorSelection.range(from, from + bare.length)
  })
  view.focus()
  return true
}

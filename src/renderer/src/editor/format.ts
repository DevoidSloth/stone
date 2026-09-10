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
export type InlineMarker =
  | '**'
  | '*'
  | '~~'
  | '=='
  | '`'
  | '_'
  | '$'
  | '<u>'
  | '<sup>'
  | '<sub>'

/**
 * The closing half of a marker.
 *
 * Every markdown marker closes with itself. Underline, superscript and
 * subscript have none — CommonMark deliberately leaves all three out, and
 * `__text__` is bold — so they borrow the HTML tags that Obsidian, GitHub and
 * this app's own exporter all pass through, and those close differently.
 */
function closerOf(marker: InlineMarker): string {
  return marker.startsWith('<') ? `</${marker.slice(1)}` : marker
}

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
  marker: InlineMarker
): 'inside' | 'outside' | 'none' {
  const { state } = view
  const text = state.sliceDoc(from, to)
  const open = marker
  const close = closerOf(marker)

  /**
   * `**bold**` is not italic. A one-character probe would otherwise match half
   * of a two-character marker and report every bold run as italic too — and
   * unwrapping it would strip one asterisk from each side, leaving `*bold*`.
   */
  const halfOfADouble = (leftOf: string, rightOf: string): boolean =>
    marker.length === 1 && (leftOf === marker || rightOf === marker)

  if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
    if (!halfOfADouble(text[open.length], text[text.length - close.length - 1])) return 'inside'
  }

  const before = state.sliceDoc(Math.max(0, from - open.length), from)
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + close.length))
  if (before === open && after === close) {
    const outerLeft = state.sliceDoc(Math.max(0, from - open.length * 2), Math.max(0, from - open.length))
    const outerRight = state.sliceDoc(
      Math.min(state.doc.length, to + close.length),
      Math.min(state.doc.length, to + close.length * 2)
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
  const open = marker
  const close = closerOf(marker)

  const changes = view.state.changeByRange((range) => {
    // With no selection, drop an empty pair and put the caret between them.
    if (range.empty) {
      return {
        changes: { from: range.from, insert: `${open}${close}` },
        range: EditorSelection.cursor(range.from + open.length)
      }
    }

    const inner = trimmedRange(view.state.sliceDoc(range.from, range.to), range.from)
    const state = wrapState(view, inner.from, inner.to, marker)

    if (state === 'inside') {
      const bare = inner.text.slice(open.length, -close.length)
      return {
        changes: { from: inner.from, to: inner.to, insert: bare },
        range: EditorSelection.range(inner.from, inner.from + bare.length)
      }
    }

    if (state === 'outside') {
      return {
        changes: [
          { from: inner.from - open.length, to: inner.from },
          { from: inner.to, to: inner.to + close.length }
        ],
        range: EditorSelection.range(inner.from - open.length, inner.to - open.length)
      }
    }

    return {
      changes: { from: inner.from, to: inner.to, insert: `${open}${inner.text}${close}` },
      range: EditorSelection.range(inner.from, inner.to + open.length + close.length)
    }
  })

  view.dispatch(changes)
  view.focus()
  return true
}

/**
 * Maths, from one key.
 *
 * With text selected, or with the caret in the middle of a sentence, this is
 * plain inline `$…$`. On a line of its own there is nothing to wrap and the
 * user is almost certainly after a centred equation, so it opens the `$$` block
 * form instead and drops the caret inside it — otherwise pressing the key on an
 * empty line would leave a bare `$$` sitting there, which reads as the *start*
 * of a display block and swallows everything below it until the next one.
 */
export function insertMath(view: EditorView): boolean {
  const range = view.state.selection.main
  if (!range.empty) return wrapSelection(view, '$')

  const line = view.state.doc.lineAt(range.head)
  if (line.text.trim() !== '') return wrapSelection(view, '$')

  const insert = '$$\n\n$$'
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: EditorSelection.cursor(line.from + 3)
  })
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

/**
 * Wrap a selection in a link when a URL is pasted over it.
 *
 * Every editor people arrive from does this, and without it pasting a URL onto
 * a phrase you deliberately highlighted destroys the phrase — the one outcome
 * nobody wants. Returns false when this is an ordinary paste, so the caller
 * lets the default behaviour run.
 */
export function linkPastedUrl(view: EditorView, pasted: string): boolean {
  const url = pasted.trim()
  if (!URL_LIKE.test(url)) return false

  const { from, to } = view.state.selection.main
  if (from === to) return false

  const text = view.state.sliceDoc(from, to)
  // A selection that is already markup is not a label; replacing it wholesale
  // is what the user asked for.
  if (/[[\]()]/.test(text)) return false

  const insert = `[${text}](${url})`
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length)
  })
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

/**
 * Paint the selection, or strip the paint off it.
 *
 * `kind` picks which of the two colours a run can carry: the ink, written as a
 * `<span style="color:…">`, or the wash behind it, written as a `<mark>`. A
 * null colour removes that wrapper, and applying a second colour replaces the
 * first rather than nesting — two spans deep, the inner one wins and the outer
 * one is invisible markup nobody can see to delete.
 */
export function applyColour(
  view: EditorView,
  kind: 'ink' | 'wash',
  colour: string | null
): boolean {
  const { from, to } = view.state.selection.main
  if (from === to) return false

  const tag = kind === 'ink' ? 'span' : 'mark'
  const property = kind === 'ink' ? 'color' : 'background'
  const strip =
    kind === 'ink'
      ? /^<span style="color:[^"]*">([\s\S]*)<\/span>$/i
      : /^<mark style="background:[^"]*">([\s\S]*)<\/mark>$/i

  const inner = trimmedRange(view.state.sliceDoc(from, to), from)

  /*
   * A run that is already painted is repainted, not wrapped again — whether the
   * selection took the tags in with it or stopped at the words between them.
   * The second case is the common one: double-clicking a coloured word selects
   * the word, and wrapping that would leave an outer span nobody can see to
   * delete and an inner one doing all the work.
   */
  const opener =
    kind === 'ink' ? /<span style="color:[^"]*">$/i : /<mark style="background:[^"]*">$/i
  const closer = kind === 'ink' ? /^<\/span>/i : /^<\/mark>/i
  const before = view.state.sliceDoc(Math.max(0, inner.from - 80), inner.from)
  const after = view.state.sliceDoc(inner.to, Math.min(view.state.doc.length, inner.to + 8))
  const around = opener.exec(before)
  const wrapped = around !== null && closer.test(after)

  const start = wrapped ? inner.from - around[0].length : inner.from
  const end = wrapped ? inner.to + closer.exec(after)![0].length : inner.to
  const bare = wrapped ? inner.text : (strip.exec(inner.text)?.[1] ?? inner.text)
  const insert = colour ? `<${tag} style="${property}: ${colour}">${bare}</${tag}>` : bare

  view.dispatch({
    changes: { from: start, to: end, insert },
    selection: EditorSelection.range(start, start + insert.length)
  })
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
    .replace(/<(u|sup|sub)>([\s\S]*?)<\/\1>/gi, '$2')
    // A colour is formatting too, and Tx is the one button that says so.
    .replace(/<span style="(?:color|background)[^"]*">([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<mark(?: style="[^"]*")?>([\s\S]*?)<\/mark>/gi, '$1')
    .replace(/%%([\s\S]*?)%%/g, '$1')
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

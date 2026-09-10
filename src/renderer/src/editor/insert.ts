import { EditorSelection, type EditorState, type Line } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * A handle on the editor the user was last in.
 *
 * Anything outside the editor that wants to write into the note — so far, the
 * Claude dialog — needs the *caret*, not just the text: the store holds the
 * document, but replacing that whole string moves the cursor to the top and
 * scrolls the note away from where the user was reading. So the view registers
 * itself here, and insertions go through CodeMirror as a normal transaction,
 * which means they also land in the undo history and can be taken back.
 *
 * Last one focused wins, which is the right answer with a split editor.
 */
let active: EditorView | null = null

export function setActiveEditor(view: EditorView): void {
  active = view
}

/** Called on unmount: only clears if this view is still the registered one. */
export function clearActiveEditor(view: EditorView): void {
  if (active === view) active = null
}

export function activeEditor(): EditorView | null {
  return active && active.dom.isConnected ? active : null
}

/**
 * Every open view, by the note it is showing.
 *
 * Written into by something that started a while ago and has just finished —
 * an animation Claude was asked for while the user carried on typing. Such an
 * answer belongs in the note it was asked from, which is not necessarily the
 * one being looked at when it lands, and it has to arrive as a small
 * transaction rather than a new document: replacing the whole text would take
 * the caret to the top and the undo history with it.
 *
 * A note can be open in two panes, and the first one still in the document
 * wins — the change reaches the other through the store like any other edit.
 */
const views = new Map<string, Set<EditorView>>()

export function registerEditor(docKey: string, view: EditorView): void {
  const open = views.get(docKey) ?? new Set<EditorView>()
  open.add(view)
  views.set(docKey, open)
}

export function unregisterEditor(docKey: string, view: EditorView): void {
  const open = views.get(docKey)
  if (!open) return
  open.delete(view)
  if (open.size === 0) views.delete(docKey)
}

/** The view showing a note, or null when it is not open anywhere. */
export function editorFor(docKey: string): EditorView | null {
  for (const view of views.get(docKey) ?? []) if (view.dom.isConnected) return view
  return null
}

/** Registers a view on focus, so clicking between panes retargets insertion. */
export const trackFocus = EditorView.domEventHandlers({
  focus(_event, view) {
    setActiveEditor(view)
    return false
  }
})

/** The text the user has selected, or '' when the selection is empty. */
export function selectedText(): string {
  const view = activeEditor()
  if (!view) return ''
  const { from, to } = view.state.selection.main
  return from === to ? '' : view.state.sliceDoc(from, to)
}

export function documentText(): string {
  return activeEditor()?.state.doc.toString() ?? ''
}

/**
 * Where a block of markdown should go, given where the caret is.
 *
 * Split out from the dispatch so the spacing rules can be checked without a
 * DOM: the whole job is getting the blank lines right, and every one of those
 * cases is a one-character difference that is invisible until a fence ends up
 * glued to the paragraph under it.
 *
 * It lands *below* the caret's line and never over a selection — the selection
 * is what the user asked Claude to work from, so consuming it would delete the
 * source of the answer.
 *
 * The one line it will not land under is a line inside a fenced block. A block
 * dropped there does not go into the note, it goes into the *program*: it cuts
 * the fence in half and turns everything after it into prose. That is a caret
 * position people are in constantly here — reading the manual about a fence
 * while the caret sits in one, asking Claude about the code it is parked in —
 * so the insertion moves past the closing fence rather than splitting it.
 */
/**
 * The line to insert under, given the one the caret is on.
 *
 * The same as the caret's line, unless that line is inside a fenced block, in
 * which case it is the fence's closing line. Whether a line is inside one is
 * counted from the top of the document rather than parsed, because that is the
 * only reading that agrees with the one CodeMirror's own markdown mode does: an
 * unclosed fence swallows the rest of the note, and an insertion under a caret
 * inside *that* has nowhere better to go than the end.
 */
function escapeFence(state: EditorState, from: Line): Line {
  const doc = state.doc
  const fence = /^\s*(```|~~~)/
  let open = false
  for (let n = 1; n <= from.number; n++) {
    if (fence.test(doc.line(n).text)) open = !open
  }
  if (!open) return from

  for (let n = from.number + 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (fence.test(line.text)) return line
  }
  return doc.line(doc.lines)
}

export function blockInsertion(
  state: EditorState,
  text: string,
  /** Where the block is aimed. Defaults to the caret, which is the usual case;
   *  a drop passes the position the pointer let go at instead. */
  pos = Math.max(state.selection.main.from, state.selection.main.to)
): { at: number; insert: string } {
  const line = escapeFence(state, state.doc.lineAt(Math.min(Math.max(pos, 0), state.doc.length)))
  // A blank line is the gap the user left for it; anything else gets the block
  // after the whole line, so a caret mid-sentence does not split the sentence.
  const at = line.text.trim() === '' ? line.from : line.to

  const before = state.doc.sliceString(0, at)
  const after = state.doc.sliceString(at)

  // One blank line on each side — but counting the newlines already there
  // rather than adding two regardless, which is what leaves a growing gap
  // every time a block is dropped between two paragraphs.
  const padding = (text_: string, want: number, from: 'end' | 'start'): string => {
    const run = from === 'end' ? /\n*$/.exec(text_) : /^\n*/.exec(text_)
    return '\n'.repeat(Math.max(0, want - (run?.[0].length ?? 0)))
  }

  const prefix = before.trim() === '' ? '' : padding(before, 2, 'end')
  // Nothing below means nothing to separate from: end the line and stop, rather
  // than leaving a trailing blank line behind at the bottom of the note.
  const suffix = after.trim() === '' ? padding(after, 1, 'start') : padding(after, 2, 'start')

  return { at, insert: `${prefix}${text.trim()}${suffix}` }
}

/**
 * Drop a block of markdown in below the caret.
 *
 * Returns false when no editor is open, which is the dialog's cue to keep the
 * result on screen instead of losing it.
 */
export function insertBlock(text: string): boolean {
  const view = activeEditor()
  if (!view) return false

  const { at, insert } = blockInsertion(view.state, text)
  view.dispatch({
    changes: { from: at, to: at, insert },
    // Just past the block, ready to keep writing under it.
    selection: EditorSelection.cursor(at + insert.length),
    scrollIntoView: true
  })
  view.focus()
  return true
}

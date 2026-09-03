import { EditorSelection, type EditorState } from '@codemirror/state'
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
 */
export function blockInsertion(
  state: EditorState,
  text: string,
  /** Where the block is aimed. Defaults to the caret, which is the usual case;
   *  a drop passes the position the pointer let go at instead. */
  pos = Math.max(state.selection.main.from, state.selection.main.to)
): { at: number; insert: string } {
  const line = state.doc.lineAt(Math.min(Math.max(pos, 0), state.doc.length))
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

/**
 * Auto-closing block comments.
 *
 * `closeBrackets()` already does this for `(`, `[`, `{` and quotes — type the
 * open half and the close half appears with the caret between them. It has no
 * opinion about comments, because a comment delimiter is not a bracket to
 * CodeMirror: `/*` is two ordinary characters, not a pairable token, so typing
 * it inserts nothing on its own.
 *
 * This extension is the same idea, generalised to whatever multi-character
 * pair a language's own grammar declares. `@codemirror/lang-javascript`,
 * `-cpp`, `-java`, `-rust`, `-css` and the rest already publish a block
 * comment as `commentTokens` language data — the same field
 * `toggleBlockComment` reads — so there is nothing to hard-code per language.
 * A language with no block comment (Python, JSON) simply has no `block`
 * entry, and typing in it is untouched.
 */

import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface CommentTokens {
  block?: { open: string; close: string }
}

function blockCommentAt(view: EditorView, pos: number): { open: string; close: string } | null {
  const found = view.state.languageDataAt<CommentTokens>('commentTokens', pos)
  for (const tokens of found) if (tokens.block) return tokens.block
  return null
}

/**
 * Type the last character of a block comment's opening token and its closing
 * token appears right after the caret, the same way a `(` gets its `)`.
 *
 * Typing character by character is what makes this safe without any state to
 * track: `/` alone never matches `/*`, so nothing happens until the second
 * character completes it. And if the closing token is already sitting right
 * where it would go — someone completing a comment that already has one — it
 * is left alone rather than doubled.
 */
export function closeComments(): Extension {
  return EditorView.inputHandler.of((view, from, to, insertedText) => {
    if (from !== to || !insertedText) return false

    const comment = blockCommentAt(view, from)
    if (!comment) return false
    const { open, close } = comment

    const justTyped = view.state.doc.sliceString(Math.max(0, from - open.length + insertedText.length), from) + insertedText
    if (!justTyped.endsWith(open)) return false

    const ahead = view.state.doc.sliceString(from, from + close.length)
    if (ahead === close) return false

    view.dispatch({
      changes: { from, to, insert: insertedText + close },
      selection: { anchor: from + insertedText.length },
      userEvent: 'input.type'
    })
    return true
  })
}

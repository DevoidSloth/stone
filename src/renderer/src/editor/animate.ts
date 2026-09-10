import type { Text } from '@codemirror/state'
import { describeError } from '../lib/errors'
import { useStone } from '../store'
import { activeEditor, editorFor, insertBlock, selectedText } from './insert'
import { notePathFacet } from './run-code'

/**
 * An animated algorithm, asked for from inside the note.
 *
 * Claude takes a minute or two over one of these — thirty or forty steps, each
 * of which has to be right about what the array looks like by then — and the
 * whole point of asking for it from the note rather than from a dialog is that
 * the minute is spent writing. So nothing here blocks: the block goes into the
 * document immediately, holding the space the figure will need, and the request
 * runs behind it. The note carries on underneath.
 *
 * The placeholder is real source, not a spinner parked over the text. A
 * `pending:` directive names the request and `prompt:` says what was asked for,
 * which means the block is legible in any other editor, survives the app being
 * closed, and can be deleted by the user like anything else they typed. When
 * the answer lands it replaces exactly those lines — as one small transaction,
 * so the caret stays where the writing got to and the whole thing is one undo
 * away.
 */

/** Enough of a selection to work from; past this it is a note, not an example. */
const CONTEXT_LIMIT = 20_000

/** A directive is one line, and the prompt is shown on the face of the block. */
const PROMPT_LIMIT = 120

/**
 * The requests this session has out.
 *
 * A placeholder is a line in a file, and a file outlives the process that wrote
 * it: quit while one is being drawn and the block is still there tomorrow,
 * describing a request that no longer exists. So the figure asks whether its
 * request is actually live before it says anything is coming.
 */
const drawing = new Set<string>()

/** Whether that request is still out, for the figure standing in for it. */
export function isDrawing(id: string): boolean {
  return drawing.has(id)
}

let counter = 0

function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter.toString(36)}`
}

function oneLine(text: string, limit = PROMPT_LIMIT): string {
  const said = text.replace(/\s+/g, ' ').trim()
  return said.length > limit ? `${said.slice(0, limit - 1)}…` : said
}

function waitingBlock(id: string, subject: string): string {
  return ['```algo', `pending: ${id}`, `prompt: ${oneLine(subject)}`, '```'].join('\n')
}

function failedBlock(subject: string, message: string): string {
  // No `pending`, so nothing will try to fill it in again — and the prompt
  // stays, because the prompt is the part worth another try.
  return ['```algo', `prompt: ${oneLine(subject)}`, `error: ${oneLine(message, 300)}`, '```'].join(
    '\n'
  )
}

/**
 * The `algo` block out of a reply.
 *
 * The mode asks for one fenced block and nothing else, and main puts the fence
 * back on a bare answer. This is the case where it came back as something else
 * entirely — a mermaid diagram, a paragraph of apology — which is worth saying
 * plainly rather than pasting into the note as though it were a figure.
 */
function algoFence(reply: string): string | null {
  const found = /```[ \t]*algo[ \t]*\r?\n([\s\S]*?)```/i.exec(reply)
  if (!found) return null
  const body = found[1].replace(/\s+$/, '')
  return body.trim() ? `\`\`\`algo\n${body}\n\`\`\`` : null
}

/** The lines of the block waiting on this request, if it is still there. */
function waitingLines(lines: string[], id: string): { first: number; last: number } | null {
  const mine = new RegExp(`^\\s*pending:\\s*${id}\\s*$`)
  for (let n = 0; n < lines.length; n++) {
    if (!/^\s*```\s*algo\s*$/i.test(lines[n])) continue
    for (let end = n + 1; end < lines.length; end++) {
      if (/^\s*```\s*$/.test(lines[end])) {
        for (let body = n + 1; body < end; body++) {
          if (mine.test(lines[body])) return { first: n, last: end }
        }
        n = end
        break
      }
    }
  }
  return null
}

function docLines(doc: Text): string[] {
  const out: string[] = []
  for (let n = 1; n <= doc.lines; n++) out.push(doc.line(n).text)
  return out
}

/**
 * Put the answer where the placeholder is.
 *
 * Through the view when the note is open, because that keeps the caret, the
 * scroll and the undo history — someone mid-sentence three paragraphs below
 * should not be able to tell that anything happened but the figure appearing.
 * Through the store when it is not, which rewrites the file the way any
 * background edit does. And if the block has gone, the user deleted it while it
 * was being drawn, which is an answer of its own: say so and drop it.
 */
function settle(notePath: string, id: string, block: string): boolean {
  const view = editorFor(notePath)
  if (view) {
    const range = waitingLines(docLines(view.state.doc), id)
    if (range) {
      const doc = view.state.doc
      const from = doc.line(range.first + 1).from
      const to = doc.line(range.last + 1).to
      view.dispatch({ changes: { from, to, insert: block } })
      return true
    }
  }

  const doc = useStone.getState().docs[notePath]
  if (doc) {
    const lines = doc.content.split('\n')
    const range = waitingLines(lines, id)
    if (range) {
      lines.splice(range.first, range.last - range.first + 1, block)
      useStone.getState().setDoc(notePath, lines.join('\n'))
      return true
    }
  }
  return false
}

async function draw(
  notePath: string,
  id: string,
  subject: string,
  context: string | null
): Promise<void> {
  const store = (): ReturnType<typeof useStone.getState> => useStone.getState()
  try {
    const result = await window.stone.claude.run({
      id: `algo-${id}`,
      mode: 'animation',
      prompt: subject,
      context
    })
    const block = algoFence(result.text)
    if (!block) {
      const said = 'Claude answered with something that was not an animation.'
      settle(notePath, id, failedBlock(subject, said))
      store().toast(said, 'error')
      return
    }
    if (!settle(notePath, id, block)) {
      store().toast('The animation was ready, but the block it was for had gone.', 'info')
      return
    }
    // Only worth saying when they are somewhere else — if they are watching the
    // block, the figure appearing in it is the notification.
    if (activeEditor()?.state.facet(notePathFacet) !== notePath) {
      store().toast(`The animation landed in ${notePath.replace(/\.md$/, '')}.`, 'success')
    }
  } catch (err) {
    const message = describeError(err)
    // Cancelled from somewhere else: leave the note exactly as it was found.
    if (message === 'cancelled') {
      settle(notePath, id, failedBlock(subject, 'That request was stopped.'))
      return
    }
    settle(notePath, id, failedBlock(subject, message))
    store().toast(`That animation could not be drawn: ${message}`, 'error')
  } finally {
    drawing.delete(id)
  }
}

/**
 * Ask for one, and get straight back out of the way.
 *
 * The selection goes along as context rather than as the question: someone who
 * has highlighted their own quicksort and asked for an animation means "this
 * one", and the sentence they typed is still what is being asked.
 */
export function startAnimation(subject: string): void {
  const view = activeEditor()
  if (!view) {
    useStone.getState().toast('Open a note for the animation to go in.', 'error')
    return
  }

  const notePath = view.state.facet(notePathFacet)
  const context = selectedText().trim().slice(0, CONTEXT_LIMIT) || null
  const id = newId()
  drawing.add(id)
  if (!insertBlock(waitingBlock(id, subject))) {
    drawing.delete(id)
    return
  }
  void draw(notePath, id, subject, context)
}

/** The command and the slash entry: ask what it is for, unless that was typed. */
export async function askForAnimation(seed: string): Promise<void> {
  const typed = seed.trim()
  if (typed) {
    startAnimation(typed)
    return
  }
  const asked = await useStone.getState().askText({
    title: 'Animate an algorithm',
    placeholder: 'Bubble sort over 5 3 8 1 9',
    confirmLabel: 'Generate'
  })
  if (asked?.trim()) startAnimation(asked.trim())
}

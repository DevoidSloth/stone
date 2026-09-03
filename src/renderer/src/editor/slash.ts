import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useStone } from '../store'

/**
 * The slash menu.
 *
 * Notion's defining interaction: type `/` and pick a block instead of
 * remembering markdown. It is built on CodeMirror's completion source rather
 * than a bespoke popup so that arrow keys, Enter, Escape, filtering and
 * scroll-into-view all behave the way every other menu in the editor does.
 *
 * Each command replaces the typed `/query` with its snippet. `|` marks where
 * the caret should end up, and is stripped before insertion.
 */

interface Block {
  label: string
  detail: string
  keywords: string
  snippet: string
  /** Replace the whole line rather than just the slash token. */
  wholeLine?: boolean
  /**
   * Runs instead of inserting the snippet, for a block that cannot be written
   * as text — picking a file takes a dialog and a round trip to main, so the
   * slash token is cleared first and the markdown arrives when it arrives.
   */
  action?: (view: EditorView) => void
}

const BLOCKS: Block[] = [
  { label: 'Heading 1', detail: 'Large section title', keywords: 'h1 title', snippet: '# |', wholeLine: true },
  { label: 'Heading 2', detail: 'Section title', keywords: 'h2 subtitle', snippet: '## |', wholeLine: true },
  { label: 'Heading 3', detail: 'Sub-section', keywords: 'h3', snippet: '### |', wholeLine: true },
  { label: 'Bulleted list', detail: 'A simple list', keywords: 'ul bullet point', snippet: '- |', wholeLine: true },
  { label: 'Numbered list', detail: 'An ordered list', keywords: 'ol ordered number', snippet: '1. |', wholeLine: true },
  { label: 'To-do', detail: 'A task with a checkbox', keywords: 'task checkbox todo', snippet: '- [ ] |', wholeLine: true },
  {
    label: 'To-do with a date',
    detail: 'A task due tomorrow',
    keywords: 'task due date schedule',
    snippet: '- [ ] | @tomorrow',
    wholeLine: true
  },
  {
    label: 'Repeating to-do',
    detail: 'A task that comes back',
    keywords: 'task repeat recurring weekly',
    snippet: '- [ ] | @tomorrow &weekly',
    wholeLine: true
  },
  { label: 'Quote', detail: 'Set text apart', keywords: 'blockquote citation', snippet: '> |', wholeLine: true },
  {
    label: 'Callout',
    detail: 'A tinted panel',
    keywords: 'note info admonition aside',
    snippet: '> [!note] |',
    wholeLine: true
  },
  {
    label: 'Callout — tip',
    detail: 'A green panel',
    keywords: 'tip hint success',
    snippet: '> [!tip] |',
    wholeLine: true
  },
  {
    label: 'Callout — warning',
    detail: 'A yellow panel',
    keywords: 'warning caution careful',
    snippet: '> [!warning] |',
    wholeLine: true
  },
  { label: 'Divider', detail: 'A horizontal rule', keywords: 'hr rule line separator', snippet: '---\n|', wholeLine: true },
  {
    label: 'Code block',
    detail: 'Fenced, with syntax colours',
    keywords: 'code fence snippet',
    snippet: '```\n|\n```',
    wholeLine: true
  },
  {
    label: 'Table',
    detail: 'A three-column table',
    keywords: 'table grid rows columns',
    snippet: '|     |     |     |\n| --- | --- | --- |\n|     |     |     |',
    wholeLine: true
  },
  {
    label: 'Diagram',
    detail: 'A Mermaid flowchart',
    keywords: 'mermaid chart flow graph diagram',
    snippet: '```mermaid\nflowchart TD\n  A[Start] --> B[|]\n```',
    wholeLine: true
  },
  {
    label: 'Drawing',
    detail: 'An inline SVG picture',
    keywords: 'svg drawing picture illustration vector sketch',
    snippet:
      '```svg\n<svg viewBox="0 0 800 450">\n  <circle cx="400" cy="225" r="120" fill="none" stroke="currentColor" stroke-width="2" />\n  |\n</svg>\n```',
    wholeLine: true
  },
  {
    label: 'Memory diagram',
    detail: 'Stack frames, heap objects, and the pointers between them',
    keywords: 'memory pointer heap stack struct node linked list reference diagram',
    snippet:
      '```memory\nstack:\n  main:\n    head -> n1\nheap:\n  n1 Node { val: 1, next -> n2 }\n  n2 Node { val: 2, next: null }|\n```\n',
    wholeLine: true
  },
  {
    label: 'Box and pointer',
    detail: 'Variables, objects, and what points at what',
    keywords: 'box pointer object reference variable java python heap field array list',
    snippet:
      '```boxes\nb -> board\n\nboard CBoard:\n  cells -> grid\n\ngrid Int[][] [ ->r0, ->r1 ]|\n```\n',
    wholeLine: true
  },
  {
    label: 'Cons list',
    detail: 'SICP-style pairs, one line',
    keywords: 'cons pair lisp scheme sicp cdr car list',
    snippet: '```memory\npairs: 1 2 3|\n```\n',
    wholeLine: true
  },
  {
    label: 'Tree',
    detail: 'A binary tree, heap, or BST, from an array',
    keywords: 'tree binary bst heap node traversal inorder leetcode',
    snippet: '```tree\nlevel: 5 3 8 2 4 . 9|\n```\n',
    wholeLine: true
  },
  {
    label: 'Algorithm run',
    detail: 'An array and the steps, played back',
    keywords: 'algorithm animation sort search step trace array stack queue playback',
    snippet:
      '```algo\narray: 5 3 8 1\n---\ncompare 0 1\nswap 0 1\nnote |\n```\n',
    wholeLine: true
  },
  {
    label: 'Maths block',
    detail: 'Display equation',
    keywords: 'math latex katex equation formula',
    // `$$` rather than a ```math fence: both render the same here, but this is
    // the form Obsidian, GitHub and every LaTeX-aware editor also understand,
    // so the note stays readable outside Stone.
    snippet: '$$\n|\n$$',
    wholeLine: true
  },
  {
    label: 'Query',
    detail: 'A live list of notes or tasks',
    keywords: 'query database view dataview list filter',
    snippet: '```stone\nfrom: |\nwhere: status is active\nsort: edited desc\n```\n',
    wholeLine: true
  },
  {
    label: 'Image',
    detail: 'Embed a picture from this computer',
    keywords: 'image picture photo png jpg screenshot embed attach file',
    snippet: '',
    action: (view) => void insertPickedFiles(view)
  },
  {
    label: 'PDF',
    detail: 'Embed a page of a document',
    keywords: 'pdf document paper attach file embed',
    snippet: '',
    action: (view) => void insertPickedFiles(view)
  },
  {
    label: 'Recording',
    detail: 'Record a lecture and stamp your notes as you type',
    keywords: 'record recording audio lecture mic microphone transcribe transcript voice',
    snippet: '',
    action: () => void useStone.getState().startRecording()
  },
  {
    label: 'Hyperlink',
    detail: 'A link to a web address',
    keywords: 'link hyperlink url web http address external',
    snippet: '[|]()'
  },
  { label: 'Link to a note', detail: 'A wikilink', keywords: 'link wikilink reference', snippet: '[[|]]' },
  { label: 'Embed a note', detail: 'Transclude another page', keywords: 'embed transclude include', snippet: '![[|]]' },
  { label: 'Tag', detail: 'File this note', keywords: 'tag label', snippet: '#|' },
  { label: 'Footnote', detail: 'A numbered aside', keywords: 'footnote note reference', snippet: '[^|]' },
  { label: 'Inline maths', detail: 'An inline equation', keywords: 'math inline latex', snippet: '$|$' },
  {
    label: "Today's date",
    detail: 'Insert as plain text',
    keywords: 'date today now',
    snippet: '',
    wholeLine: false
  }
]

function applySnippet(
  view: EditorView,
  from: number,
  to: number,
  block: Block
): void {
  const line = view.state.doc.lineAt(from)
  const start = block.wholeLine ? line.from : from

  let text = block.snippet
  if (block.label === "Today's date") {
    const d = new Date()
    text = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}|`
  }

  const caret = text.indexOf('|')
  const insert = caret === -1 ? text : text.slice(0, caret) + text.slice(caret + 1)

  view.dispatch({
    changes: { from: start, to, insert },
    selection: EditorSelection.cursor(start + (caret === -1 ? insert.length : caret)),
    scrollIntoView: true
  })

  block.action?.(view)
}

/**
 * Pick files and drop their markdown in at the caret.
 *
 * Main copies whatever is chosen into the vault's attachments folder and hands
 * back the markdown, so the vault stays self-contained — the same path a paste
 * or a drop takes, just started from the menu instead.
 */
export async function insertPickedFiles(view: EditorView): Promise<void> {
  const picked = await window.stone.attachments.pick()
  if (picked.length === 0) return

  // The caret is read now rather than when the dialog opened: the dialog is
  // modal to the window, but nothing stops an autosave or a sync from having
  // moved the document underneath in the meantime.
  const at = view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  const prefix = line.text.slice(0, at - line.from).trim() === '' ? '' : '\n'
  const insert = `${prefix}${picked.map((p) => p.markdown).join('\n')}\n`

  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    scrollIntoView: true
  })
  view.focus()
}

/**
 * The completion source. Only fires on a `/` that starts a word, so a URL or a
 * date like `and/or` never opens the menu mid-sentence.
 */
export function slashMenu(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[\w -]*/)
  if (!match) return null

  const raw = context.state.sliceDoc(match.from, match.to)
  const offset = raw.indexOf('/')
  const from = match.from + offset
  const query = raw.slice(offset + 1).toLowerCase()

  const options: Completion[] = BLOCKS.filter((block) => {
    if (!query) return true
    return (
      block.label.toLowerCase().includes(query) ||
      block.keywords.includes(query) ||
      block.detail.toLowerCase().includes(query)
    )
  }).map((block) => ({
    label: block.label,
    detail: block.detail,
    type: 'keyword',
    boost: block.label.toLowerCase().startsWith(query) ? 1 : 0,
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      applySnippet(view, applyFrom, applyTo, block)
    }
  }))

  if (options.length === 0) return null
  return { from, to: match.to, options, filter: false }
}

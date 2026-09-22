import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useStone } from '../store'
import { CARET } from '../lib/latex'
import { allPresets, type Datatype } from './datatypes'
import { askForAnimation } from './animate'
import { inProse } from './intellisense'

/**
 * The slash menu.
 *
 * Notion's defining interaction: type `/` and pick a block instead of
 * remembering markdown. It is built on CodeMirror's completion source rather
 * than a bespoke popup so that arrow keys, Enter, Escape, filtering and
 * scroll-into-view all behave the way every other menu in the editor does.
 *
 * Each command replaces the typed `/query` with its snippet, and `CARET` marks
 * where the cursor should end up.
 *
 * Half the menu is written here — the markdown a note is made of, which has no
 * variations worth listing — and half comes from `datatypes`, which holds
 * several presets per fence. Those extra presets stay hidden until the query
 * names them, so a bare `/` is still a menu of *kinds* rather than eight ways
 * to draw a hash table, and `/hash` or `/probe` is a menu of variations. That
 * is the whole trick: the second and third preset for a fence are worth having
 * precisely when someone is looking for one, and worth nothing before that.
 */

interface Block {
  label: string
  detail: string
  keywords: string
  snippet: string
  /** Replace the whole line rather than just the slash token. */
  wholeLine?: boolean
  /**
   * A variation on a block rather than a block: shown once the query names it.
   */
  secondary?: boolean
  /** The datatype it came from, for the preview beside the row. */
  type?: Datatype
  /**
   * Runs instead of inserting the snippet, for a block that cannot be written
   * as text — picking a file takes a dialog and a round trip to main, so the
   * slash token is cleared first and the markdown arrives when it arrives.
   */
  action?: (view: EditorView) => void
}

/** The presets in `datatypes`, as menu entries. */
function presetBlocks(): Block[] {
  return allPresets().map(({ type, preset }) => ({
    label: preset.label,
    detail: preset.detail,
    // The fence word is a keyword whether or not the preset mentions it, so
    // `/algo` finds every algorithm preset and `/stone` every query one.
    keywords: `${preset.keywords} ${type.id} ${type.fence ?? ''} ${type.label.toLowerCase()}`,
    snippet: preset.code,
    wholeLine: true,
    secondary: !preset.headline,
    type
  }))
}

const BLOCKS: Block[] = [
  { label: 'Heading 1', detail: 'Large section title', keywords: 'h1 title', snippet: `# ${CARET}`, wholeLine: true },
  { label: 'Heading 2', detail: 'Section title', keywords: 'h2 subtitle', snippet: `## ${CARET}`, wholeLine: true },
  { label: 'Heading 3', detail: 'Sub-section', keywords: 'h3', snippet: `### ${CARET}`, wholeLine: true },
  { label: 'Bulleted list', detail: 'A simple list', keywords: 'ul bullet point', snippet: `- ${CARET}`, wholeLine: true },
  {
    label: 'Numbered list',
    detail: 'An ordered list',
    keywords: 'ol ordered number',
    snippet: `1. ${CARET}`,
    wholeLine: true
  },
  { label: 'To-do', detail: 'A task with a checkbox', keywords: 'task checkbox todo', snippet: `- [ ] ${CARET}`, wholeLine: true },
  {
    label: 'To-do with a date',
    detail: 'A task due tomorrow',
    keywords: 'task due date schedule',
    snippet: `- [ ] ${CARET} @tomorrow`,
    wholeLine: true
  },
  {
    label: 'Repeating to-do',
    detail: 'A task that comes back',
    keywords: 'task repeat recurring weekly',
    snippet: `- [ ] ${CARET} @tomorrow &weekly`,
    wholeLine: true
  },
  { label: 'Quote', detail: 'Set text apart', keywords: 'blockquote citation', snippet: `> ${CARET}`, wholeLine: true },
  {
    label: 'Callout',
    detail: 'A tinted panel',
    keywords: 'note info admonition aside',
    snippet: `> [!note] ${CARET}`,
    wholeLine: true
  },
  {
    label: 'Callout — tip',
    detail: 'A green panel',
    keywords: 'tip hint success',
    snippet: `> [!tip] ${CARET}`,
    wholeLine: true
  },
  {
    label: 'Callout — warning',
    detail: 'A yellow panel',
    keywords: 'warning caution careful',
    snippet: `> [!warning] ${CARET}`,
    wholeLine: true
  },
  {
    label: 'Collapsible callout',
    detail: 'A panel that starts folded',
    keywords: 'callout fold collapse collapsed toggle hide aside details',
    // The `-` is Obsidian's fold marker: it says the callout collapses, and
    // that it opens collapsed. `+` is the same panel starting open.
    snippet: `> [!note]- ${CARET}\n> `,
    wholeLine: true
  },
  {
    label: 'Divider',
    detail: 'A horizontal rule',
    keywords: 'hr rule line separator',
    snippet: `---\n${CARET}`,
    wholeLine: true
  },
  {
    label: 'Code block',
    detail: 'Fenced, with syntax colours',
    keywords: 'code fence snippet',
    snippet: '```\n' + CARET + '\n```',
    wholeLine: true
  },

  // The fences, and the several ways into each of them.
  ...presetBlocks(),

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
    label: 'Animated algorithm',
    detail: 'Claude draws it in the background while you keep writing',
    keywords: 'algo algorithm animation animate claude ai sort search generate run',
    snippet: '',
    action: () => void askForAnimation('')
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
    snippet: `[${CARET}]()`
  },
  { label: 'Link to a note', detail: 'A wikilink', keywords: 'link wikilink reference', snippet: `[[${CARET}]]` },
  {
    label: 'Embed a note',
    detail: 'Transclude another page',
    keywords: 'embed transclude include',
    snippet: `![[${CARET}]]`
  },
  { label: 'Tag', detail: 'File this note', keywords: 'tag label', snippet: `#${CARET}` },
  { label: 'Footnote', detail: 'A numbered aside', keywords: 'footnote note reference', snippet: `[^${CARET}]` },
  {
    label: 'Inline footnote',
    detail: 'The aside itself, written in place',
    keywords: 'footnote inline aside note reference',
    snippet: `^[${CARET}]`
  },
  {
    label: 'Comment',
    detail: 'In the file, not in the export',
    keywords: 'comment hidden private aside todo note to self',
    snippet: `%%${CARET}%%`
  },
  {
    label: 'Superscript',
    detail: 'Raised text — x², a citation',
    keywords: 'superscript power exponent raised sup',
    snippet: `<sup>${CARET}</sup>`
  },
  {
    label: 'Subscript',
    detail: 'Lowered text — H₂O, an index',
    keywords: 'subscript index lowered sub chemistry',
    snippet: `<sub>${CARET}</sub>`
  },
  { label: 'Inline maths', detail: 'An inline equation', keywords: 'math inline latex', snippet: `$${CARET}$` },
  {
    label: "Today's date",
    detail: 'Insert as plain text',
    keywords: 'date today now',
    snippet: '',
    wholeLine: false
  }
]

/**
 * The block, as it will arrive in the note.
 *
 * Shown beside a preset rather than in place of its description, because the
 * two answer different questions — "which of these do I want" is the label, and
 * "what am I about to get" is only ever the text itself. A fence's presets
 * differ by three lines in the middle, and no wording tells them apart as fast
 * as seeing them.
 */
function previewNode(block: Block): Node | null {
  if (!block.type || !block.snippet) return null
  const pre = document.createElement('pre')
  pre.className = 'cm-preset-preview'
  pre.textContent = block.snippet.split(CARET).join('')
  return pre
}

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
    text = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${CARET}`
  }

  const caret = text.indexOf(CARET)
  const insert = caret === -1 ? text : text.slice(0, caret) + text.slice(caret + CARET.length)

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
  // Prose only. A block menu over a division sign, a comment marker or a path
  // is the reason `/` was a safe trigger everywhere until code blocks started
  // suggesting things of their own — see `intellisense`.
  if (!inProse(context.state, context.pos)) return null
  const match = context.matchBefore(/(?:^|\s)\/[\w -]*/)
  if (!match) return null

  const raw = context.state.sliceDoc(match.from, match.to)
  const offset = raw.indexOf('/')
  const from = match.from + offset
  const query = raw.slice(offset + 1).toLowerCase()

  const options: Completion[] = BLOCKS.filter((block) => {
    // A single letter is still the start of almost everything, so variations
    // wait until the query is specific enough to be about one fence.
    if (block.secondary && query.length < 2) return false
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
    info: () => previewNode(block),
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      applySnippet(view, applyFrom, applyTo, block)
    }
  }))

  if (options.length === 0) return null
  return { from, to: match.to, options, filter: false }
}

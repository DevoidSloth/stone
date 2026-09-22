import { useEffect, useMemo, useRef } from 'react'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  placeholder
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage
} from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { vim } from '@replit/codemirror-vim'
import type { NoteMeta } from '@shared/types'
import { cycleStatus, isTaskLine, parseTaskLine, setStatusOnLine } from '@shared/task-syntax'
import { assetPathOf, isExternalUrl } from '@shared/attachments'
import { fenceInfo } from '@shared/code-langs'
import { isFoldable, livePreview, toggleFold } from './live-preview'
import { blockHandles } from './blocks'
import { notePathFacet } from './run-code'
import { slashMenu } from './slash'
import { blockComplete } from './block-complete'
import { codeComplete, inProse, latexComplete } from './intellisense'
import { insertMath, linkPastedUrl, makeLink, setBlockKind, wrapSelection } from './format'
import {
  continueTask,
  indentListItem,
  moveListItemDown,
  moveListItemUp,
  outdentListItem,
  removeListMarkup
} from './lists'
import { selectionToolbar } from './selection-toolbar'
import { fontMetrics, widgetHeights } from './measure'
import {
  blockInsertion,
  clearActiveEditor,
  registerEditor,
  setActiveEditor,
  trackFocus,
  unregisterEditor
} from './insert'
import { stamps } from './stamps'
import { seekPlayer } from '../audio/player'
import { useStone } from '../store'
import { describeError } from '../lib/errors'
import { findEmoji } from '../lib/emoji'

/**
 * Which grammar highlights a fence.
 *
 * A list would do, except for the `!` that turns a block's suggestions off:
 * `` ```!python `` is still Python and still has to be coloured like it, so the
 * info string is read through `fenceInfo` before the name is looked up. Fuzzy
 * matching is on, which is how `c++`, `js` and `Rust` all find their language.
 */
function fenceHighlighter(info: string): LanguageDescription | null {
  const { name } = fenceInfo(info)
  return name ? LanguageDescription.matchLanguageName(languages, name, true) : null
}

/**
 * CodeMirror injects its own base styles at a specificity plain CSS cannot beat,
 * which is why the editor rendered in monospace with a phantom left indent no
 * matter what the stylesheet said. Anything structural has to be set here.
 */
function makeStoneTheme(dark: boolean): Extension {
  return EditorView.theme(STONE_THEME_SPEC, { dark })
}

/**
 * `dark` is not cosmetic here. CodeMirror's base theme carries `&light` and
 * `&dark` variants, and with no flag it assumes light — which is why ⌘F used to
 * open a `#f5f5f5` panel with black text in the middle of the dark theme. The
 * search panel is the one CodeMirror surface Stone does not restyle itself.
 */
const STONE_THEME_SPEC = ({
  '&': {
    fontFamily: 'var(--font-ui)',
    color: 'var(--text)',
    backgroundColor: 'transparent'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.5',
    overflow: 'visible',
    // The base theme lays the scroller out as a flex row to make room for
    // gutters. Stone renders none, and that flex row was inserting a phantom
    // left indent, so the scroller is a plain block instead.
    display: 'block',
    padding: '0'
  },
  '.cm-content': {
    fontFamily: 'inherit',
    padding: '0',
    marginLeft: '0',
    caretColor: 'var(--text)',
    minHeight: 'auto',
    minWidth: '100%'
  },
  '.cm-line': { padding: '3px 0' },
  '.cm-gutters': { display: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '1.5px' },
  '.cm-placeholder': { color: 'var(--text-ghost)' },
  // Was a literal `rgba(35, 131, 226, 0.2)`, the only hardcoded colour left in
  // the app — heavier than `--bg-selected` in both themes, so a selection in
  // the editor did not match a selection anywhere else in the window.
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--bg-selected-strong)'
  },
  // The vim block cursor and status line are the plugin's own, and would
  // otherwise arrive in its default browser styling.
  '.cm-vim-panel': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    padding: '2px 8px',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-surface)'
  },
  '.cm-fat-cursor': { backgroundColor: 'var(--accent) !important', color: 'var(--accent-ink) !important' },

  // The panel beside the completion list — a rendered equation, or a word
  // about a name. Here rather than in CSS because the autocomplete package
  // styles it in its own base theme, which no plain selector outranks; the
  // list next to it needs no such help and stays in `editor.css`.
  '.cm-tooltip.cm-completionInfo': {
    backgroundColor: 'var(--bg-page)',
    border: 'none',
    borderRadius: 'var(--r-md)',
    boxShadow: 'var(--shadow-md)',
    padding: 'var(--sp-2) var(--sp-3)',
    marginLeft: 'var(--sp-1)',
    maxWidth: '260px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t-xs)',
    color: 'var(--text-muted)',
    // The package sets `pre-line`, which is right for a paragraph of prose and
    // wrong for KaTeX's markup, where it turns every line break in the HTML
    // into a gap inside the equation.
    whiteSpace: 'normal'
  },

  // The find bar. Styled here rather than in CSS for the same reason as the
  // rest of this object: CodeMirror's own rules land at a specificity plain
  // stylesheets cannot beat.
  '.cm-panels': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text)',
    border: 'none'
  },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border-hair)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border-hair)' },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t-sm)'
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--text-muted)',
    fontSize: 'var(--t-xs)'
  },
  '.cm-textfield': {
    height: '26px',
    padding: '0 8px',
    border: '1px solid var(--border-hair)',
    borderRadius: 'var(--r-sm)',
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t-sm)'
  },
  '.cm-textfield:focus': {
    outline: 'none',
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 2px var(--accent-soft)'
  },
  '.cm-button': {
    height: '26px',
    padding: '0 10px',
    border: '1px solid var(--border-hair)',
    borderRadius: 'var(--r-sm)',
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--t-sm)',
    cursor: 'pointer'
  },
  '.cm-button:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--bg-active)' },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '6px',
    right: '8px',
    padding: '2px 6px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-faint)',
    fontSize: '16px',
    cursor: 'pointer'
  },
  '.cm-searchMatch': { backgroundColor: 'var(--wash-yellow)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)' }
}) satisfies Parameters<typeof EditorView.theme>[0]

/**
 * Code-block syntax colours.
 *
 * These used to name `--iris`, `--jade` and `--citrine`, none of which exist in
 * the token sheet — so every rule was an invalid `color` declaration the browser
 * dropped, and fenced code rendered in flat body text. They come from the
 * `--code-*` ramp now, and cover the tags a mixed vault actually hits rather
 * than the handful the first pass listed.
 */
const codeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: 'var(--code-keyword)' },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape],
    color: 'var(--code-string)'
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName), tags.macroName],
    color: 'var(--code-function)'
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName), tags.definition(tags.typeName)],
    color: 'var(--code-type)'
  },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
  { tag: [tags.variableName, tags.labelName], color: 'var(--code-variable)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.derefOperator], color: 'var(--code-operator)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--code-keyword)' },
  { tag: tags.self, color: 'var(--code-keyword)', fontStyle: 'italic' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--code-comment)' },
  { tag: tags.link, color: 'var(--link)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--code-invalid)' }
])

function toggleTaskAtCursor(view: EditorView): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)

  if (!isTaskLine(line.text)) {
    // Turn a plain line into a task rather than doing nothing.
    const indent = /^\s*/.exec(line.text)?.[0] ?? ''
    const body = line.text.slice(indent.length).replace(/^[-*+]\s+/, '')
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: `${indent}- [ ] ${body}` },
      selection: { anchor: line.from + indent.length + 6 + body.length }
    })
    return true
  }

  const task = parseTaskLine(line.text, '', 0)
  if (!task) return false
  const head = state.selection.main.head
  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: setStatusOnLine(line.text, cycleStatus(task.status))
    },
    selection: { anchor: Math.min(head, line.from + line.text.length) }
  })
  return true
}

/** Collapse or expand the section the caret sits in. */
function toggleFoldAtCursor(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  if (!isFoldable(view.state, line.number)) return false
  view.dispatch({ effects: toggleFold.of(line.number) })
  return true
}

/**
 * Where the caret should land when a note opens: after any frontmatter block.
 * CodeMirror otherwise starts at position 0, which is inside the metadata —
 * that both reads as the wrong place to begin typing and keeps the frontmatter
 * permanently unfolded, since the fold treats a caret inside it as editing.
 */
function bodyStart(doc: string): number {
  if (!doc.startsWith('---')) return 0
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(doc)
  return m ? m[0].length : 0
}

/**
 * Per-note editor state, kept across tab switches.
 *
 * Bounded and ordered by last use: a long session touches more notes than are
 * worth holding whole documents for, and the ones you left ten notes ago are
 * the ones you are least likely to return to.
 */
const MAX_REMEMBERED = 24
const docStates = new Map<string, EditorState>()
const scrollTops = new Map<string, number>()

function rememberDoc(key: string, state: EditorState, scrollTop: number): void {
  docStates.delete(key)
  docStates.set(key, state)
  scrollTops.set(key, scrollTop)
  while (docStates.size > MAX_REMEMBERED) {
    const oldest = docStates.keys().next().value as string | undefined
    if (oldest === undefined) break
    docStates.delete(oldest)
    scrollTops.delete(oldest)
  }
}

/** Drop a note's remembered state — it was renamed, deleted, or changed on disk. */
export function forgetDoc(key: string): void {
  docStates.delete(key)
  scrollTops.delete(key)
}

export interface EditorProps {
  value: string
  onChange: (next: string) => void
  /** Changes identity when a different note loads, forcing a full doc reset. */
  docKey: string
  notes: NoteMeta[]
  tags: { tag: string; count: number }[]
  onOpenWikilink: (target: string) => void
  onSelectTag: (tag: string) => void
  /** Fetch a note's body for an `![[embed]]`. */
  loadEmbed?: (
    target: string
  ) => Promise<{ title: string; body: string; missing?: boolean } | null>
  attachmentsFolder?: string
  vimMode?: boolean
  spellcheck?: boolean
  /** Drives CodeMirror's own `dark` flag, which its base theme keys off. */
  dark?: boolean
  fontSize?: number
  /** Scroll to this line once after the document loads. */
  revealLine?: number | null
  onRevealed?: () => void
  onHoverLink?: (target: string, rect: DOMRect) => void
  onHoverEnd?: () => void
}

export function Editor({
  value,
  onChange,
  docKey,
  notes,
  tags: vaultTags,
  onOpenWikilink,
  onSelectTag,
  loadEmbed,
  attachmentsFolder = 'Attachments',
  vimMode = false,
  spellcheck = true,
  dark = true,
  fontSize = 16,
  revealLine = null,
  onRevealed,
  onHoverLink,
  onHoverEnd
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const emitted = useRef(value)

  // The update listener is baked into `extensions`, which only rebuilds when the
  // editor itself must change shape. Reading the callback from a ref keeps a
  // note switch from writing the new note's text to the old note's path.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Which note this view is showing, for the player to follow. In a ref like
  // the rest: `extensions` is deliberately not rebuilt when the note changes.
  const docKeyRef = useRef(docKey)
  docKeyRef.current = docKey

  // Kept in refs so completion sources see fresh data without rebuilding the view.
  const notesRef = useRef(notes)
  const tagsRef = useRef(vaultTags)
  notesRef.current = notes
  tagsRef.current = vaultTags

  const handlers = useRef({
    onOpenWikilink,
    onSelectTag,
    loadEmbed,
    attachmentsFolder,
    onHoverLink,
    onHoverEnd
  })
  handlers.current = {
    onOpenWikilink,
    onSelectTag,
    loadEmbed,
    attachmentsFolder,
    onHoverLink,
    onHoverEnd
  }

  const extensions = useMemo<Extension[]>(() => {
    // Set by Escape, cleared by the Tab that follows it. Per view, which is
    // what having it inside the memo gets us.
    let tabEscapes = false

    const wikilinkSource = (context: CompletionContext): CompletionResult | null => {
      // Prose only. `[[` is a nested index in half the languages Stone runs, and
      // a menu of note titles over `grid[[i]]` is noise — see `intellisense`.
      if (!inProse(context.state, context.pos)) return null
      const match = context.matchBefore(/!?\[\[[^\]]*/)
      if (!match) return null
      const opening = context.state.sliceDoc(match.from, match.to).indexOf('[[')
      return {
        from: match.from + opening + 2,
        options: notesRef.current.slice(0, 400).map((note) => ({
          label: note.title,
          detail: note.relPath.replace(/\.md$/, ''),
          type: 'text'
        })),
        validFor: /^[^\]]*$/
      }
    }

    /**
     * `:tada:` → 🎉.
     *
     * The shortcode is a way of typing an emoji without leaving the keyboard,
     * not a way of storing one: what lands in the file is the character. Only
     * fires on a colon that starts a word, so a time, a YAML key or a `::` in a
     * snippet never opens it, and a single letter is required before it lists
     * anything — an empty `:` would otherwise pop a menu over every clock.
     */
    const emojiSource = (context: CompletionContext): CompletionResult | null => {
      if (!inProse(context.state, context.pos)) return null
      const match = context.matchBefore(/(?:^|\s):[a-z0-9_+-]+/)
      if (!match) return null
      const raw = context.state.sliceDoc(match.from, match.to)
      const at = raw.indexOf(':')
      const query = raw.slice(at + 1)
      if (query.length < 1) return null

      const hits = findEmoji(query).slice(0, 30)
      if (hits.length === 0) return null
      return {
        from: match.from + at,
        to: match.to,
        options: hits.map((emoji) => ({
          label: `${emoji.char}  :${emoji.name}:`,
          apply: emoji.char,
          type: 'text'
        })),
        filter: false
      }
    }

    const tagSource = (context: CompletionContext): CompletionResult | null => {
      // `#` opens a comment in half a dozen of the languages a fence can hold,
      // and a preprocessor directive in the rest.
      if (!inProse(context.state, context.pos)) return null
      const match = context.matchBefore(/#[\p{L}\p{N}_\-/]*/u)
      if (!match || match.from === match.to) return null
      return {
        from: match.from + 1,
        options: tagsRef.current.map((t) => ({
          label: t.tag,
          detail: String(t.count),
          type: 'keyword'
        })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u
      }
    }

    /**
     * Paste and drop of files. An image on the clipboard is written into the
     * vault's attachments folder and linked, which is the single biggest
     * difference between a notes app you can live in and one you cannot.
     */
    const insertFiles = async (view_: EditorView, files: File[], at: number): Promise<void> => {
      const snippets: string[] = []
      const failed: string[] = []
      let lastError: unknown = null
      for (const file of files) {
        const name = file.name || 'pasted.png'
        try {
          const buffer = new Uint8Array(await file.arrayBuffer())
          const saved = await window.stone.attachments.save(buffer, name)
          snippets.push(saved.markdown)
        } catch (err) {
          // Console-only used to mean the user pasted a screenshot, nothing
          // appeared, and nothing said why — in the one interaction the comment
          // above calls the difference between an app you can live in and one
          // you cannot.
          console.error('[stone] attachment failed', err)
          lastError = err
          failed.push(name)
        }
      }
      if (failed.length > 0) {
        useStone
          .getState()
          .toast(
            failed.length === 1
              ? `Could not save “${failed[0]}” into the vault. ${describeError(lastError)}`
              : `Could not save ${failed.length} of ${files.length} files into the vault.`,
            'error'
          )
      }
      if (snippets.length === 0) return

      // An embed is a figure, and a figure needs its own line. Dropped into the
      // middle of a sentence it would otherwise render inline at thumbnail size
      // — or, worse, cut the sentence in half at the exact pixel the pointer
      // was over. The same spacing rules every other inserted block uses put it
      // under the line instead, with one blank line either side.
      const { at: pos, insert } = blockInsertion(view_.state, snippets.join('\n\n'), at)

      view_.dispatch({
        changes: { from: pos, to: pos, insert },
        selection: EditorSelection.cursor(pos + insert.length),
        scrollIntoView: true
      })
      view_.focus()
    }

    /**
     * Whether a drag is carrying files.
     *
     * Dragging text inside the note also fires these events, and lighting the
     * whole editor up for a word being moved four characters would be noise.
     */
    const carriesFiles = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types.includes('Files'))

    /**
     * `dragenter`/`dragleave` fire for every element the pointer crosses, so a
     * drag moving over the text is a stream of leaves and enters. Counting them
     * is what keeps the highlight steady instead of flickering line by line.
     */
    let dragDepth = 0
    const setDropping = (view_: EditorView, on: boolean): void => {
      dragDepth = on ? dragDepth : 0
      view_.dom.classList.toggle('cm-dropping', on)
    }

    const fileHandlers = EditorView.domEventHandlers({
      paste(event, view_) {
        const items = [...(event.clipboardData?.items ?? [])]
        const files = items
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((f): f is File => Boolean(f))

        if (files.length === 0) {
          // A URL pasted over selected text links the text rather than
          // replacing it. Anything else falls through to a normal paste.
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (linkPastedUrl(view_, text)) {
            event.preventDefault()
            return true
          }
          return false
        }

        event.preventDefault()
        void insertFiles(view_, files, view_.state.selection.main.head)
        return true
      },

      drop(event, view_) {
        setDropping(view_, false)
        const files = [...(event.dataTransfer?.files ?? [])]
        if (files.length === 0) return false
        event.preventDefault()
        // Where the pointer let go, falling back to the end of the note rather
        // than the caret: a drop aimed below the last line should land there.
        const pos = view_.posAtCoords({ x: event.clientX, y: event.clientY })
        void insertFiles(view_, files, pos ?? view_.state.doc.length)
        return true
      },

      dragenter(event, view_) {
        if (!carriesFiles(event)) return false
        dragDepth++
        setDropping(view_, true)
        return false
      },

      dragleave(event, view_) {
        if (!carriesFiles(event)) return false
        dragDepth = Math.max(0, dragDepth - 1)
        if (dragDepth === 0) setDropping(view_, false)
        return false
      },

      dragover(event, view_) {
        if (!carriesFiles(event)) return false
        // Saying "copy" is what turns the cursor from a no-entry sign into a
        // plus, which is the only feedback the OS gives before the drop.
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        if (!view_.dom.classList.contains('cm-dropping')) setDropping(view_, true)
        return false
      }
    })

    return [
      // Vim has to come first so its keymap outranks the defaults.
      ...(vimMode ? [vim({ status: true })] : []),
      makeStoneTheme(dark),
      EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [
          slashMenu,
          wikilinkSource,
          tagSource,
          emojiSource,
          latexComplete,
          codeComplete,
          blockComplete
        ],
        icons: false,
        closeOnBlur: true
      }),
      markdown({ base: markdownLanguage, codeLanguages: fenceHighlighter, addKeymap: false }),
      syntaxHighlighting(codeHighlight),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: spellcheck ? 'true' : 'false' }),
      placeholder('Type / for blocks, [[ to link a note, # for a tag, and ⌘⏎ to make a task.'),
      livePreview({
        onOpenWikilink: (target) => handlers.current.onOpenWikilink(target),
        onOpenUrl: (url) => {
          // A link to a library document is a local path, which `openExternal`
          // refuses by design. Those go to the library's own opener, which is
          // checked against the watched folders in main.
          if (url.startsWith('file://')) {
            void window.stone.library.openExternally(decodeURIComponent(url.slice('file://'.length)))
            return
          }
          void window.stone.shell.openExternal(url)
        },
        onSelectTag: (tag) => handlers.current.onSelectTag(tag),
        loadEmbed: (target) => handlers.current.loadEmbed?.(target) ?? Promise.resolve(null),
        // An embedded file, opened from its own card. A web address goes to the
        // browser; anything else is a path in the vault, and only main can turn
        // that into something the OS will launch.
        onOpenAsset: (target) => {
          if (isExternalUrl(target)) {
            void window.stone.shell.openExternal(target)
            return
          }
          const folder = handlers.current.attachmentsFolder ?? 'Attachments'
          void window.stone.attachments
            .open(assetPathOf(target, folder))
            .catch((err: Error) => console.error('[stone] could not open embed', err))
        },
        // A recording is played from the bar at the foot of the window, so both
        // the embed's play button and every timestamp down the note reach the
        // same element rather than starting a second copy of the lecture.
        onPlayAudio: (target, seconds) => {
          const folder = handlers.current.attachmentsFolder ?? 'Attachments'
          const audio = assetPathOf(target, folder)
          const store = useStone.getState()
          // Already loaded: seek the element directly, which is instant and
          // keeps playing. Otherwise the position rides along with the open and
          // the player applies it as soon as it knows how long the file is.
          if (store.playback?.audio === audio && seekPlayer(seconds)) return
          void store.openPlayer(audio, docKeyRef.current, { at: seconds, play: true })
        },
        onShowTranscript: (target) => {
          const folder = handlers.current.attachmentsFolder ?? 'Attachments'
          const audio = assetPathOf(target, folder)
          const store = useStone.getState()
          void store.openPlayer(audio, docKeyRef.current)
          store.setSidePanel('transcript')
        },
        attachmentsFolder: () => handlers.current.attachmentsFolder ?? 'Attachments',
        onHoverLink: (target, rect) => handlers.current.onHoverLink?.(target, rect),
        onHoverEnd: () => handlers.current.onHoverEnd?.()
      }),
      selectionToolbar(),
      ...stamps(),
      trackFocus,
      widgetHeights,
      fontMetrics,
      ...blockHandles(),
      fileHandlers,
      keymap.of([
        { key: 'Mod-b', run: (v) => wrapSelection(v, '**') },
        { key: 'Mod-i', run: (v) => wrapSelection(v, '*') },
        // Markdown has no underline, so this writes the `<u>` tag the exporter
        // and every other renderer already understand.
        { key: 'Mod-u', run: (v) => wrapSelection(v, '<u>') },
        // Not Mod-Shift-h, which already collapses the section below.
        { key: 'Mod-Shift-m', run: (v) => wrapSelection(v, '==') },
        // Not Mod-k: that is the command palette, and shadowing it in the one
        // place the user spends most of their time is worse than a shortcut
        // that takes an extra modifier.
        { key: 'Mod-Shift-k', run: makeLink },
        { key: 'Mod-`', run: (v) => wrapSelection(v, '`') },
        // E for equation. Mod-m is the highlight key's neighbour and Mod-Shift-m
        // is already taken by it.
        { key: 'Mod-Shift-e', run: insertMath },
        { key: 'Mod-Enter', run: toggleTaskAtCursor },
        { key: 'Mod-Shift-h', run: toggleFoldAtCursor },
        // The list keys everything else has: 8 is the bullet on most layouts,
        // and it is what ProseMirror, Notion and Google Docs all chose.
        { key: 'Mod-Shift-8', run: (v) => setBlockKind(v, 'bullet') },
        // An outline moves by subtrees. These fall through to the stock
        // "move line" when the caret is not in a list, so the key keeps its
        // ordinary meaning in prose.
        { key: 'Alt-ArrowUp', run: moveListItemUp },
        { key: 'Alt-ArrowDown', run: moveListItemDown },
        ...closeBracketsKeymap,
        // Above the list keys: Enter belongs to the open completion menu first.
        ...completionKeymap,
        // A list keeps itself going. Stone's own task handling runs first, then
        // the markdown package's for plain bullets, numbers and quotes, and
        // both fall through to a plain newline when the caret is not in a list.
        // Shift-Enter never reaches them, so it stays the way to break a line
        // inside an item.
        { key: 'Enter', run: continueTask },
        { key: 'Enter', run: insertNewlineContinueMarkup },
        { key: 'Backspace', run: removeListMarkup },
        { key: 'Backspace', run: deleteMarkupBackward },
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        // Tab indents, which makes the editor a keyboard trap in the strict
        // sense: focus goes in and Tab never brings it out. Escape releases the
        // capture for exactly one keystroke, so Tab then moves focus the way it
        // does everywhere else, and the next Tab indents again.
        {
          key: 'Escape',
          run: (v) => {
            tabEscapes = true
            v.dom.dispatchEvent(new CustomEvent('stone-tab-release'))
            return false
          }
        },
        {
          key: 'Tab',
          run: (v) => {
            if (tabEscapes) {
              tabEscapes = false
              return false
            }
            // In a list, Tab nests; everywhere else it is still an indent.
            return indentListItem(v) || indentWithTab.run!(v)
          },
          shift: (v) => outdentListItem(v) || indentWithTab.shift!(v)
        }
      ]),
      EditorView.updateListener.of((update) => {
        // Where the caret is goes to the store on every selection change, so
        // the Code panel can follow it. It is a no-op when the line has not
        // changed, which is most keystrokes.
        if (update.selectionSet || update.docChanged) {
          const path = update.state.facet(notePathFacet)
          const line = update.state.doc.lineAt(update.state.selection.main.head).number
          if (path) useStone.getState().setCaret(path, line)
        }

        if (!update.docChanged) return
        const next = update.state.doc.toString()
        emitted.current = next
        onChangeRef.current(next)
      })
    ]
    // Callbacks and vault data are read through refs, so this only needs to
    // rebuild when the editor's own configuration changes; rebuilding on every
    // render would drop focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimMode, spellcheck, dark, fontSize])

  useEffect(() => {
    if (!host.current) return

    // A note you come back to should be where you left it. The view used to be
    // destroyed and rebuilt on every tab switch, which threw away the undo
    // history, the selection, the scroll offset and every fold — and then
    // `bodyStart()` parked the caret at the top for good measure.
    const remembered = docStates.get(docKey)
    const reusable = remembered && remembered.doc.toString() === value

    const instance = new EditorView({
      state: reusable
        ? remembered
        : EditorState.create({
            doc: value,
            // The note's path is state, not configuration: the view is rebuilt
            // when it changes anyway, and a run needs it both for its working
            // directory and to keep one note's output off another note's blocks.
            extensions: [extensions, notePathFacet.of(docKey)],
            selection: { anchor: Math.min(bodyStart(value), value.length) }
          }),
      parent: host.current
    })

    view.current = instance
    emitted.current = value
    if (reusable) {
      const top = scrollTops.get(docKey)
      if (top) requestAnimationFrame(() => instance.scrollDOM.scrollTo({ top }))
    }
    // Claude's insertions go to the last editor focused; a note that has just
    // opened has not been clicked yet, so claim it now and let focus correct it.
    setActiveEditor(instance)
    // And by name, for an answer that arrives long after the note it belongs to
    // stopped being the one on screen.
    registerEditor(docKey, instance)

    return () => {
      // Keep the state so the next visit resumes rather than restarts. Bounded,
      // because a long session opens more notes than anyone needs remembered.
      rememberDoc(docKey, instance.state, instance.scrollDOM.scrollTop)
      clearActiveEditor(instance)
      unregisterEditor(docKey, instance)
      instance.destroy()
      view.current = null
    }
    // A new docKey means a different note: rebuild rather than diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, extensions])

  // Reflect changes that came from outside the editor (disk, or another view).
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    if (value === emitted.current) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
    emitted.current = value
  }, [value])

  // A `[[Note#Heading]]` jump lands here: put the caret on the line and centre it.
  useEffect(() => {
    const instance = view.current
    if (!instance || revealLine === null) return
    const line = Math.min(Math.max(revealLine + 1, 1), instance.state.doc.lines)
    const target = instance.state.doc.line(line)
    instance.dispatch({
      selection: EditorSelection.cursor(target.from),
      effects: EditorView.scrollIntoView(target.from, { y: 'center' })
    })
    instance.focus()
    onRevealed?.()
    // onRevealed is stable via the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLine, docKey])

  return <div ref={host} className="cm-host" />
}

import { useEffect, useMemo, useRef } from 'react'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
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
  HighlightStyle
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { vim } from '@replit/codemirror-vim'
import type { NoteMeta } from '@shared/types'
import { cycleStatus, isTaskLine, parseTaskLine, setStatusOnLine } from '@shared/task-syntax'
import { assetPathOf, isExternalUrl } from '@shared/attachments'
import { isFoldable, livePreview, toggleFold } from './live-preview'
import { blockHandles } from './blocks'
import { notePathFacet } from './run-code'
import { slashMenu } from './slash'
import { insertMath, linkPastedUrl, makeLink, wrapSelection } from './format'
import { continueTask, removeListMarkup } from './lists'
import { selectionToolbar } from './selection-toolbar'
import { fontMetrics, widgetHeights } from './measure'
import { blockInsertion, clearActiveEditor, setActiveEditor, trackFocus } from './insert'
import { stamps } from './stamps'
import { seekPlayer } from '../audio/player'
import { useStone } from '../store'

/**
 * CodeMirror injects its own base styles at a specificity plain CSS cannot beat,
 * which is why the editor rendered in monospace with a phantom left indent no
 * matter what the stylesheet said. Anything structural has to be set here.
 */
const stoneTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-ui)',
    fontSize: '16px',
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
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(35, 131, 226, 0.2)'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  // The vim block cursor and status line are the plugin's own, and would
  // otherwise arrive in its default browser styling.
  '.cm-vim-panel': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    padding: '2px 8px',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-surface)'
  },
  '.cm-fat-cursor': { backgroundColor: 'var(--accent) !important', color: 'var(--accent-ink) !important' }
})

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
  loadEmbed?: (target: string) => Promise<{ title: string; body: string } | null>
  attachmentsFolder?: string
  vimMode?: boolean
  spellcheck?: boolean
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
    const wikilinkSource = (context: CompletionContext): CompletionResult | null => {
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

    const tagSource = (context: CompletionContext): CompletionResult | null => {
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
      for (const file of files) {
        try {
          const buffer = new Uint8Array(await file.arrayBuffer())
          const saved = await window.stone.attachments.save(buffer, file.name || 'pasted.png')
          snippets.push(saved.markdown)
        } catch (err) {
          console.error('[stone] attachment failed', err)
        }
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
      stoneTheme,
      history(),
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [slashMenu, wikilinkSource, tagSource],
        icons: false,
        closeOnBlur: true
      }),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
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
        indentWithTab
      ]),
      EditorView.updateListener.of((update) => {
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
  }, [vimMode, spellcheck])

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      state: EditorState.create({
        doc: value,
        // The note's path is state, not configuration: the view is rebuilt when
        // it changes anyway, and a run needs it both for its working directory
        // and to keep one note's output off another note's blocks.
        extensions: [extensions, notePathFacet.of(docKey)],
        selection: { anchor: Math.min(bodyStart(value), value.length) }
      }),
      parent: host.current
    })
    view.current = instance
    emitted.current = value
    // Claude's insertions go to the last editor focused; a note that has just
    // opened has not been clicked yet, so claim it now and let focus correct it.
    setActiveEditor(instance)
    return () => {
      clearActiveEditor(instance)
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

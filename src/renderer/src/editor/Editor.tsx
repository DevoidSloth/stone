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
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
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
import { isFoldable, livePreview, toggleFold } from './live-preview'
import { blockHandles } from './blocks'
import { slashMenu } from './slash'
import { wrapSelection } from './format'
import { selectionToolbar } from './selection-toolbar'

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

/** Code-block syntax colours, tuned to the same three-accent rule as the UI. */
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--iris)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--jade)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--citrine)' },
  { tag: tags.comment, color: 'var(--text-ghost)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.variableName)],
    color: 'var(--citrine-bright)'
  },
  { tag: [tags.typeName, tags.className], color: 'var(--iris)' },
  { tag: tags.operator, color: 'var(--text-muted)' },
  { tag: tags.propertyName, color: 'var(--text)' }
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
      const insert = snippets.join('\n')
      view_.dispatch({
        changes: { from: at, to: at, insert },
        selection: EditorSelection.cursor(at + insert.length)
      })
    }

    const fileHandlers = EditorView.domEventHandlers({
      paste(event, view_) {
        const items = [...(event.clipboardData?.items ?? [])]
        const files = items
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((f): f is File => Boolean(f))
        if (files.length === 0) return false
        event.preventDefault()
        void insertFiles(view_, files, view_.state.selection.main.head)
        return true
      },

      drop(event, view_) {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (files.length === 0) return false
        event.preventDefault()
        const pos = view_.posAtCoords({ x: event.clientX, y: event.clientY })
        void insertFiles(view_, files, pos ?? view_.state.selection.main.head)
        return true
      },

      dragover(event) {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
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
        onOpenUrl: (url) => void window.stone.shell.openExternal(url),
        onSelectTag: (tag) => handlers.current.onSelectTag(tag),
        loadEmbed: (target) => handlers.current.loadEmbed?.(target) ?? Promise.resolve(null),
        attachmentsFolder: () => handlers.current.attachmentsFolder ?? 'Attachments',
        onHoverLink: (target, rect) => handlers.current.onHoverLink?.(target, rect),
        onHoverEnd: () => handlers.current.onHoverEnd?.()
      }),
      selectionToolbar(),
      ...blockHandles(),
      fileHandlers,
      keymap.of([
        { key: 'Mod-b', run: (v) => wrapSelection(v, '**') },
        { key: 'Mod-i', run: (v) => wrapSelection(v, '*') },
        // Not Mod-Shift-h, which already collapses the section below.
        { key: 'Mod-Shift-m', run: (v) => wrapSelection(v, '==') },
        { key: 'Mod-`', run: (v) => wrapSelection(v, '`') },
        { key: 'Mod-Enter', run: toggleTaskAtCursor },
        { key: 'Mod-Shift-h', run: toggleFoldAtCursor },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const next = update.state.doc.toString()
        emitted.current = next
        onChange(next)
      })
    ]
    // onChange is stable via the store; rebuilding on every render would drop focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimMode, spellcheck])

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions,
        selection: { anchor: Math.min(bodyStart(value), value.length) }
      }),
      parent: host.current
    })
    view.current = instance
    emitted.current = value
    return () => {
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

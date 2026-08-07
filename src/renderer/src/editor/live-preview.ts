import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import type { TaskStatus } from '@shared/types'
import { cycleStatus, parseTaskLine, setStatusOnLine } from '@shared/task-syntax'
import { embedKind } from '@shared/attachments'
import { toISODate } from '../lib/dates'
import {
  CheckboxWidget,
  CollapsedWidget,
  FoldWidget,
  ImageWidget,
  MathWidget,
  MediaWidget,
  MermaidWidget,
  NoteEmbedWidget,
  PropsWidget,
  RuleWidget,
  TableWidget,
  resolveAssetUrl
} from './widgets'

/**
 * Live preview.
 *
 * The document stays raw markdown — nothing is rewritten. Syntax markers are
 * hidden with replace decorations while the cursor is elsewhere and revealed
 * the moment the caret enters the line, so the file you edit is always exactly
 * the file on disk.
 */

const HIDE = Decoration.replace({})

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'tok-h1',
  ATXHeading2: 'tok-h2',
  ATXHeading3: 'tok-h3',
  ATXHeading4: 'tok-h4',
  ATXHeading5: 'tok-h5',
  ATXHeading6: 'tok-h6',
  SetextHeading1: 'tok-h1',
  SetextHeading2: 'tok-h2'
}

const INLINE_CLASS: Record<string, string> = {
  StrongEmphasis: 'tok-strong',
  Emphasis: 'tok-em',
  Strikethrough: 'tok-strike',
  InlineCode: 'tok-code',
  Blockquote: 'tok-quote'
}

const MARK_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark'
])

const WIKILINK_RE = /(!)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const TAG_RE = /(?:^|\s)(#[\p{L}\p{N}_\-/]+)/gu
const DUE_RE = /(?:^|\s)(@\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)/g
const SCHED_RE = /(?:^|\s)(~\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)/g
const PRI_RE = /(?:^|\s)(![a-z]+)\b/gi
const EST_RE = /(?:^|\s)(\+\d+(?:\.\d+)?(?:mins?|m|hrs?|h|d))\b/gi
const RECUR_TOKEN_RE = /(?:^|\s)(&(?:daily|weekly|fortnightly|monthly|yearly|annually|weekdays|every [\w ]+?))(?=$|\s)/gi
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g
const BLOCK_ID_RE = /\s(\^[A-Za-z0-9-]+)\s*$/
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:/
const INLINE_MATH_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g

// ---------------------------------------------------------------- folding

/** Headings and list items the user has collapsed, as start line numbers. */
export const toggleFold = StateEffect.define<number>()

export const foldedLines = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue
      next = new Set(next)
      if (next.has(effect.value)) next.delete(effect.value)
      else next.add(effect.value)
    }
    return next
  }
})

/** The last line belonging to a heading's section, or to a list item's children. */
function sectionEnd(state: EditorState, lineNumber: number): number {
  const doc = state.doc
  const text = doc.line(lineNumber).text

  const heading = /^(#{1,6})\s/.exec(text)
  if (heading) {
    const level = heading[1].length
    for (let n = lineNumber + 1; n <= doc.lines; n++) {
      const next = /^(#{1,6})\s/.exec(doc.line(n).text)
      if (next && next[1].length <= level) return n - 1
    }
    return doc.lines
  }

  const item = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(text)
  if (item) {
    const indent = item[1].length
    let end = lineNumber
    for (let n = lineNumber + 1; n <= doc.lines; n++) {
      const line = doc.line(n).text
      if (!line.trim()) continue
      const childIndent = /^\s*/.exec(line)![0].length
      if (childIndent <= indent) break
      end = n
    }
    return end
  }

  return lineNumber
}

/** True when this line owns something worth collapsing. */
export function isFoldable(state: EditorState, lineNumber: number): boolean {
  return sectionEnd(state, lineNumber) > lineNumber
}

function buildFolds(state: EditorState): DecorationSet {
  const folded = state.field(foldedLines, false)
  if (!folded || folded.size === 0) return Decoration.none

  const ranges: Range<Decoration>[] = []
  for (const start of [...folded].sort((a, b) => a - b)) {
    if (start > state.doc.lines) continue
    const end = sectionEnd(state, start)
    if (end <= start) continue
    const from = state.doc.line(start).to
    const to = state.doc.line(Math.min(end, state.doc.lines)).to
    ranges.push(
      Decoration.replace({
        widget: new CollapsedWidget(end - start),
        block: false
      }).range(from, to)
    )
  }
  return Decoration.set(ranges, true)
}

const foldDecorations = StateField.define<DecorationSet>({
  create: (state) => buildFolds(state),
  update: (value, tr) => (tr.docChanged || tr.effects.length > 0 ? buildFolds(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field)
})

// ------------------------------------------------------------- decorations

interface Collected {
  ranges: Range<Decoration>[]
  replaced: { from: number; to: number }[]
}

function overlapsReplace(state: Collected, from: number, to: number): boolean {
  return state.replaced.some((r) => from < r.to && to > r.from)
}

function pushReplace(state: Collected, from: number, to: number, deco = HIDE): void {
  if (from >= to || overlapsReplace(state, from, to)) return
  state.replaced.push({ from, to })
  state.ranges.push(deco.range(from, to))
}

function pushMark(state: Collected, from: number, to: number, deco: Decoration): void {
  if (from >= to) return
  state.ranges.push(deco.range(from, to))
}

export interface LivePreviewHandlers {
  onOpenWikilink: (target: string) => void
  onOpenUrl: (url: string) => void
  onSelectTag: (tag: string) => void
  loadEmbed: (target: string) => Promise<{ title: string; body: string } | null>
  attachmentsFolder: () => string
  onHoverLink?: (target: string, rect: DOMRect) => void
  onHoverEnd?: () => void
}

function buildDecorations(view: EditorView, handlers: LivePreviewHandlers): DecorationSet {
  const state: Collected = { ranges: [], replaced: [] }
  const doc = view.state.doc
  const todayISO = toISODate(new Date())
  const attachments = handlers.attachmentsFolder()

  // Lines holding a cursor show their raw markers so they stay editable.
  const liveLines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const first = doc.lineAt(range.from).number
    const last = doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) liveLines.add(n)
  }

  const isLive = (pos: number): boolean => liveLines.has(doc.lineAt(pos).number)

  // Fenced regions are tracked from the top of the document, because a code
  // block scrolled into view mid-fence would otherwise be treated as prose.
  const fenceInfo = new Map<number, { open: boolean; lang: string; start: number; end: number }>()
  {
    let open = false
    let start = 0
    let lang = ''
    for (let n = 1; n <= doc.lines; n++) {
      const text = doc.line(n).text
      const fence = /^\s*(```|~~~)\s*(\S*)/.exec(text)
      if (fence) {
        if (!open) {
          open = true
          start = n
          lang = fence[2] ?? ''
        } else {
          for (let i = start; i <= n; i++) {
            fenceInfo.set(i, { open: true, lang, start, end: n })
          }
          open = false
        }
        continue
      }
      if (open) fenceInfo.set(n, { open: true, lang, start, end: 0 })
    }
  }

  const inFence = (n: number): boolean => fenceInfo.has(n)

  // ---- pass 1: inline tokens Stone owns, which lezer knows nothing about ----

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from)
    while (line.from <= to) {
      const text = line.text
      const base = line.from
      const live = liveLines.has(line.number)
      const fence = fenceInfo.get(line.number)

      // Whole-fence widgets: mermaid and display maths replace the block.
      if (fence && fence.start === line.number && fence.end > line.number) {
        const lang = fence.lang.toLowerCase()
        const isDiagram = lang === 'mermaid'
        const isMath = lang === 'math' || lang === 'latex'
        const sectionLive = (() => {
          for (let n = fence.start; n <= fence.end; n++) if (liveLines.has(n)) return true
          return false
        })()

        if ((isDiagram || isMath) && !sectionLive) {
          const source: string[] = []
          for (let n = fence.start + 1; n < fence.end; n++) source.push(doc.line(n).text)
          pushReplace(
            state,
            doc.line(fence.start).from,
            doc.line(fence.end).to,
            Decoration.replace({
              widget: isDiagram
                ? new MermaidWidget(source.join('\n'))
                : new MathWidget(source.join('\n'), true),
              block: true
            })
          )
          line = fence.end >= doc.lines ? line : doc.lineAt(doc.line(fence.end).to + 1)
          if (fence.end >= doc.lines) break
          continue
        }
      }

      if (fence) {
        if (line.to >= doc.length) break
        line = doc.lineAt(line.to + 1)
        continue
      }

      // `> [!tip] Heading` — hide the marker and bold what follows it. The
      // tint and the glyph already say what kind of callout this is.
      const callout = /^(\s*>\s*)(\[!\w+\])[ \t]?/.exec(text)
      if (callout) {
        const markFrom = base + callout[1].length
        const markTo = markFrom + callout[2].length
        if (live) {
          pushMark(state, markFrom, markTo, Decoration.mark({ class: 'tok-mark' }))
        } else {
          pushReplace(state, markFrom, markTo + (callout[0].length - callout[1].length - callout[2].length))
        }
        if (line.to > markTo) {
          pushMark(state, markTo, line.to, Decoration.mark({ class: 'tok-callout-label' }))
        }
      }

      const task = parseTaskLine(text, '', 0)
      if (task) {
        // Swallow the list marker along with the brackets, so the row reads as
        // a checkbox rather than as "- [ ]" with a box tacked on.
        const prefix = /^(\s*)(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]/.exec(text)
        const boxStart = base + (prefix ? prefix[1].length : text.indexOf('['))
        const boxEnd = base + (prefix ? prefix[0].length : text.indexOf('[') + 3)
        pushReplace(
          state,
          boxStart,
          boxEnd,
          Decoration.replace({ widget: new CheckboxWidget(task.status) })
        )
        if (task.status === 'done' || task.status === 'cancelled') {
          const cls = task.status === 'done' ? 'tok-task-done' : 'tok-task-cancelled'
          pushMark(state, boxEnd, line.to, Decoration.mark({ class: cls }))
        }
      }

      const scan = (
        re: RegExp,
        make: (value: string) => Decoration | null,
        group = 1
      ): void => {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          const value = m[group]
          const start = base + m.index + m[0].indexOf(value)
          const deco = make(value)
          if (deco) pushMark(state, start, start + value.length, deco)
        }
      }

      scan(DUE_RE, (value) => {
        const day = value.slice(1, 11)
        const overdue = day < todayISO && !!task && task.status !== 'done'
        return Decoration.mark({ class: overdue ? 'tok-due tok-due--overdue' : 'tok-due' })
      })
      scan(SCHED_RE, () => Decoration.mark({ class: 'tok-due' }))
      scan(EST_RE, () => Decoration.mark({ class: 'tok-est' }))
      scan(RECUR_TOKEN_RE, () => Decoration.mark({ class: 'tok-recur' }))
      scan(PRI_RE, (value) => {
        const level = value.slice(1).toLowerCase()
        if (!['urgent', 'high', 'medium', 'med', 'low'].includes(level)) return null
        return Decoration.mark({ class: `tok-pri tok-pri--${level}` })
      })
      scan(TAG_RE, (value) =>
        Decoration.mark({ class: 'tok-tag', attributes: { 'data-tag': value.slice(1) } })
      )
      scan(URL_RE, (value) =>
        Decoration.mark({ class: 'tok-link', attributes: { 'data-url': value } })
      )

      // `^block-id` — an anchor, not prose. Dimmed, and hidden when idle.
      const blockId = BLOCK_ID_RE.exec(text)
      if (blockId) {
        const start = base + blockId.index + 1
        const end = start + blockId[1].length
        if (live) pushMark(state, start, end, Decoration.mark({ class: 'tok-blockid' }))
        else pushReplace(state, start - 1, end)
      }

      scan(FOOTNOTE_REF_RE, (value) =>
        Decoration.mark({ class: 'tok-footnote', attributes: { 'data-footnote': value.slice(2, -1) } })
      , 0)

      if (FOOTNOTE_DEF_RE.test(text)) {
        pushMark(state, base, line.to, Decoration.mark({ class: 'tok-footnote-def' }))
      }

      if (!live) {
        INLINE_MATH_RE.lastIndex = 0
        let math: RegExpExecArray | null
        while ((math = INLINE_MATH_RE.exec(text)) !== null) {
          pushReplace(
            state,
            base + math.index,
            base + math.index + math[0].length,
            Decoration.replace({ widget: new MathWidget(math[1], false) })
          )
        }
      }

      // Markdown images. A line holding nothing else becomes a block figure.
      MD_IMAGE_RE.lastIndex = 0
      let image: RegExpExecArray | null
      while ((image = MD_IMAGE_RE.exec(text)) !== null) {
        if (live) break
        const whole = image[0]
        const alone = text.trim() === whole
        pushReplace(
          state,
          base + image.index,
          base + image.index + whole.length,
          Decoration.replace({
            widget: new ImageWidget(resolveAssetUrl(image[2], attachments), image[1], alone),
            block: false
          })
        )
      }

      WIKILINK_RE.lastIndex = 0
      let wl: RegExpExecArray | null
      while ((wl = WIKILINK_RE.exec(text)) !== null) {
        const start = base + wl.index
        const end = start + wl[0].length
        const isEmbed = Boolean(wl[1])
        const target = wl[2].trim()
        const label = (wl[3] ?? wl[2]).trim()

        if (live) {
          pushMark(
            state,
            start,
            end,
            Decoration.mark({
              class: isEmbed ? 'tok-wikilink tok-wikilink--embed' : 'tok-wikilink',
              attributes: { 'data-wikilink': target }
            })
          )
          continue
        }

        if (isEmbed) {
          const kind = embedKind(target)
          const alone = text.trim() === wl[0]
          if (kind === 'image') {
            pushReplace(
              state,
              start,
              end,
              Decoration.replace({
                widget: new ImageWidget(resolveAssetUrl(target, attachments), label, alone)
              })
            )
          } else if (kind === 'video' || kind === 'audio' || kind === 'pdf') {
            pushReplace(
              state,
              start,
              end,
              Decoration.replace({
                widget: new MediaWidget(resolveAssetUrl(target, attachments), kind, label),
                block: alone
              })
            )
          } else {
            pushReplace(
              state,
              start,
              end,
              Decoration.replace({
                widget: new NoteEmbedWidget(target, handlers.loadEmbed, handlers.onOpenWikilink),
                block: alone
              })
            )
          }
          continue
        }

        // Hide the brackets and the alias pipe, keeping only the label.
        const labelStart = wl[3] ? start + wl[0].indexOf('|') + 1 : start + 2
        const labelEnd = labelStart + label.length
        pushReplace(state, start, labelStart)
        pushReplace(state, labelEnd, end)
        pushMark(
          state,
          labelStart,
          labelEnd,
          Decoration.mark({ class: 'tok-wikilink', attributes: { 'data-wikilink': target } })
        )
      }

      if (line.to >= doc.length) break
      line = doc.lineAt(line.to + 1)
    }
  }

  // --------------------------- pass 2: GFM tables ---------------------------

  {
    let n = 1
    while (n <= doc.lines) {
      const text = doc.line(n).text
      if (!/^\s*\|.*\|\s*$/.test(text) || inFence(n)) {
        n++
        continue
      }
      let end = n
      while (end + 1 <= doc.lines && /^\s*\|.*\|\s*$/.test(doc.line(end + 1).text)) end++

      // Two rows minimum, the second being the alignment row, or it is not a table.
      const isTable = end > n && /^[\s|:-]+$/.test(doc.line(n + 1).text)
      let sectionLive = false
      for (let i = n; i <= end; i++) if (liveLines.has(i)) sectionLive = true

      if (isTable && !sectionLive) {
        const rows: string[][] = []
        for (let i = n; i <= end; i++) {
          if (i === n + 1) continue
          rows.push(
            doc
              .line(i)
              .text.trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => c.trim())
          )
        }
        pushReplace(
          state,
          doc.line(n).from,
          doc.line(end).to,
          Decoration.replace({ widget: new TableWidget(rows), block: true })
        )
      }
      n = end + 1
    }
  }

  // ------------------- pass 3: the markdown tree from lezer -------------------

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name

        const heading = HEADING_CLASS[name]
        if (heading) {
          pushMark(state, node.from, node.to, Decoration.mark({ class: heading }))
          return
        }

        const inline = INLINE_CLASS[name]
        if (inline) {
          pushMark(state, node.from, node.to, Decoration.mark({ class: inline }))
          return
        }

        if (name === 'HorizontalRule' && !isLive(node.from)) {
          pushReplace(state, node.from, node.to, Decoration.replace({ widget: new RuleWidget() }))
          return
        }

        if (name === 'URL' || name === 'Link') {
          if (name === 'Link') {
            pushMark(state, node.from, node.to, Decoration.mark({ class: 'tok-link' }))
          }
          return
        }

        if (MARK_NODES.has(name)) {
          // Quote marks keep their gutter feel via the line decoration instead.
          if (isLive(node.from)) {
            pushMark(state, node.from, node.to, Decoration.mark({ class: 'tok-mark' }))
          } else {
            pushReplace(state, node.from, node.to)
          }
        }
      }
    })
  }

  return Decoration.set(state.ranges, true)
}

/** Line-level decorations: quote bars, fenced-code plates, and fold twisties. */
function buildLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  const fenceState = { open: false, startLine: 0 }
  const lineClasses = new Map<number, string[]>()
  const folded = view.state.field(foldedLines, false) ?? new Set<number>()

  const add = (lineNumber: number, cls: string): void => {
    const existing = lineClasses.get(lineNumber) ?? []
    existing.push(cls)
    lineClasses.set(lineNumber, existing)
  }

  // Leading YAML frontmatter is real data, not prose. It is dimmed and set in
  // mono so it reads as a property block under the title rather than as body
  // copy the reader has to skip past.
  let frontmatterEnd = 0
  if (doc.lines > 1 && doc.line(1).text.trim() === '---') {
    for (let n = 2; n <= doc.lines; n++) {
      if (doc.line(n).text.trim() === '---') {
        frontmatterEnd = n
        break
      }
    }
    for (let n = 1; n <= frontmatterEnd; n++) add(n, 'tok-line-fm')
  }

  // Fences must be tracked from the top of the document, not the viewport,
  // or a scrolled-into-view code block would lose its plate.
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const isFence = /^\s*(```|~~~)/.test(line.text)
    if (isFence) {
      if (!fenceState.open) {
        fenceState.open = true
        fenceState.startLine = n
        add(n, 'tok-line-code')
        add(n, 'tok-line-code-first')
      } else {
        fenceState.open = false
        add(n, 'tok-line-code')
        add(n, 'tok-line-code-last')
      }
      continue
    }
    if (fenceState.open) add(n, 'tok-line-code')
    if (/^\s*>/.test(line.text)) add(n, 'tok-line-quote')
    if (/^#{1,6}\s/.test(line.text)) add(n, 'tok-line-heading')
    if (folded.has(n)) add(n, 'tok-line-folded')
  }

  /*
   * Callouts: a blockquote opening with `> [!note]` becomes a tinted panel with
   * an icon, the way Notion's callout block reads. The whole run of `>` lines
   * belongs to the callout, so the first and last get the rounded corners and
   * the quote bar is suppressed for all of them.
   */
  for (let n = 1; n <= doc.lines; n++) {
    const opener = /^\s*>\s*\[!(\w+)\]/.exec(doc.line(n).text)
    if (!opener) continue
    const kind = opener[1].toLowerCase()

    let last = n
    while (last + 1 <= doc.lines && /^\s*>/.test(doc.line(last + 1).text)) last++

    for (let i = n; i <= last; i++) {
      const classes = lineClasses.get(i)
      if (classes) {
        const quote = classes.indexOf('tok-line-quote')
        if (quote !== -1) classes.splice(quote, 1)
      }
      add(i, 'tok-line-callout')
      add(i, `tok-callout-${kind}`)
    }
    add(n, 'tok-line-callout-first')
    add(last, 'tok-line-callout-last')
    n = last
  }

  for (const [lineNumber, classes] of [...lineClasses.entries()].sort((a, b) => a[0] - b[0])) {
    const line = doc.line(lineNumber)
    builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }))
  }

  return builder.finish()
}

/**
 * Fold leading YAML frontmatter down to a row of property names.
 *
 * This has to live in a state field rather than the view plugin: CodeMirror
 * rejects block-level decorations supplied by plugins, because they change line
 * layout and the viewport measurement would not survive it.
 */
function computeFrontmatterFold(state: EditorState): DecorationSet {
  const doc = state.doc
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return Decoration.none

  let closing = 0
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text.trim() === '---') {
      closing = n
      break
    }
  }
  if (closing === 0) return Decoration.none

  const from = doc.line(1).from
  const to = doc.line(closing).to
  // Editing inside the block unfolds it.
  if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) return Decoration.none

  const keys: string[] = []
  for (let n = 2; n < closing; n++) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*:/.exec(doc.line(n).text)
    if (m) keys.push(m[1])
  }

  return Decoration.set([
    Decoration.replace({ widget: new PropsWidget(keys), block: true }).range(from, to)
  ])
}

const frontmatterFold = StateField.define<DecorationSet>({
  create: (state) => computeFrontmatterFold(state),
  update: (value, tr) =>
    tr.docChanged || tr.selection ? computeFrontmatterFold(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field)
})

/** The collapse twisty, shown on hover in the margin beside foldable lines. */
function buildFoldHandles(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const folded = view.state.field(foldedLines, false) ?? new Set<number>()
  for (const { from, to } of view.visibleRanges) {
    let line = view.state.doc.lineAt(from)
    while (line.from <= to) {
      if (/^#{1,6}\s/.test(line.text) && isFoldable(view.state, line.number)) {
        builder.add(
          line.from,
          line.from,
          Decoration.widget({ widget: new FoldWidget(folded.has(line.number)), side: -1 })
        )
      }
      if (line.to >= view.state.doc.length) break
      line = view.state.doc.lineAt(line.to + 1)
    }
  }
  return builder.finish()
}

/** A fold toggle arrives as an effect, not a doc change, so watch for both. */
function hasEffects(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.length > 0)
}

export function livePreview(handlers: LivePreviewHandlers) {
  const marks = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, handlers)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, handlers)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )

  const lines = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLineDecorations(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || hasEffects(update)) {
          this.decorations = buildLineDecorations(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )

  const handles = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildFoldHandles(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || hasEffects(update)) {
          this.decorations = buildFoldHandles(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )

  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  const events = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null
      if (!target) return false

      const fold = target.closest('.cm-fold')
      if (fold) {
        event.preventDefault()
        const pos = view.posAtDOM(fold)
        const line = view.state.doc.lineAt(pos)
        view.dispatch({ effects: toggleFold.of(line.number) })
        return true
      }

      const collapsed = target.closest('.cm-collapsed')
      if (collapsed) {
        event.preventDefault()
        const pos = view.posAtDOM(collapsed)
        const line = view.state.doc.lineAt(pos)
        view.dispatch({ effects: toggleFold.of(line.number) })
        return true
      }

      const box = target.closest('.cm-checkbox')
      if (box) {
        event.preventDefault()
        const pos = view.posAtDOM(box)
        const line = view.state.doc.lineAt(pos)
        const task = parseTaskLine(line.text, '', 0)
        if (!task) return false
        const next: TaskStatus = event.altKey
          ? cycleStatus(task.status)
          : task.status === 'done'
            ? 'todo'
            : 'done'
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: setStatusOnLine(line.text, next) }
        })
        return true
      }

      const props = target.closest('.cm-props')
      if (props) {
        event.preventDefault()
        // Put the caret just inside the block, which unfolds it.
        const pos = view.posAtDOM(props)
        const line = view.state.doc.lineAt(pos)
        const target_ = Math.min(line.to + 1, view.state.doc.length)
        view.dispatch({ selection: { anchor: target_ }, scrollIntoView: true })
        view.focus()
        return true
      }

      const footnote = target.closest('[data-footnote]') as HTMLElement | null
      if (footnote) {
        event.preventDefault()
        const id = footnote.dataset.footnote!
        for (let n = 1; n <= view.state.doc.lines; n++) {
          const line = view.state.doc.line(n)
          if (line.text.startsWith(`[^${id}]:`)) {
            view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
            view.focus()
            return true
          }
        }
        return true
      }

      const wikilink = target.closest('[data-wikilink]') as HTMLElement | null
      if (wikilink) {
        event.preventDefault()
        handlers.onOpenWikilink(wikilink.dataset.wikilink!)
        return true
      }

      const url = target.closest('[data-url]') as HTMLElement | null
      if (url) {
        event.preventDefault()
        handlers.onOpenUrl(url.dataset.url!)
        return true
      }

      const tag = target.closest('[data-tag]') as HTMLElement | null
      if (tag) {
        event.preventDefault()
        handlers.onSelectTag(tag.dataset.tag!)
        return true
      }

      return false
    },

    /**
     * Hover preview. The delay is what separates "I am pointing at this" from
     * "my pointer crossed this on the way somewhere else".
     */
    mouseover(event) {
      if (!handlers.onHoverLink) return false
      const target = (event.target as HTMLElement | null)?.closest('[data-wikilink]') as
        | HTMLElement
        | null
      if (!target) return false
      if (hoverTimer) clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => {
        handlers.onHoverLink?.(target.dataset.wikilink!, target.getBoundingClientRect())
      }, 320)
      return false
    },

    mouseout(event) {
      const target = (event.target as HTMLElement | null)?.closest('[data-wikilink]')
      if (!target) return false
      if (hoverTimer) clearTimeout(hoverTimer)
      handlers.onHoverEnd?.()
      return false
    }
  })

  return [foldedLines, foldDecorations, frontmatterFold, marks, lines, handles, events]
}

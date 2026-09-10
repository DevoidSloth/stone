import { getIndentUnit, syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  EditorSelection,
  Prec,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text
} from '@codemirror/state'
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import type { TaskStatus } from '@shared/types'
import { cycleStatus, parseTaskLine, setStatusOnLine } from '@shared/task-syntax'
import { parseEmbed } from '@shared/attachments'
import { readStamp, stampInsertPoint } from '@shared/audio'
import { safeColour } from '@shared/text-colour'
import { fenceInfo as readFence } from '@shared/code-langs'
import { toISODate } from '../lib/dates'
import {
  TABLE_ROW_RE,
  TABLE_RULE_RE,
  alignmentsOf,
  splitRow,
  tableSource
} from './table'
import { listGeometry, revealedPrefixes } from './bullets'
import { subtreeEnd } from './lists'
import { runWidgetRanges } from './run-code'
import { vizKind } from '../viz'
import { isDrawing as isAnimating } from './animate'
import {
  ArrowWidget,
  CheckboxWidget,
  CodeHeaderWidget,
  CollapsedWidget,
  FoldWidget,
  FootnoteWidget,
  ListMarkerWidget,
  MathWidget,
  MermaidWidget,
  VizWidget,
  PropsWidget,
  QueryWidget,
  RuleWidget,
  StampWidget,
  SvgWidget,
  TableWidget,
  TocWidget,
  embedWidget,
  focusCell
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
/**
 * `^[the note itself, right here]`.
 *
 * The form that does not make you go and invent an identifier, keep it unique,
 * and maintain a list at the bottom of the file — which is why it is the one
 * people actually use. Drawn as a numbered marker with the text on hover, and
 * the numbering runs in document order over the whole note.
 */
const INLINE_FOOTNOTE_RE = /(?<![\\\w])\^\[([^\]\n]+)\]/g
/**
 * `$…$`. A `\$` is an escaped dollar and a lone `$` is just a dollar, so a
 * price mid-sentence never turns into an equation. Matches the exporter's
 * rule exactly — the two have to agree or a note prints differently to how it
 * was written.
 */
const INLINE_MATH_RE = /(?<![\\$])\$([^$\n]+?)(?<!\\)\$(?!\$)/g
const HIGHLIGHT_RE = /==(?=\S)([^\n]*?\S)==/g

/**
 * The inline HTML tags that stand in for markdown Stone has no syntax for:
 * underline, and the two that carry meaning in a formula or a citation rather
 * than decoration. Written as tags because markdown never grew any of the
 * three, and every renderer downstream already understands these.
 */
/**
 * Colour, written as the tags every other renderer understands. The quotes are
 * required and the value must be a hex — see `safeColour` — because this ends
 * up in a `style` attribute and the source of it is a file from anywhere.
 */
const COLOUR_MARKUP = [
  {
    tag: 'span',
    cls: 'tok-ink',
    property: 'color',
    re: /<span style="color:\s*([^";]+);?\s*">([\s\S]*?)<\/span>/gi
  },
  {
    tag: 'mark',
    cls: 'tok-wash',
    property: 'background',
    re: /<mark style="background:\s*([^";]+);?\s*">([\s\S]*?)<\/mark>/gi
  }
] as const

const TAG_MARKUP = [
  { name: 'u', cls: 'tok-underline', re: /<u>(?=\S)([^\n]*?\S)<\/u>/gi },
  { name: 'sup', cls: 'tok-sup', re: /<sup>(?=\S)([^\n]*?\S)<\/sup>/gi },
  { name: 'sub', cls: 'tok-sub', re: /<sub>(?=\S)([^\n]*?\S)<\/sub>/gi }
] as const

/**
 * Code is not prose, so the spellchecker has no business red-lining it. The
 * attribute goes on the element holding the code — Chromium walks up from each
 * text node to the nearest ancestor that states a preference — which turns
 * checking off for that run only, leaving the surrounding sentence checked.
 */
const NO_SPELLCHECK = { spellcheck: 'false' }

/**
 * ASCII arrows. `->` and `<-` must not be part of a longer run — `-->` and
 * `<->` are their own thing, and mangling half of one is worse than leaving it
 * alone — and `^|` `v|` must not be the tail of a word, so a table cell ending
 * in "Nov|" stays "Nov|".
 */
const ARROW_RE = /(?<![-<>=])(?:->|<-)(?![->=])|(?<![\p{L}\p{N}])(?:\^|v)\|(?!\|)/gu
const ARROW_GLYPH: Record<string, string> = {
  '->': '→',
  '<-': '←',
  '^|': '↑',
  'v|': '↓'
}

/**
 * `%%a note to yourself%%`.
 *
 * Obsidian's comment syntax, and the one piece of markdown whose entire purpose
 * is to be in the file and not in the output. Stone dims it rather than hiding
 * it: this is an editor, and text that vanishes the moment the caret leaves the
 * line is text you will eventually be surprised by. What it does not do is
 * print — see `markdownToHtml`, which drops comments on the way to HTML.
 */
const COMMENT_RE = /%%([\s\S]*?)%%/g
/** `%%` alone on a line, opening or closing a comment that spans lines. */
const COMMENT_FENCE_RE = /^\s*%%\s*$/

/** Inline code spans on a line, as `[start, end)` offsets including the ticks. */
const INLINE_CODE_RE = /(`+)(?:[^`]|(?!\1)`)+\1/g

function inlineCodeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  INLINE_CODE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_CODE_RE.exec(text)) !== null) spans.push([m.index, m.index + m[0].length])
  return spans
}

/**
 * Whether an `algo` block is waiting on a request that is actually running.
 *
 * The block says which request it belongs to, and only this session knows
 * whether that request is still out — a placeholder left behind by a restart
 * describes something nothing is going to finish, and the figure says so
 * rather than shimmering at the reader forever.
 */
function awaitingClaude(body: string): boolean {
  const id = /^\s*pending:\s*(\S+)\s*$/m.exec(body)?.[1]
  return id !== undefined && isAnimating(id)
}

/** Cheap enough to run per line: does this line open a list item at all? */
const LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/

/**
 * The last line of the document's leading YAML block, or 0 when it has none.
 *
 * Frontmatter looks like prose to every line-by-line scan in this file and is
 * not: `- release` under a `tags:` key is a YAML sequence, and drawing a bullet
 * on it would be the editor lying about what the file says.
 */
function frontmatterEnd(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return 0
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text.trim() === '---') return n
  }
  return 0
}

/**
 * What number each inline footnote is, keyed by where it starts.
 *
 * Counted from the top of the document rather than from the viewport: a
 * footnote's number is its position in the note, and one that renumbered itself
 * as you scrolled would be worse than no number at all.
 */
function inlineFootnoteNumbers(doc: Text, fences: Map<number, Fence>): Map<number, number> {
  const numbers = new Map<number, number>()
  let next = 1
  for (let n = 1; n <= doc.lines; n++) {
    if (fences.has(n)) continue
    const line = doc.line(n)
    INLINE_FOOTNOTE_RE.lastIndex = 0
    let hit: RegExpExecArray | null
    while ((hit = INLINE_FOOTNOTE_RE.exec(line.text)) !== null) {
      numbers.set(line.from + hit.index, next++)
    }
  }
  return numbers
}

/**
 * Lines inside a `%%` … `%%` comment block, the fences included.
 *
 * A `%%` inside a code fence is content — a Jinja template, an Erlang macro —
 * so the fence map is consulted rather than trusting the two per cent signs.
 */
function commentBlocks(doc: Text, fences: Map<number, Fence>): Set<number> {
  const lines = new Set<number>()
  let open = 0
  for (let n = 1; n <= doc.lines; n++) {
    if (fences.has(n)) continue
    if (!COMMENT_FENCE_RE.test(doc.line(n).text)) {
      if (open) lines.add(n)
      continue
    }
    if (open) {
      for (let i = open; i <= n; i++) lines.add(i)
      open = 0
    } else {
      open = n
    }
  }
  // An unclosed block runs to the end of the note, which is what the writer
  // sees in Obsidian and what the exporter below will drop.
  if (open) for (let n = open; n <= doc.lines; n++) lines.add(n)
  return lines
}

// --------------------------------------------------------------- callouts

/**
 * A callout opener: `> [!note]`, with the fold marker and title Obsidian
 * writes, and any number of `>` in front of it so a callout can sit inside a
 * quote or inside another callout.
 */
const CALLOUT_OPEN_RE = /^(\s*(?:>[ \t]*)+)\[!(\w+)\]([-+])?[ \t]?/
/** The `>` prefix of a quoted line, however deep. */
const QUOTE_PREFIX_RE = /^(\s*(?:>[ \t]*)+)/

export interface CalloutRun {
  /** The line carrying `[!kind]`. */
  start: number
  /** The last line the callout owns. */
  end: number
  kind: string
  /** How many `>` deep the opener sits. 1 is a callout in ordinary prose. */
  depth: number
  /** `-` opens collapsed, `+` opens expanded, `` is not foldable at all. */
  fold: '' | '-' | '+'
}

/** How many `>` a line opens with. 0 for a line that is not quoted. */
function quoteDepth(text: string): number {
  const prefix = QUOTE_PREFIX_RE.exec(text)
  if (!prefix) return 0
  return (prefix[1].match(/>/g) ?? []).length
}

/**
 * Every callout in the document, innermost last.
 *
 * A run ends at the first line that is not quoted at least as deeply as its
 * opener, which is what lets `> > [!warning]` be a panel inside a panel and
 * still end where the inner quoting stops. Both the tint and the fold read this
 * — they have to agree about where a callout ends, or collapsing one would hide
 * a different number of lines than it drew.
 */
function calloutRuns(doc: Text): CalloutRun[] {
  const runs: CalloutRun[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const opener = CALLOUT_OPEN_RE.exec(doc.line(n).text)
    if (!opener) continue
    const depth = (opener[1].match(/>/g) ?? []).length

    let end = n
    while (end + 1 <= doc.lines && quoteDepth(doc.line(end + 1).text) >= depth) end++

    runs.push({
      start: n,
      end,
      kind: opener[2].toLowerCase(),
      depth,
      fold: (opener[3] as '-' | '+' | undefined) ?? ''
    })
  }
  // Shallow first, so a line covered by two runs takes the innermost one's
  // colour: whoever writes last wins, and the innermost is written last.
  return runs.sort((a, b) => a.start - b.start || a.depth - b.depth)
}

// ---------------------------------------------------------------- folding

/** Headings, list items and callouts the user has collapsed, as start lines. */
export const toggleFold = StateEffect.define<number>()

export const foldedLines = StateField.define<Set<number>>({
  /*
   * A callout written `> [!note]-` opens collapsed, which is the whole reason
   * Obsidian's fold marker exists: a long aside can sit in the document
   * without being read every time the note is. `+` is the same callout stated
   * the other way round, and starts open.
   */
  create: (state) => {
    const folded = new Set<number>()
    for (const run of calloutRuns(state.doc)) {
      if (run.fold === '-' && run.end > run.start) folded.add(run.start)
    }
    return folded
  },
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

  // A callout owns the run of quoted lines under it. Only one written with a
  // fold marker collapses: `> [!note]` with no marker is a panel the writer
  // meant to be read, and giving every one of them a twisty would put a
  // control on most of the callouts in most vaults.
  const callout = CALLOUT_OPEN_RE.exec(text)
  if (callout) {
    if (!callout[3]) return lineNumber
    const run = calloutRuns(doc).find((one) => one.start === lineNumber)
    return run ? run.end : lineNumber
  }

  // A list item owns its children, which is the same span the outline commands
  // move and indent — folding one and dragging one must agree about where it
  // ends, so both ask the same function.
  if (LIST_LINE_RE.test(text)) return subtreeEnd(doc, lineNumber, getIndentUnit(state))

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
  loadEmbed: (
    target: string
  ) => Promise<{ title: string; body: string; missing?: boolean } | null>
  /** Open an embedded file — a PDF, or anything with no viewer here. */
  onOpenAsset: (target: string) => void
  /** Play a recording from a moment in it: an embed's play button, or a stamp. */
  onPlayAudio: (target: string, seconds: number) => void
  /** Show a recording's transcript in the inspector. */
  onShowTranscript: (target: string) => void
  attachmentsFolder: () => string
  onHoverLink?: (target: string, rect: DOMRect) => void
  onHoverEnd?: () => void
}

// ------------------------------------------------------- block decorations

interface Fence {
  lang: string
  start: number
  /** 0 while the fence is still open at the end of the document. */
  end: number
}

const FENCE_RE = /^\s*(```|~~~)\s*(\S*)/
/** `$$` alone on a line, which opens and closes display maths the way ``` does. */
const MATH_FENCE_RE = /^\s*\$\$\s*$/

/**
 * Fenced regions, mapped line by line from the top of the document. This cannot
 * start at the viewport: a code block scrolled into view mid-fence would
 * otherwise be read as prose and get decorated as markdown.
 *
 * `$$` counts as a fence so that display maths hides its own markup and skips
 * the inline passes, exactly like a ``` block. Only the mark that opened a
 * region can close it — a `$$` inside a code block is content, not a closer.
 */
function scanFences(doc: Text): Map<number, Fence> {
  const info = new Map<number, Fence>()
  let mark = ''
  let start = 0
  let lang = ''

  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    const fence = FENCE_RE.exec(text)
    const math = MATH_FENCE_RE.test(text)

    if (!mark) {
      if (fence) {
        mark = fence[1]
        lang = fence[2] ?? ''
        start = n
      } else if (math) {
        mark = '$$'
        lang = 'math'
        start = n
      }
      continue
    }

    if (mark === '$$' ? math : fence !== null && fence[1] === mark) {
      for (let i = start; i <= n; i++) info.set(i, { lang, start, end: n })
      mark = ''
      continue
    }
    info.set(n, { lang, start, end: 0 })
  }
  return info
}

/**
 * `levels: 2-3` inside a ```toc block — which headings to list.
 *
 * The default skips h1, because in a note whose title is already at the top of
 * the page an h1 is usually that title repeated, and a contents list whose only
 * entry is the name of the note it is in is furniture.
 */
const TOC_LEVELS_RE = /^\s*levels?\s*:\s*([1-6])\s*(?:-\s*([1-6]))?\s*$/m

function tocRange(body: string): string {
  const asked = TOC_LEVELS_RE.exec(body)
  if (!asked) return '2-6'
  return `${asked[1]}-${asked[2] ?? asked[1]}`
}

/** The note's headings, as a contents list. */
function tocEntries(
  doc: Text,
  fences: Map<number, Fence>,
  body: string
): Array<{ level: number; text: string; line: number }> {
  const [min, max] = tocRange(body).split('-').map(Number)
  const entries: Array<{ level: number; text: string; line: number }> = []
  const frontmatter = frontmatterEnd(doc)

  for (let n = frontmatter + 1; n <= doc.lines; n++) {
    if (fences.has(n)) continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(doc.line(n).text)
    if (!heading) continue
    const level = heading[1].length
    if (level < min || level > max) continue
    const text = heading[2].replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').replace(/[*_`~]/g, '').trim()
    if (text) entries.push({ level, text, line: n })
  }
  return entries
}

/**
 * Fence languages that are drawn as something else entirely: a diagram, an
 * equation, a query, a figure, a contents list. Everything else is code, and
 * gets the header bar.
 */
const DRAWN_FENCES = new Set(['mermaid', 'svg', 'math', 'latex', 'stone', 'query', 'toc', 'contents'])

function isPlainCode(lang: string): boolean {
  const { name } = readFence(lang)
  return !DRAWN_FENCES.has(name) && !vizKind(name)
}

/** `$$…$$` on a single line — display maths without the two extra lines. */
const MATH_ALONE_RE = /^\$\$(?!\s*$)([\s\S]+?)\$\$$/
const EMBED_ALONE_RE = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/
const IMAGE_ALONE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/

interface BlockRegion {
  fromLine: number
  toLine: number
  deco: Decoration
  /** Tables are navigated into rather than onto — see `focusTableCell`. */
  table: boolean
}

interface BlockLayer {
  /** Line numbers the block layer owns, so the inline pass leaves them alone. */
  claimed: Set<number>
  /** The same regions as spans, for cursor motion that has to step over them. */
  regions: BlockRegion[]
  set: DecorationSet
}

/**
 * The replacements that take whole lines: diagrams, display maths, GFM tables,
 * and embeds sitting alone on a line.
 *
 * These have to be served from a state field rather than from the view plugin.
 * CodeMirror rejects both block decorations and decorations spanning a line
 * break when they arrive from a plugin — it throws a RangeError, tears the
 * plugin down, and every other live-preview decoration goes with it. One table
 * anywhere in a note was enough to drop the whole editor back to raw markdown,
 * which is why the table never drew.
 */
function computeBlockRegions(state: EditorState, handlers: LivePreviewHandlers): BlockRegion[] {
  const doc = state.doc
  const regions: BlockRegion[] = []
  const attachments = handlers.attachmentsFolder()
  const taken = new Set<number>()

  const liveLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number
    const last = doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) liveLines.add(n)
  }

  // The one table the user asked to see as markdown, if any.
  const openSource = state.field(tableSource, false) ?? null
  const sourceLines = new Set<number>(openSource === null ? [] : [openSource])

  const sectionLive = (from: number, to: number): boolean => {
    for (let n = from; n <= to; n++) if (liveLines.has(n)) return true
    return false
  }

  const claim = (fromLine: number, toLine: number, deco: Decoration, table = false): void => {
    for (let n = fromLine; n <= toLine; n++) taken.add(n)
    regions.push({ fromLine, toLine, deco, table })
  }

  const fences = scanFences(doc)

  // Whole-fence widgets: mermaid and display maths stand in for the block.
  // Display maths arrives here as either a `$$` region or a ```math fence — the
  // scan labels both `math`, so they render identically.
  for (let n = 1; n <= doc.lines; n++) {
    const fence = fences.get(n)
    if (!fence || fence.start !== n || fence.end <= n) continue

    // `!` in front of the name only turns suggestions off — see `fenceInfo`.
    const lang = readFence(fence.lang).name
    const isDiagram = lang === 'mermaid'
    // A drawing: the block holds SVG, for the pictures Mermaid has no grammar
    // for. Scrubbed before it is drawn — see `lib/svg`.
    const isDrawing = lang === 'svg'
    const isMath = lang === 'math' || lang === 'latex'
    // `stone` blocks are queries — a saved view, or one described in place.
    const isQuery = lang === 'stone' || lang === 'query'
    // A `toc` block is the note's own headings, listed where it was written.
    const isToc = lang === 'toc' || lang === 'contents'
    // `memory`, `tree` and `algo` blocks are program figures — see `viz/`.
    const figure = vizKind(lang)
    if (!isDiagram && !isDrawing && !isMath && !isQuery && !isToc && !figure) continue
    if (sectionLive(fence.start, fence.end)) continue

    const source: string[] = []
    for (let i = fence.start + 1; i < fence.end; i++) source.push(doc.line(i).text)
    const body = source.join('\n')
    claim(
      fence.start,
      fence.end,
      Decoration.replace({
        widget: figure
          ? new VizWidget(figure, body, figure === 'algo' && awaitingClaude(body))
          : isDiagram
            ? new MermaidWidget(body)
            : isDrawing
              ? new SvgWidget(body)
              : isQuery
                ? new QueryWidget(body)
                : isToc
                  ? new TocWidget(tocEntries(doc, fences, body), tocRange(body))
                  : new MathWidget(body, true),
        block: true
      })
    )
  }

  // GFM tables.
  let n = 1
  while (n <= doc.lines) {
    if (taken.has(n) || fences.has(n) || !TABLE_ROW_RE.test(doc.line(n).text)) {
      n++
      continue
    }

    let end = n
    while (
      end + 1 <= doc.lines &&
      !fences.has(end + 1) &&
      TABLE_ROW_RE.test(doc.line(end + 1).text)
    ) {
      end++
    }

    // Two rows minimum, the second being the alignment rule, or it is not a table.
    if (end > n && TABLE_RULE_RE.test(doc.line(n + 1).text)) {
      // Unlike every other block here, a table stays rendered while the caret
      // is inside it: its cells are editable, so showing source would replace
      // the grid being edited. `showTableSource` is the deliberate way out.
      if (!sourceLines.has(n)) {
        const align = alignmentsOf(doc.line(n + 1).text)
        const rows: string[][] = []
        for (let i = n; i <= end; i++) {
          if (i === n + 1) continue
          rows.push(splitRow(doc.line(i).text))
        }
        claim(n, end, Decoration.replace({ widget: new TableWidget(rows, align, n), block: true }), true)
      }
      n = end + 1
      continue
    }

    n++
  }

  // `$$E = mc^2$$` written on one line. The multi-line form is a fence and the
  // scan above has already claimed it; this is the shorthand people actually
  // type, and it centres the same way.
  for (let line = 1; line <= doc.lines; line++) {
    if (taken.has(line) || fences.has(line) || liveLines.has(line)) continue
    const inline = MATH_ALONE_RE.exec(doc.line(line).text.trim())
    if (inline) {
      claim(line, line, Decoration.replace({ widget: new MathWidget(inline[1], true), block: true }))
    }
  }

  // An embed alone on its line is a figure, not a word inside a sentence.
  for (let line = 1; line <= doc.lines; line++) {
    if (taken.has(line) || fences.has(line) || liveLines.has(line)) continue
    const text = doc.line(line).text.trim()
    if (!text.startsWith('![')) continue

    const wiki = EMBED_ALONE_RE.exec(text)
    if (wiki) {
      const widget = embedWidget(parseEmbed(wiki[1], wiki[2]), attachments, true, handlers)
      claim(line, line, Decoration.replace({ widget, block: true }))
      continue
    }

    // `![alt](path)` alone on its line. The alt text carries any size, and the
    // path decides the widget — a `.pdf` written this way is still a PDF.
    const image = IMAGE_ALONE_RE.exec(text)
    if (image) {
      claim(
        line,
        line,
        Decoration.replace({
          widget: embedWidget(parseEmbed(image[2], image[1]), attachments, true, handlers),
          block: true
        })
      )
    }
  }

  return regions
}

function buildBlockLayer(state: EditorState, handlers: LivePreviewHandlers): BlockLayer {
  const regions = computeBlockRegions(state, handlers).sort((a, b) => a.fromLine - b.fromLine)
  const claimed = new Set<number>()
  const ranges: Range<Decoration>[] = []

  for (const region of regions) {
    for (let n = region.fromLine; n <= region.toLine; n++) claimed.add(n)
    ranges.push(region.deco.range(state.doc.line(region.fromLine).from, state.doc.line(region.toLine).to))
  }

  // The run bar under a code block. It inserts rather than replaces, so it is
  // not a region and claims no lines — the fence keeps its own plate and stays
  // editable underneath.
  for (const run of runWidgetRanges(state)) {
    if (claimed.has(state.doc.lineAt(run.from).number)) continue
    ranges.push(run)
  }

  return { claimed, regions, set: Decoration.set(ranges, true) }
}

function buildDecorations(
  view: EditorView,
  handlers: LivePreviewHandlers,
  claimed: Set<number>
): DecorationSet {
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

  const fenceInfo = scanFences(doc)
  const commentLines = commentBlocks(doc, fenceInfo)
  const footnoteNumbers = inlineFootnoteNumbers(doc, fenceInfo)
  const frontmatter = frontmatterEnd(doc)
  const lists = listGeometry(
    doc,
    getIndentUnit(view.state),
    (n) => fenceInfo.has(n) || n <= frontmatter
  )
  const rawPrefix = revealedPrefixes(view.state.selection, doc, lists)

  // ---- pass 1: inline tokens Stone owns, which lezer knows nothing about ----

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from)
    while (line.from <= to) {
      const text = line.text
      const base = line.from
      const live = liveLines.has(line.number)

      /*
       * The opening line of a plain code fence, drawn as the block's header.
       *
       * Only for fences nothing else claims: a `mermaid`, `svg`, `stone` or
       * `memory` block is replaced whole by its own widget, and a header on one
       * would be a label on a picture. Bare ``` fences get one too — the copy
       * button is the point, and the label is simply empty.
       */
      const fence = fenceInfo.get(line.number)
      if (
        !live &&
        fence &&
        fence.start === line.number &&
        fence.end > line.number &&
        !claimed.has(line.number) &&
        isPlainCode(fence.lang)
      ) {
        const code: string[] = []
        for (let i = fence.start + 1; i < fence.end; i++) code.push(doc.line(i).text)
        pushReplace(
          state,
          base,
          line.to,
          Decoration.replace({ widget: new CodeHeaderWidget(fence.lang, code.join('\n')) })
        )
      }

      // Lines the block layer has replaced wholesale are not ours to decorate;
      // overlapping the two would put a mark inside a replaced range.
      if (claimed.has(line.number) || fenceInfo.has(line.number)) {
        if (line.to >= doc.length) break
        line = doc.lineAt(line.to + 1)
        continue
      }

      // The recorder's own marker, pulled out of the prose and drawn as a
      // clock in the gutter. Done before anything else on the line so the
      // callout, task and link scans below see the text without it in the way.
      const stampFrom = base + stampInsertPoint(text)
      const stamp = readStamp(text.slice(stampFrom - base))
      if (stamp) {
        pushReplace(
          state,
          stampFrom,
          stampFrom + stamp.length,
          Decoration.replace({
            widget: new StampWidget(stamp.clock, stamp.seconds, stamp.target, handlers.onPlayAudio)
          })
        )
      }

      // `> [!tip] Heading` — hide the marker and bold what follows it. The
      // tint and the glyph already say what kind of callout this is.
      //
      // The fold marker goes with it. `-` and `+` are a *control*, not content:
      // they say the callout collapses and how it opens, and leaving them on
      // the page as two stray characters after the title is exactly the kind of
      // syntax showing through that live preview exists to take away.
      const callout = CALLOUT_OPEN_RE.exec(text)
      if (callout) {
        const marker = `[!${callout[2]}]${callout[3] ?? ''}`
        const markFrom = base + callout[1].length
        const markTo = markFrom + marker.length
        if (live) {
          pushMark(state, markFrom, markTo, Decoration.mark({ class: 'tok-mark' }))
        } else {
          // Swallow the trailing space too, so the title starts at the padding
          // the callout reserves rather than one space inside it.
          pushReplace(state, markFrom, base + callout[0].length)
        }
        if (line.to > markTo) {
          pushMark(state, markTo, line.to, Decoration.mark({ class: 'tok-callout-label' }))
        }
      }

      /*
       * The list prefix: indentation, marker and the gap after it, drawn as one
       * thing in a column of its own.
       *
       * The *indentation* goes into the widget too, which is the whole reason
       * a list can be laid out on an even grid while the file keeps the two,
       * three or four spaces that were actually typed. It all comes back the
       * moment the selection reaches into the prefix — see `revealedPrefixes`,
       * which is deliberately narrower than the rest of this pass's `live`.
       */
      const item = lists.get(line.number)
      const tidy = item !== undefined && !rawPrefix.has(line.number)

      const task = parseTaskLine(text, '', 0)
      if (task) {
        // Swallow the list marker along with the brackets, so the row reads as
        // a checkbox rather than as "- [ ]" with a box tacked on.
        const prefix = /^(\s*)(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]/.exec(text)
        const boxStart = base + (tidy ? 0 : prefix ? prefix[1].length : text.indexOf('['))
        const boxEnd =
          base + (tidy ? item.prefix : prefix ? prefix[0].length : text.indexOf('[') + 3)
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
      } else if (tidy) {
        pushReplace(
          state,
          base,
          base + item.prefix,
          Decoration.replace({
            widget: new ListMarkerWidget(item.depth, item.ordered ? item.marker : null)
          })
        )
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

      // `^[an inline footnote]`. The aside is set as a marker rather than left
      // in the middle of the sentence, which is the whole reason to write one
      // — but only once the caret has left, because there is no editing text
      // that has been replaced by a number.
      INLINE_FOOTNOTE_RE.lastIndex = 0
      let inlineNote: RegExpExecArray | null
      while ((inlineNote = INLINE_FOOTNOTE_RE.exec(text)) !== null) {
        const start = base + inlineNote.index
        const end = start + inlineNote[0].length
        const number = footnoteNumbers.get(start) ?? 1
        if (live) {
          pushMark(state, start, start + 2, Decoration.mark({ class: 'tok-mark' }))
          pushMark(state, start + 2, end - 1, Decoration.mark({ class: 'tok-footnote-text' }))
          pushMark(state, end - 1, end, Decoration.mark({ class: 'tok-mark' }))
        } else {
          pushReplace(
            state,
            start,
            end,
            Decoration.replace({ widget: new FootnoteWidget(number, inlineNote[1]) })
          )
        }
      }

      if (FOOTNOTE_DEF_RE.test(text)) {
        pushMark(state, base, line.to, Decoration.mark({ class: 'tok-footnote-def' }))
      }

      /*
       * `==highlight==`. Not part of CommonMark or GFM, so lezer does not know
       * it and it has to be matched here — but it is what every Obsidian vault
       * already uses, and the toolbar offers it.
       */
      HIGHLIGHT_RE.lastIndex = 0
      let highlight: RegExpExecArray | null
      while ((highlight = HIGHLIGHT_RE.exec(text)) !== null) {
        const start = base + highlight.index
        const end = start + highlight[0].length
        pushMark(state, start + 2, end - 2, Decoration.mark({ class: 'tok-highlight' }))
        if (live) {
          pushMark(state, start, start + 2, Decoration.mark({ class: 'tok-mark' }))
          pushMark(state, end - 2, end, Decoration.mark({ class: 'tok-mark' }))
        } else {
          pushReplace(state, start, start + 2)
          pushReplace(state, end - 2, end)
        }
      }

      /*
       * The three tags markdown has no syntax for: `<u>`, `<sup>`, `<sub>`.
       *
       * CommonMark left all three out on purpose and expects the HTML instead,
       * so the tag *is* the markdown here — it is what Obsidian, GitHub and
       * this app's own exporter understand. The tags are hidden until the caret
       * comes to the line, which is the same bargain every other marker makes.
       */
      /*
       * Coloured text and coloured highlights, `<span style="color:…">` and
       * `<mark style="background:…">`. The colour is read out of the document
       * and put back into a style attribute, so only a hex value is honoured —
       * see `safeColour`. Anything else is left showing as the tag it is.
       */
      for (const colour of COLOUR_MARKUP) {
        colour.re.lastIndex = 0
        let hit: RegExpExecArray | null
        while ((hit = colour.re.exec(text)) !== null) {
          const value = safeColour(hit[1])
          if (!value) continue
          const start = base + hit.index
          const end = start + hit[0].length
          const openLen = hit[0].indexOf('>') + 1
          const closeLen = colour.tag.length + 3
          pushMark(
            state,
            start + openLen,
            end - closeLen,
            Decoration.mark({
              class: colour.cls,
              attributes: { style: `${colour.property}: ${value}` }
            })
          )
          if (live) {
            pushMark(state, start, start + openLen, Decoration.mark({ class: 'tok-mark' }))
            pushMark(state, end - closeLen, end, Decoration.mark({ class: 'tok-mark' }))
          } else {
            pushReplace(state, start, start + openLen)
            pushReplace(state, end - closeLen, end)
          }
        }
      }

      for (const tag of TAG_MARKUP) {
        tag.re.lastIndex = 0
        let hit: RegExpExecArray | null
        while ((hit = tag.re.exec(text)) !== null) {
          const start = base + hit.index
          const end = start + hit[0].length
          const open = tag.name.length + 2
          const close = tag.name.length + 3
          pushMark(state, start + open, end - close, Decoration.mark({ class: tag.cls }))
          if (live) {
            pushMark(state, start, start + open, Decoration.mark({ class: 'tok-mark' }))
            pushMark(state, end - close, end, Decoration.mark({ class: 'tok-mark' }))
          } else {
            pushReplace(state, start, start + open)
            pushReplace(state, end - close, end)
          }
        }
      }

      /*
       * `%%comment%%`. Dimmed rather than hidden, and the `%%` themselves go
       * when the caret is elsewhere so the aside reads as an aside instead of
       * as punctuation. A `%%` inside a code span is not a comment.
       */
      if (!commentLines.has(line.number)) {
        let commentCode: Array<[number, number]> | null = null
        COMMENT_RE.lastIndex = 0
        let comment: RegExpExecArray | null
        while ((comment = COMMENT_RE.exec(text)) !== null) {
          commentCode ??= inlineCodeSpans(text)
          const at = comment.index
          if (commentCode.some(([from, until]) => at >= from && at < until)) continue
          const start = base + at
          const end = start + comment[0].length
          pushMark(state, start + 2, end - 2, Decoration.mark({ class: 'tok-comment' }))
          if (live) {
            pushMark(state, start, start + 2, Decoration.mark({ class: 'tok-mark' }))
            pushMark(state, end - 2, end, Decoration.mark({ class: 'tok-mark' }))
          } else {
            pushReplace(state, start, start + 2)
            pushReplace(state, end - 2, end)
          }
        }
      }

      /*
       * `->` `<-` `^|` `v|` drawn as the arrows they picture. The pair itself
       * comes back the moment the caret lands on the line, and inside `code`
       * it never leaves — an arrow in a snippet is usually an operator.
       */
      if (!live) {
        let codeSpans: Array<[number, number]> | null = null
        ARROW_RE.lastIndex = 0
        let arrow: RegExpExecArray | null
        while ((arrow = ARROW_RE.exec(text)) !== null) {
          const glyph = ARROW_GLYPH[arrow[0]]
          if (!glyph) continue
          codeSpans ??= inlineCodeSpans(text)
          const at = arrow.index
          if (codeSpans.some(([from, until]) => at >= from && at < until)) continue
          pushReplace(
            state,
            base + at,
            base + at + arrow[0].length,
            Decoration.replace({ widget: new ArrowWidget(glyph) })
          )
        }
      }

      if (!live) {
        let mathCodeSpans: Array<[number, number]> | null = null
        INLINE_MATH_RE.lastIndex = 0
        let math: RegExpExecArray | null
        while ((math = INLINE_MATH_RE.exec(text)) !== null) {
          // `$` inside a code span is a shell prompt or a variable, not maths.
          mathCodeSpans ??= inlineCodeSpans(text)
          const at = math.index
          if (mathCodeSpans.some(([from, until]) => at >= from && at < until)) continue
          pushReplace(
            state,
            base + at,
            base + at + math[0].length,
            Decoration.replace({ widget: new MathWidget(math[1], false) })
          )
        }
      }

      // Markdown images sharing a line with prose. One alone on its line is a
      // block figure, and the block layer has already claimed it.
      MD_IMAGE_RE.lastIndex = 0
      let image: RegExpExecArray | null
      while ((image = MD_IMAGE_RE.exec(text)) !== null) {
        if (live) break
        const whole = image[0]
        pushReplace(
          state,
          base + image.index,
          base + image.index + whole.length,
          Decoration.replace({
            widget: embedWidget(parseEmbed(image[2], image[1]), attachments, false, handlers),
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

        // An embed alone on its line is drawn by the block layer instead; what
        // reaches here sits mid-sentence and stays inline.
        if (isEmbed) {
          const widget = embedWidget(parseEmbed(target, wl[3]), attachments, false, handlers)
          pushReplace(state, start, end, Decoration.replace({ widget }))
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

  // ------------------- pass 2: the markdown tree from lezer -------------------

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (claimed.has(doc.lineAt(node.from).number)) return false
        const name = node.name

        // An indented code block has no fence to announce it, so the line
        // layer never plates it — but it is still code, and the tree is where
        // it shows up. `CodeText` is the run inside a fence, harmless to mark
        // twice and cheaper than proving it was already covered.
        if (name === 'CodeBlock' || name === 'CodeText') {
          pushMark(state, node.from, node.to, Decoration.mark({ attributes: NO_SPELLCHECK }))
          return false
        }

        const heading = HEADING_CLASS[name]
        if (heading) {
          pushMark(state, node.from, node.to, Decoration.mark({ class: heading }))
          return
        }

        const inline = INLINE_CLASS[name]
        if (inline) {
          pushMark(
            state,
            node.from,
            node.to,
            Decoration.mark(
              name === 'InlineCode'
                ? { class: inline, attributes: NO_SPELLCHECK }
                : { class: inline }
            )
          )
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
  // Custom properties a line needs, as declarations to be joined. More than one
  // thing can want one — a list inside a callout wants both — so they collect
  // rather than overwrite.
  const lineStyles = new Map<number, string[]>()
  const addStyle = (lineNumber: number, declaration: string): void => {
    const existing = lineStyles.get(lineNumber) ?? []
    existing.push(declaration)
    lineStyles.set(lineNumber, existing)
  }
  const folded = view.state.field(foldedLines, false) ?? new Set<number>()

  const add = (lineNumber: number, cls: string): void => {
    const existing = lineClasses.get(lineNumber) ?? []
    existing.push(cls)
    lineClasses.set(lineNumber, existing)
  }

  // Leading YAML frontmatter is real data, not prose. It is dimmed and set in
  // mono so it reads as a property block under the title rather than as body
  // copy the reader has to skip past.
  const frontmatter = frontmatterEnd(doc)
  for (let n = 1; n <= frontmatter; n++) add(n, 'tok-line-fm')

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

  // A `%%` block: a run of lines that are in the file and not in the export.
  for (const n of commentBlocks(doc, scanFences(doc))) add(n, 'tok-line-comment')

  /*
   * Callouts: a blockquote opening with `> [!note]` becomes a tinted panel with
   * an icon, the way Notion's callout block reads. The whole run of `>` lines
   * belongs to the callout, so the first and last get the rounded corners and
   * the quote bar is suppressed for all of them.
   */
  /*
   * Callouts are painted shallowest first, so a nested one lands on top of the
   * panel holding it. Each line remembers which kind painted it last: that is
   * the run enclosing the next one, and it is what the inner panel's margins
   * are filled with — the strip either side of an inner callout has to be the
   * outer callout's own tint, or the inner one looks like it has broken out.
   */
  const paintedBy = new Map<number, string>()
  for (const run of calloutRuns(doc)) {
    for (let i = run.start; i <= run.end; i++) {
      const outer = paintedBy.get(i)
      const classes = lineClasses.get(i)
      if (classes) {
        const quote = classes.indexOf('tok-line-quote')
        if (quote !== -1) classes.splice(quote, 1)
        // The innermost callout is the one whose colour a line takes, so a
        // shallower run's tint comes off rather than fighting it in the
        // cascade — two `tok-callout-*` classes on one line resolve by
        // stylesheet order, which has nothing to do with which is inside which.
        for (let c = classes.length - 1; c >= 0; c--) {
          if (classes[c].startsWith('tok-callout-')) classes.splice(c, 1)
        }
      }
      add(i, 'tok-line-callout')
      add(i, `tok-callout-${run.kind}`)
      // Depth 1 is a callout in prose; anything deeper is one inside a quote or
      // inside another callout, and is inset so it reads as being held by it.
      if (run.depth > 1) {
        add(i, 'tok-line-callout--nested')
        if (outer) add(i, `tok-callout-under-${outer}`)
        // How many panels this one is inside, which is how far it insets. A
        // third level can only paint the strip beside it in one colour — its
        // parent's — so a very deep nest is drawn one shade short of exact.
        // Two is what people write; the alternative is a gradient per depth.
        addStyle(i, `--callout-nest: ${run.depth - 1}`)
      }
      paintedBy.set(i, run.kind)
    }
    add(run.start, 'tok-line-callout-first')
    add(run.end, 'tok-line-callout-last')
    if (folded.has(run.start) && run.end > run.start) add(run.start, 'tok-line-callout--collapsed')
  }

  /*
   * Lists, laid out on a grid.
   *
   * Two things come from the depth. The item hangs from a fixed column rather
   * than from however many spaces were typed, so a list indented two spaces and
   * one indented four look identical on the page. And the line is given a
   * hanging indent, so an item that wraps continues under its own text instead
   * of running back to the margin underneath its bullet — the single thing that
   * most makes a long list read as a list.
   *
   * Both stand down when the marker itself is revealed, and only then: a
   * hanging indent measured for a bullet that is not being drawn would put the
   * text in the wrong place.
   */
  const lists = listGeometry(doc, getIndentUnit(view.state), (n) => {
    const classes = lineClasses.get(n) ?? []
    return classes.includes('tok-line-code') || classes.includes('tok-line-fm')
  })
  const rawPrefix = revealedPrefixes(view.state.selection, doc, lists)
  for (const [lineNumber, item] of lists) {
    add(lineNumber, 'tok-line-list')
    if (!rawPrefix.has(lineNumber)) add(lineNumber, 'tok-line-list--tidy')
    addStyle(lineNumber, `--list-depth: ${item.depth}`)
  }

  for (const [lineNumber, classes] of [...lineClasses.entries()].sort((a, b) => a[0] - b[0])) {
    const line = doc.line(lineNumber)
    // A fenced block is code all the way down, so the whole line opts out of
    // spellchecking rather than each token inside it. Frontmatter goes the same
    // way: a red line under a YAML key is noise, not a typo worth reporting.
    const prose = !classes.includes('tok-line-code') && !classes.includes('tok-line-fm')
    const style = lineStyles.get(lineNumber)?.join('; ')
    const attributes = prose
      ? style
        ? { style }
        : undefined
      : style
        ? { ...NO_SPELLCHECK, style }
        : NO_SPELLCHECK
    builder.add(
      line.from,
      line.from,
      Decoration.line({ class: classes.join(' '), attributes })
    )
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

/**
 * The collapse twisty, shown on hover in the margin beside foldable lines.
 *
 * A list item with children gets one as well as a heading. The machinery was
 * already there — `sectionEnd` has always known what an item owns, and
 * Ctrl/Cmd Shift H has always folded one — but with nothing drawn, the only way
 * to find out that a list could collapse was to try it.
 */
function buildFoldHandles(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const folded = view.state.field(foldedLines, false) ?? new Set<number>()
  const doc = view.state.doc
  const fenceInfo = scanFences(doc)
  const frontmatter = frontmatterEnd(doc)

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from)
    while (line.from <= to) {
      const heading = /^#{1,6}\s/.test(line.text)
      const callout = CALLOUT_OPEN_RE.test(line.text)
      // Depth is not needed here, only whether the line opens an item at all —
      // and a `- flag` in a shell script or a YAML key is not one.
      const item =
        LIST_LINE_RE.test(line.text) && !fenceInfo.has(line.number) && line.number > frontmatter
      if ((heading || item || callout) && isFoldable(view.state, line.number)) {
        builder.add(
          line.from,
          line.from,
          Decoration.widget({
            widget: new FoldWidget(folded.has(line.number), heading || callout ? 'section' : 'item'),
            side: -1
          })
        )
      }
      if (line.to >= doc.length) break
      line = doc.lineAt(line.to + 1)
    }
  }
  return builder.finish()
}

// ------------------------------------------------------- cursor navigation

interface BlockSpan {
  from: number
  to: number
  fromLine: number
  toLine: number
  table: boolean
}

/** Every whole-line region currently standing in for the markdown beneath it. */
function blockSpans(state: EditorState, layer: StateField<BlockLayer>): BlockSpan[] {
  const doc = state.doc
  const spans: BlockSpan[] = state.field(layer).regions.map((region) => ({
    from: doc.line(region.fromLine).from,
    to: doc.line(region.toLine).to,
    fromLine: region.fromLine,
    toLine: region.toLine,
    table: region.table
  }))

  // Folded frontmatter is a block widget too, and it is why the caret could not
  // reach the top of any note that has any.
  for (const iter = state.field(frontmatterFold).iter(); iter.value; iter.next()) {
    spans.push({
      from: iter.from,
      to: iter.to,
      fromLine: doc.lineAt(iter.from).number,
      toLine: doc.lineAt(iter.to).number,
      table: false
    })
  }

  return spans.sort((a, b) => a.from - b.from)
}

function moveCaret(view: EditorView, pos: number): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/**
 * A table is edited in its cells, never on its lines, so arrowing into one puts
 * the focus in a cell rather than dropping the caret behind the widget where it
 * would be invisible. Entering from above lands in the header, from below in the
 * last row.
 */
function focusTableCell(view: EditorView, span: BlockSpan, forward: boolean): boolean {
  const table = view.contentDOM.querySelector(`.cm-table[data-line="${span.fromLine}"]`)
  if (!table) return false
  const column = table.querySelectorAll<HTMLElement>('.cm-table__cell[data-col="0"]')
  const cell = forward ? column[0] : column[column.length - 1]
  if (!cell) return false
  focusCell(cell)
  return true
}

/**
 * Vertical motion across block widgets.
 *
 * `posAtCoords` deliberately steps *over* any block that is not text: given a y
 * that lands in one, it walks half a line at a time until it finds a block it
 * can put a caret in. That is right for a page break and wrong for everything
 * Stone draws — a table, a diagram, a display equation, a folded frontmatter
 * block are all things the user pressed Down to get *into*, and they were being
 * jumped clean over.
 *
 * So the move is computed first, without dispatching it, and if it cleared a
 * block on the way the caret goes to that block instead. Landing on a fenced
 * block's line is what reveals its source, so the second press carries on
 * through the markdown the first one exposed.
 */
function blockAwareMove(layer: StateField<BlockLayer>, forward: boolean): Command {
  return (view) => {
    const range = view.state.selection.main
    if (!range.empty) return false

    const spans = blockSpans(view.state, layer)
    if (spans.length === 0) return false

    const doc = view.state.doc
    const head = range.head

    // Already parked on a block: leave by the line beyond it, rather than by
    // coordinates that sit somewhere inside a widget.
    const inside = spans.find((span) => head >= span.from && head <= span.to)
    if (inside) {
      const line = forward ? inside.toLine + 1 : inside.fromLine - 1
      if (line < 1 || line > doc.lines) return false
      return moveCaret(view, doc.line(line).from)
    }

    const target = view.moveVertically(range, forward).head
    if (target === head) return false

    const lo = Math.min(head, target)
    const hi = Math.max(head, target)
    const cleared = spans.filter((span) => span.from >= lo && span.to <= hi)
    if (cleared.length === 0) return false

    // The nearest one in the direction of travel; a single press should never
    // cross two blocks.
    const span = forward ? cleared[0] : cleared[cleared.length - 1]
    if (span.table && focusTableCell(view, span, forward)) return true
    return moveCaret(view, doc.line(forward ? span.fromLine : span.toLine).from)
  }
}

/** A fold toggle arrives as an effect, not a doc change, so watch for both. */
function hasEffects(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.length > 0)
}

export function livePreview(handlers: LivePreviewHandlers) {
  /*
   * Block-level replacements live in a state field, not in the view plugin
   * below. CodeMirror refuses block decorations — and any decoration crossing a
   * line break — from a plugin, and enforces it by throwing, which takes the
   * whole plugin down with it. The field is per-editor because it closes over
   * these handlers.
   */
  const blockLayer = StateField.define<BlockLayer>({
    create: (state) => buildBlockLayer(state, handlers),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? buildBlockLayer(tr.state, handlers) : value,
    provide: (field) => EditorView.decorations.from(field, (layer) => layer.set)
  })

  const marks = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, handlers, view.state.field(blockLayer).claimed)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(
            update.view,
            handlers,
            update.state.field(blockLayer).claimed
          )
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
        // Selection too: a list line drops its grid while the caret is on it.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          hasEffects(update)
        ) {
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

  return [
    tableSource,
    foldedLines,
    foldDecorations,
    frontmatterFold,
    blockLayer,
    marks,
    lines,
    handles,
    events,
    // A collapsed section is a replacement spanning line breaks. Without this
    // the caret walks into the hidden text and disappears.
    EditorView.atomicRanges.of((view) => view.state.field(foldDecorations)),
    // Above the default keymap, below vim's — a vim user's `j` and `k` are
    // their own business.
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: blockAwareMove(blockLayer, true) },
        { key: 'ArrowUp', run: blockAwareMove(blockLayer, false) }
      ])
    )
  ]
}

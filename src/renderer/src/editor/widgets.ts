import { WidgetType, type EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import katex from 'katex'
import { sanitizeSvg } from '../lib/svg'
import { renderViz, type Rendered, type VizKind } from '../viz'
import { datatypeFor } from './datatypes'
import { useStone } from '../store'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TaskStatus } from '@shared/types'
import { embedKind, resolveAssetUrl, withEmbedWidth, type EmbedSpec } from '@shared/attachments'
import { splitTarget } from '@shared/sections'
import { languageFor } from '@shared/code-langs'
import { enqueueRender, openPdf } from '../lib/pdfjs'
import { EmbeddedQuery } from '../components/EmbeddedQuery'
import {
  asModel,
  deleteColumn,
  deleteRow,
  findTable,
  insertColumn,
  insertRow,
  setCell,
  setAlignment,
  nextAlignment,
  revealTableSource,
  setPendingFocus,
  takePendingFocus,
  writeTable,
  type CellAlign,
  type TableEdit,
  type TableModel
} from './table'

/**
 * The block and inline widgets live preview swaps in for raw markdown.
 *
 * Each one obeys the same contract: the document is never rewritten, the widget
 * is only shown while the caret is elsewhere, and `ignoreEvent` returns false so
 * clicks reach the editor's own DOM handlers rather than being swallowed as a
 * selection drag.
 *
 * `TableWidget` is the deliberate exception on all three counts — it is edited
 * in place, so it holds the caret and writes the document itself.
 */

/**
 * The spacer element every block widget hands to CodeMirror.
 *
 * CodeMirror measures a block widget with `getBoundingClientRect()`, and that
 * does not include margins. A `margin: 12px 0` on a table is 24px of layout the
 * height map never learns about, and the error compounds down the page: every
 * click below the table lands lower than it was aimed, and Up shoots to the top
 * of the note because the coordinate it scans back to is one the editor has no
 * block for. So the gap between a block and the prose around it is padding on
 * this shell, and everything with a border, a background or a radius stays on
 * the element inside it.
 */
function blockShell(inner: HTMLElement, gap: 'tight' | 'wide' = 'tight'): HTMLElement {
  const root = document.createElement('div')
  root.className = gap === 'wide' ? 'cm-block cm-block--wide' : 'cm-block'
  root.appendChild(inner)
  return root
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly status: TaskStatus) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return other.status === this.status
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-checkbox'
    box.dataset.status = this.status
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.status === 'done'))
    box.setAttribute('tabindex', '-1')
    return box
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * How many marker shapes there are before the sequence repeats.
 *
 * Filled, hollow, square — the sequence Word, Notion and every outliner since
 * has used, and the reason is that it survives being wrong: a reader who has
 * lost track of which level they are on can tell two adjacent levels apart by
 * shape alone, without counting indentation.
 *
 * The shapes themselves are drawn in CSS from `data-level`, not typed as •, ◦
 * and ▪ — see `.cm-bullet` in editor.css for why a character cannot hold its
 * height across the three typefaces the font setting offers.
 */
const BULLET_LEVELS = 3

/**
 * A list item's marker: `-` drawn as a bullet, or an ordinal set in its column.
 *
 * The widget stands in for the item's whole prefix — its indentation as well as
 * its marker — which is what puts a nested item on an exact grid instead of on
 * however many spaces were typed. The depth comes down as a custom property on
 * the line, so the margin here and the hanging indent on the line can never
 * disagree about which column the text starts in.
 *
 * As everywhere else in live preview, the caret arriving on the line takes the
 * widget away again and the raw markdown comes back.
 */
export class ListMarkerWidget extends WidgetType {
  constructor(
    readonly depth: number,
    /** The ordinal with its dot, or null for a bullet. */
    readonly ordinal: string | null
  ) {
    super()
  }

  eq(other: ListMarkerWidget): boolean {
    return other.depth === this.depth && other.ordinal === this.ordinal
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.ordinal === null ? 'cm-bullet' : 'cm-bullet cm-bullet--ordered'
    if (this.ordinal === null) {
      // Which shape this level gets, for the stylesheet to draw. The element
      // holds no text: a bullet is a mark on the page rather than a character
      // in the sentence, and the document's own `-` is what gets copied.
      el.dataset.level = String(this.depth % BULLET_LEVELS)
      el.setAttribute('aria-hidden', 'true')
    } else {
      el.textContent = this.ordinal
    }
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * The arrow an ASCII pair stands for: `->` `<-` `^|` `v|`. The document keeps
 * the two characters you typed, so the note is still plain markdown anywhere
 * else — only the drawing is an arrow.
 */
export class ArrowWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super()
  }

  eq(other: ArrowWidget): boolean {
    return other.glyph === this.glyph
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'tok-arrow'
    el.textContent = this.glyph
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'tok-hr'
    el.textContent = ' '
    return el
  }
}

/**
 * Stands in for a folded YAML frontmatter block. Raw `---` fences are noise on
 * a page you are reading; the keys are shown instead, and clicking drops the
 * caret inside so the block unfolds for editing.
 */
export class PropsWidget extends WidgetType {
  constructor(readonly keys: string[]) {
    super()
  }

  eq(other: PropsWidget): boolean {
    return other.keys.join() === this.keys.join()
  }

  get estimatedHeight(): number {
    return 32
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-props'
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '-1')
    el.title = 'Page properties — click to edit'
    if (this.keys.length === 0) {
      el.textContent = 'Properties'
    } else {
      for (const key of this.keys) {
        const chip = document.createElement('span')
        chip.className = 'cm-props__key'
        chip.textContent = key
        el.appendChild(chip)
      }
    }
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Corner-drag resizing for a block embed.
 *
 * The size lives in the document — `![[a.png|420]]` — so a drag has to end in
 * an edit, not in a style that disappears on the next re-render. During the
 * drag only the element's own style moves, which is instant and costs nothing;
 * the transaction is dispatched once, on release, so the undo history gets one
 * entry for "resized the picture" rather than one per mouse move.
 *
 * Double-clicking the handle drops the size again and returns the embed to
 * whatever its natural width is, which is otherwise oddly hard to get back to.
 */
function resizable(
  view: EditorView,
  root: HTMLElement,
  target: HTMLElement,
  onLive?: (width: number) => void
): HTMLElement {
  const handle = document.createElement('span')
  handle.className = 'cm-embed__grip'
  handle.title = 'Drag to resize, double-click to reset'

  const write = (width: number | null): void => {
    // A drag that outlives its widget — the note was reloaded, or an edit
    // landed from somewhere else — has nothing left to write into.
    if (!root.isConnected) return
    const pos = view.posAtDOM(root)
    if (pos > view.state.doc.length) return
    const line = view.state.doc.lineAt(pos)
    const next = withEmbedWidth(line.text, width)
    if (next === null || next === line.text) return
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next } })
  }

  handle.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    // Without this the editor treats the press as a click into the text and
    // replaces the widget with its source mid-drag.
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = target.getBoundingClientRect().width
    // Never wider than the column it sits in: a picture that overflows the
    // editor cannot be grabbed again to make it smaller.
    const max = Math.round(view.contentDOM.getBoundingClientRect().width)
    let width = Math.round(startWidth)

    const move = (e: MouseEvent): void => {
      width = Math.round(Math.min(Math.max(startWidth + (e.clientX - startX), MIN_EMBED_WIDTH), max))
      target.style.width = `${width}px`
      target.style.height = 'auto'
      target.style.maxHeight = 'none'
      onLive?.(width)
    }

    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      root.classList.remove('cm-embed--resizing')
      if (Math.abs(width - startWidth) >= 2) write(width)
    }

    root.classList.add('cm-embed--resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })

  handle.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    write(null)
  })

  return handle
}

/** Small enough to be a thumbnail, big enough to still have a grip on it. */
const MIN_EMBED_WIDTH = 48

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean,
    /** From `![[a.png|300]]`; null means the picture's own size. */
    readonly width: number | null = null,
    readonly height: number | null = null
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.block === this.block &&
      other.width === this.width &&
      other.height === this.height
    )
  }

  /**
   * A guess for the lines CodeMirror has not drawn yet. It only has to be the
   * right order of magnitude — a widget assumed to be one line tall throws the
   * scrollbar and every coordinate below it out by the height of the picture.
   */
  get estimatedHeight(): number {
    if (!this.block) return -1
    return this.height ?? (this.width ? Math.round(this.width * 0.66) : 260)
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'cm-embed cm-embed--image' : 'cm-embed cm-embed--image-inline'

    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    // A requested size goes on the element rather than in CSS so the box is
    // reserved before the bytes arrive — otherwise every image on screen
    // reflows the note underneath it as it decodes.
    if (this.width) {
      img.width = this.width
      img.style.width = `${this.width}px`
    }
    if (this.height) {
      img.height = this.height
      img.style.height = `${this.height}px`
    }
    if (this.width || this.height) wrap.classList.add('cm-embed--sized')
    // Not `loading="lazy"`. CodeMirror already draws only what is on screen, so
    // the browser's own deferral buys nothing and costs a widget that reports
    // zero height until it is scrolled to — which is exactly the kind of lie the
    // height map cannot recover from.
    img.draggable = false
    // A broken path should say so rather than leave a silent gap.
    img.addEventListener('error', () => {
      wrap.classList.add('cm-embed--missing')
      wrap.textContent = `Missing: ${this.alt || this.src}`
    })
    wrap.appendChild(img)
    if (!this.block) return wrap

    // Only a figure on its own line gets a grip: an embed mid-sentence shares
    // the line with prose, and the write-back has no unambiguous text to edit.
    const shell = blockShell(wrap)
    wrap.appendChild(resizable(view, shell, img))
    return shell
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class MediaWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly kind: 'video' | 'audio',
    readonly label: string
  ) {
    super()
  }

  eq(other: MediaWidget): boolean {
    return other.src === this.src && other.kind === this.kind
  }

  get estimatedHeight(): number {
    return this.kind === 'audio' ? 60 : 280
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = `cm-embed cm-embed--${this.kind}`

    const media = document.createElement(this.kind)
    media.src = this.src
    media.controls = true
    media.className = 'cm-embed__media'
    wrap.appendChild(media)
    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * A recording, embedded in the note it was taken against.
 *
 * Not an `<audio controls>`, which is what the generic media embed gives every
 * other sound file. A lecture is played from the bar at the foot of the window
 * so that scrolling past the embed — or opening a different note to compare
 * something — does not stop it, and so that the timestamps scattered down the
 * note are all seeking the same clock. This card is the handle on that player,
 * not a second one.
 */
export class RecordingWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly onPlay: (target: string, seconds: number) => void,
    readonly onTranscript: (target: string) => void
  ) {
    super()
  }

  eq(other: RecordingWidget): boolean {
    return other.target === this.target && other.label === this.label
  }

  get estimatedHeight(): number {
    return 52
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--recording'

    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'cm-recording__play'
    play.title = 'Play this recording'
    play.setAttribute('aria-label', 'Play this recording')
    // Drawn rather than a glyph, so it matches the icon family everywhere else.
    play.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.6v8.8a.6.6 0 0 0 .92.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4A.6.6 0 0 0 5 3.6Z"/></svg>'
    play.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onPlay(this.target, 0)
    })

    const name = document.createElement('span')
    name.className = 'cm-recording__name truncate'
    name.textContent = decodeSafely(this.label)

    const transcript = document.createElement('button')
    transcript.type = 'button'
    transcript.className = 'cm-recording__action'
    transcript.textContent = 'Transcript'
    transcript.title = 'Show the transcript, or make one'
    transcript.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onTranscript(this.target)
    })

    wrap.append(play, name, transcript)
    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** A percent-encoded name, shown the way it looks in the Finder. */
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * The clock in front of a stamped line.
 *
 * Always replaced, never revealed as raw markdown the way every other marker
 * is when the caret lands on its line. There is nothing in it a person would
 * want to edit by hand — the recorder wrote it and the player reads it — and
 * un-hiding forty characters of link on whichever line is being typed would
 * make writing during a lecture feel like the text was sliding around. The
 * marker is registered as an atomic range instead, so the caret steps over it
 * and one backspace takes the whole thing.
 */
export class StampWidget extends WidgetType {
  constructor(
    readonly clock: string,
    readonly seconds: number,
    readonly target: string,
    readonly onPlay: (target: string, seconds: number) => void
  ) {
    super()
  }

  eq(other: StampWidget): boolean {
    return (
      other.clock === this.clock && other.seconds === this.seconds && other.target === this.target
    )
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-stamp'
    button.textContent = this.clock
    button.title = `Play the recording from ${this.clock}`
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onPlay(this.target, this.seconds)
    })
    return button
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * An embedded PDF page.
 *
 * Chromium's own viewer would be less code — `<object type="application/pdf">`
 * and nothing else — but it scrolls the whole document inside a box in the
 * middle of the note, captures the wheel, and cannot be told to show page four.
 * An embed is a figure, not a reader: it should show the page the note is
 * talking about, at the size the note asked for, and hand the reader off to the
 * real viewer when they want the rest.
 *
 * So the page is drawn with the same pdf.js the document pane uses, through the
 * shared queue — a note that embeds a dozen pages must not start a dozen decodes
 * on first paint.
 */
export class PdfEmbedWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly page: number,
    readonly label: string,
    readonly width: number | null,
    readonly height: number | null,
    /** The target as written, which is what the opener needs — not the URL. */
    readonly target: string,
    readonly onOpen: (target: string) => void
  ) {
    super()
  }

  eq(other: PdfEmbedWidget): boolean {
    return (
      other.src === this.src &&
      other.page === this.page &&
      other.label === this.label &&
      other.width === this.width &&
      other.height === this.height &&
      other.target === this.target
    )
  }

  get estimatedHeight(): number {
    // A4 in portrait is the overwhelmingly common case, and being roughly right
    // keeps the scrollbar honest until the page has actually been measured.
    return this.height ?? Math.round((this.width ?? PDF_EMBED_WIDTH) * 1.414) + 34
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--pdf'
    if (this.width) wrap.style.maxWidth = `${this.width}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'cm-embed__page'

    const status = document.createElement('p')
    status.className = 'cm-embed__status'
    status.textContent = 'Opening…'

    const bar = document.createElement('div')
    bar.className = 'cm-embed__bar'

    const name = document.createElement('span')
    name.className = 'cm-embed__name'
    name.textContent = this.label

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'cm-embed__open'
    open.textContent = 'Open'
    open.addEventListener('mousedown', (event) => {
      // The editor would otherwise take the click as a caret move, which
      // replaces this widget with its source before the handler ever runs.
      event.preventDefault()
      event.stopPropagation()
      this.onOpen(this.target)
    })

    bar.append(name, open)
    wrap.append(canvas, status, bar)

    // The drag scales the bitmap already drawn, which is instant and slightly
    // soft; the edit it ends with rebuilds the widget and redraws the page at
    // the new size, so the softness lasts exactly as long as the drag does.
    const shell = blockShell(wrap)
    wrap.appendChild(resizable(view, shell, canvas, (width) => {
      wrap.style.maxWidth = `${width}px`
    }))

    enqueueRender(async () => {
      try {
        const pdf = await openPdf(this.src)
        const page = await pdf.getPage(Math.min(this.page, pdf.numPages))

        // Draw at device resolution, then lay the canvas out in CSS pixels, so
        // the type in the page is as crisp as the type around it.
        const base = page.getViewport({ scale: 1 })
        const target = this.width ?? PDF_EMBED_WIDTH
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (target / base.width) * dpr })

        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / dpr}px`
        canvas.style.height = `${viewport.height / dpr}px`

        const context = canvas.getContext('2d')
        if (!context) throw new Error('no 2d context')
        await page.render({ canvasContext: context, viewport, canvas }).promise

        status.remove()
        if (pdf.numPages > 1) {
          name.textContent = `${this.label} · page ${Math.min(this.page, pdf.numPages)} of ${pdf.numPages}`
        }
      } catch (err) {
        // A PDF that will not draw still has a name and a way in; saying so
        // beats a blank rectangle the reader cannot act on.
        canvas.remove()
        wrap.classList.add('cm-embed--missing')
        status.textContent = `Could not draw this PDF: ${(err as Error).message}`
      }
    })

    return shell
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** The width an embedded page is drawn at when the note does not say. */
const PDF_EMBED_WIDTH = 520

/**
 * The widget for an embed target, whatever it turns out to be.
 *
 * Kept in one place because the three call sites — a figure on its own line, an
 * embed mid-sentence, and markdown `![](…)` syntax — were each deciding this
 * separately, and drifted: a `.pdf` written with markdown syntax used to render
 * as a broken `<img>`.
 */
export function embedWidget(
  spec: EmbedSpec,
  attachmentsFolder: string,
  block: boolean,
  handlers: {
    loadEmbed: (
      target: string
    ) => Promise<{ title: string; body: string; missing?: boolean } | null>
    onOpenWikilink: (target: string) => void
    onOpenAsset: (target: string) => void
    onPlayAudio: (target: string, seconds: number) => void
    onShowTranscript: (target: string) => void
  }
): WidgetType {
  if (spec.kind === 'note') {
    return new NoteEmbedWidget(spec.target, handlers.loadEmbed, handlers.onOpenWikilink)
  }

  const src = resolveAssetUrl(spec.target, attachmentsFolder)

  if (spec.kind === 'image') {
    return new ImageWidget(src, spec.label, block, spec.width, spec.height)
  }
  if (spec.kind === 'pdf') {
    return new PdfEmbedWidget(
      src,
      spec.page,
      spec.label,
      spec.width,
      spec.height,
      spec.target,
      handlers.onOpenAsset
    )
  }
  if (spec.kind === 'audio') {
    return new RecordingWidget(
      spec.target,
      spec.label,
      handlers.onPlayAudio,
      handlers.onShowTranscript
    )
  }
  if (spec.kind === 'video') {
    return new MediaWidget(src, spec.kind, spec.label)
  }
  return new FileEmbedWidget(spec.target, spec.label, handlers.onOpenAsset)
}

/**
 * Anything with no viewer of its own — a .zip, a .docx. There is nothing to
 * draw, so the embed becomes a card that opens it in whatever the OS uses.
 */
export class FileEmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly onOpen: (target: string) => void
  ) {
    super()
  }

  eq(other: FileEmbedWidget): boolean {
    return other.target === this.target && other.label === this.label
  }

  get estimatedHeight(): number {
    return 44
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--file'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-embed__file'
    button.textContent = this.label
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onOpen(this.target)
    })

    wrap.appendChild(button)
    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * A transcluded note. The body arrives asynchronously, because the editor
 * cannot block on reading another file — the widget renders its frame first and
 * fills in when the content lands, which also keeps a long chain of embeds from
 * stalling the first paint.
 */
export class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly load: (
      target: string
    ) => Promise<{ title: string; body: string; missing?: boolean } | null>,
    readonly onOpen: (target: string) => void
  ) {
    super()
  }

  eq(other: NoteEmbedWidget): boolean {
    return other.target === this.target
  }

  get estimatedHeight(): number {
    return 160
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--note'

    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'cm-embed__title'
    head.textContent = this.target
    head.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onOpen(this.target)
    })

    const body = document.createElement('div')
    body.className = 'cm-embed__body'
    body.textContent = 'Loading…'

    wrap.append(head, body)

    void this.load(this.target).then((note) => {
      if (!note) {
        wrap.classList.add('cm-embed--missing')
        body.textContent = `"${this.target}" is not in the vault.`
        return
      }
      head.textContent = note.title
      // The note is there but the fragment names nothing in it — a renamed
      // heading, or a block id that was edited away. Saying so beats quietly
      // embedding the whole page, which is what this used to do.
      if (note.missing) {
        wrap.classList.add('cm-embed--missing')
        body.textContent = `That note has no "${splitTarget(this.target).heading ?? `^${splitTarget(this.target).block}`}".`
        return
      }
      body.textContent = ''
      // Plain text, deliberately: rendering markdown here would mean a second
      // renderer to keep in step with the editor's, and an embed is a preview.
      for (const line of note.body.split('\n').slice(0, 40)) {
        const p = document.createElement('p')
        p.textContent = line
        if (!line.trim()) p.className = 'cm-embed__gap'
        body.appendChild(p)
      }
    })

    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** KaTeX, rendered to static HTML. Errors show the source rather than vanishing. */
export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly block: boolean
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.block === this.block
  }

  get estimatedHeight(): number {
    return this.block ? 56 : -1
  }

  toDOM(): HTMLElement {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className = this.block ? 'cm-math cm-math--block' : 'cm-math'
    try {
      el.innerHTML = katex.renderToString(this.source, {
        displayMode: this.block,
        throwOnError: false,
        output: 'html',
        strict: 'ignore'
      })
    } catch {
      el.classList.add('cm-math--error')
      el.textContent = this.source
    }
    return this.block ? blockShell(el, 'wide') : el
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Mermaid diagrams.
 *
 * Mermaid is several megabytes, so it is imported on first use rather than
 * bundled into the main renderer chunk — a vault with no diagrams in it should
 * never pay for the library.
 */
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let mermaidSeq = 0

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((module) => {
      const dark = document.documentElement.dataset.theme === 'dark'
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'neutral',
        fontFamily: 'var(--font-ui)'
      })
      return module.default
    })
  }
  return mermaidReady
}

export class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source
  }

  get estimatedHeight(): number {
    return 240
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--mermaid'
    wrap.textContent = 'Rendering diagram…'

    void loadMermaid()
      .then((mermaid) => mermaid.render(`stone-mermaid-${++mermaidSeq}`, this.source))
      .then(({ svg }) => {
        wrap.innerHTML = svg
      })
      .catch((err: Error) => {
        wrap.classList.add('cm-embed--missing')
        wrap.textContent = err.message.split('\n')[0] || 'That diagram could not be drawn.'
      })

    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * An `svg` block, drawn as the picture it describes.
 *
 * The source is scrubbed before it goes anywhere near the document — see
 * `lib/svg` for what survives and why — and a block that turns out not to be a
 * drawing at all falls back to the same dashed box a broken diagram gets,
 * because a note that silently swallows a block is worse than one that says it
 * could not draw it.
 */
export class SvgWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  eq(other: SvgWidget): boolean {
    return other.source === this.source
  }

  get estimatedHeight(): number {
    return 240
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--svg'

    const drawing = sanitizeSvg(this.source)
    if (drawing) {
      wrap.appendChild(drawing)
    } else {
      wrap.classList.add('cm-embed--missing')
      wrap.textContent = 'That is not a drawing this can render.'
    }
    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * A program figure: a `memory`, `tree` or `algo` block.
 *
 * The drawing itself lives in `viz/`, so the editor, the print window and the
 * exporter all get the same picture from the same source. Only two things are
 * this widget's business.
 *
 * The first is teardown. An `algo` block owns an interval while it is playing,
 * and CodeMirror throws a widget away and builds a new one on any edit that
 * touches the fence — so a note being typed into next to a running animation
 * would otherwise leave a timer behind on every keystroke.
 *
 * The second is who owns a click. Everywhere else in this file `ignoreEvent`
 * returns false, because a picture is part of the document and clicking it
 * should put the caret near it. The transport is not part of the document: a
 * drag on the scrubber has to be a drag on the scrubber, not the start of a
 * selection across the note.
 */
export class VizWidget extends WidgetType {
  private figure: Rendered | null = null

  constructor(
    readonly kind: VizKind,
    readonly source: string,
    /** Whether this block is waiting on a request that is still running. */
    readonly pending = false
  ) {
    super()
  }

  eq(other: VizWidget): boolean {
    return other.kind === this.kind && other.source === this.source && other.pending === this.pending
  }

  get estimatedHeight(): number {
    return this.kind === 'algo' ? 260 : 200
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = `cm-embed cm-embed--viz cm-embed--viz-${this.kind}`
    this.figure = renderViz(this.kind, this.source, this.pending)
    wrap.appendChild(this.figure.element)

    // A figure that will not parse comes back as a dashed box naming the line
    // it could not read. What is wanted immediately after reading that sentence
    // is the grammar, every time, so the box carries the way to it — the
    // manual, opened at this fence's own section rather than at the top of a
    // long topic about figures in general.
    const type = this.figure.element.classList.contains('viz--broken')
      ? datatypeFor(this.kind)
      : null
    if (type) {
      const help = document.createElement('button')
      help.type = 'button'
      help.className = 'viz__help'
      help.textContent = `How a ${type.fence} block is written`
      help.addEventListener('mousedown', (event) => {
        // On mousedown, and swallowed: a click that first moved the caret into
        // the fence would replace this box with the source it is explaining.
        event.preventDefault()
        event.stopPropagation()
        useStone.getState().openDocs(type.docs.topic, type.docs.section ?? null)
      })
      this.figure.element.appendChild(help)
    }

    return blockShell(wrap, 'wide')
  }

  destroy(): void {
    this.figure?.destroy()
    this.figure = null
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target
    return target instanceof HTMLElement && target.closest('.viz__transport') !== null
  }
}

/**
 * A `stone` query block, drawn by React inside a CodeMirror widget.
 *
 * The result has to react to the vault — a task ticked elsewhere should tick
 * here — and the components that know how to render rows are already React.
 * So this mounts a root rather than building DOM by hand, and tears it down in
 * `destroy`, which CodeMirror calls when the decoration goes away. Skipping
 * that would leak a subscribed root per keystroke that rebuilt the block.
 *
 * Unmounting is deferred by a microtask because CodeMirror may call `destroy`
 * while React is mid-render, and synchronously unmounting from inside a render
 * is the one thing `createRoot` refuses to do.
 */
export class QueryWidget extends WidgetType {
  private root: Root | null = null

  constructor(readonly source: string) {
    super()
  }

  eq(other: QueryWidget): boolean {
    return other.source === this.source
  }

  get estimatedHeight(): number {
    return 180
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--query'
    this.root = createRoot(wrap)
    this.root.render(createElement(EmbeddedQuery, { source: this.source }))
    return blockShell(wrap)
  }

  destroy(): void {
    const root = this.root
    this.root = null
    if (root) queueMicrotask(() => root.unmount())
  }

  ignoreEvent(): boolean {
    return false
  }
}

export type { CellAlign }

/**
 * The inline markdown a table cell is allowed to carry.
 *
 * Cells are the one place the editor renders markdown outside CodeMirror's own
 * decorations, so this is deliberately a short list and is built as DOM nodes
 * rather than as an HTML string — cell text is note content, and it is never
 * worth handing that to innerHTML.
 */
const CELL_RE =
  /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([\s\S]*?\S)\3|`([^`]+)`|~~([\s\S]+?)~~|==([\s\S]+?)==|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]*)\]\(([^)\s]+)\)/

function renderCell(text: string, into: HTMLElement): void {
  let rest = text
  while (rest.length > 0) {
    const m = CELL_RE.exec(rest)
    if (!m) break
    if (m.index > 0) into.appendChild(document.createTextNode(rest.slice(0, m.index)))

    const el = (tag: string, cls: string, body: string): HTMLElement => {
      const node = document.createElement(tag)
      node.className = cls
      // Nested emphasis is common enough in a header cell to be worth one level.
      if (cls === 'tok-strong' || cls === 'tok-em') renderCell(body, node)
      else node.textContent = body
      return node
    }

    if (m[2] !== undefined) into.appendChild(el('strong', 'tok-strong', m[2]))
    else if (m[4] !== undefined) into.appendChild(el('em', 'tok-em', m[4]))
    else if (m[5] !== undefined) into.appendChild(el('code', 'tok-code', m[5]))
    else if (m[6] !== undefined) into.appendChild(el('del', 'tok-strike', m[6]))
    else if (m[7] !== undefined) into.appendChild(el('mark', 'tok-highlight', m[7]))
    else if (m[8] !== undefined) {
      const link = el('span', 'tok-wikilink', (m[9] ?? m[8]).trim())
      link.dataset.wikilink = m[8].trim()
      into.appendChild(link)
    } else if (m[11] !== undefined) {
      const link = el('span', 'tok-link', m[10] || m[11])
      link.dataset.url = m[11]
      into.appendChild(link)
    }

    rest = rest.slice(m.index + m[0].length)
  }
  if (rest.length > 0) into.appendChild(document.createTextNode(rest))
}

/** What each alignment is drawn as on the column's own button. */
const ALIGN_GLYPH: Record<CellAlign, string> = {
  left: '\u21e4',
  center: '\u2194',
  right: '\u21e5'
}

/**
 * A GFM table, drawn as a real table and edited in place.
 *
 * Pipes-and-dashes is unreadable at a glance, and it is the one construct where
 * the raw form is materially worse than the rendered one — so rather than
 * swapping to source the moment the caret arrives, the cells themselves are
 * editable and write back to the markdown underneath.
 *
 * Three rules make that work:
 *
 * - `ignoreEvent` returns true, so CodeMirror never steals a click and never
 *   moves its caret onto the table's lines — which is what would otherwise flip
 *   the whole block back to raw source mid-edit.
 * - The document is written on *boundaries* — blur, Tab, Enter, a structural
 *   command — never on each keystroke, because a write rebuilds this widget and
 *   would tear out the very node being typed into.
 * - A cell edit and the structural change that follows it compose into a single
 *   write, so Tab off the last cell is one undo step rather than two.
 *
 * Rows are padded to the header's width rather than left ragged: a short row is
 * a typo in the source, and collapsing the table's grid around it hides which
 * row is actually wrong.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly align: CellAlign[] = [],
    /** First line of the table, used to re-find it in a document that moved. */
    readonly fromLine = 0
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      other.align.join() === this.align.join() &&
      other.fromLine === this.fromLine
    )
  }

  get estimatedHeight(): number {
    return this.rows.length * 34 + 12
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table'
    // How `blockAwareMove` finds this table when the caret arrives by keyboard.
    wrap.dataset.line = String(this.fromLine)

    const table = document.createElement('table')
    const [head, ...body] = this.rows
    const width = Math.max(head?.length ?? 0, ...body.map((r) => r.length), this.align.length)
    const rowCount = this.rows.length

    /** Re-read the table from the document; edits move the lines under us. */
    const model = (): TableModel | null => findTable(view.state.doc, this.fromLine)

    /**
     * The alignment control on a column, in its header cell.
     *
     * One button cycling left → centre → right, because three buttons per
     * column is a toolbar and this is a table. It writes the rule row — the
     * `:---:` in the markdown — so the file says what the page shows, and it
     * composes with whatever cell is being edited into a single write, the way
     * every other structural change here does.
     */
    function alignControl(col: number, align: CellAlign): HTMLElement {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-table__align'
      button.contentEditable = 'false'
      button.textContent = ALIGN_GLYPH[align]
      button.title = `Aligned ${align === 'center' ? 'centre' : align} — click to change`
      button.setAttribute('aria-label', `Column alignment: ${align}`)

      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = model()
        if (!current) return
        const next = nextAlignment(current.align[col] ?? 'left')
        // A cell being typed into commits with the same write, so pressing this
        // mid-edit never costs the word that was half-finished.
        const editing = wrap.querySelector<HTMLElement>('[data-row]:focus')
        if (editing) apply(editing, (staged) => setAlignment(staged, col, next))
        else writeTable(view, current, setAlignment(current, col, next))
      })

      return button
    }

    const cellsInto = (row: string[], parent: HTMLElement, tag: 'th' | 'td', r: number): void => {
      for (let i = 0; i < width; i++) {
        const box = document.createElement(tag)
        const align = this.align[i] ?? 'left'
        if (align !== 'left') box.style.textAlign = align

        /*
         * A header cell holds its text in a span rather than being editable
         * itself, so the alignment control can sit in the cell without being
         * inside the text. Everything that reads a cell reads `textContent`,
         * and a button living in that text would be written into the markdown
         * the next time the cell was committed.
         */
        const cell = tag === 'th' ? document.createElement('span') : box
        if (tag === 'th') {
          box.className = 'cm-table__head'
          cell.className = 'cm-table__cell cm-table__cell--head'
          box.appendChild(cell)
          box.appendChild(alignControl(i, align))
        } else {
          cell.className = 'cm-table__cell'
        }

        // plaintext-only: pasted rich text would otherwise arrive as HTML that
        // has to be flattened back into one markdown cell.
        cell.contentEditable = 'plaintext-only'
        cell.dataset.row = String(r)
        cell.dataset.col = String(i)

        // Live preview, at cell granularity: a cell shows `**bold**` rendered
        // until you put the caret in it, then shows the markdown you have to
        // edit. Typing against markup that re-renders itself under the caret is
        // the one thing worse than seeing asterisks.
        const source = row[i] ?? ''
        cell.dataset.source = source
        renderCell(source, cell)

        parent.appendChild(box)
      }
    }

    if (head) {
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      cellsInto(head, tr, 'th', 0)
      thead.appendChild(tr)
      table.appendChild(thead)
    }

    const tbody = document.createElement('tbody')
    body.forEach((row, i) => {
      const tr = document.createElement('tr')
      cellsInto(row, tr, 'td', i + 1)
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    wrap.appendChild(table)

    /*
     * The way back to raw markdown.
     *
     * Every other block reveals its source when the caret lands on it; a table
     * cannot, because the caret landing on it is how you edit a cell. So the
     * escape hatch is explicit, and it has to exist — alignment colons, a
     * malformed rule row and an escaped pipe are all things you can only fix in
     * the source.
     */
    const source = document.createElement('button')
    source.type = 'button'
    source.className = 'cm-table__source'
    source.textContent = 'Markdown'
    source.title = 'Edit this table as markdown. Move the caret out to come back.'
    source.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const current = model()
      if (!current) return
      const at = view.state.doc.line(current.fromLine).from
      view.dispatch({
        selection: EditorSelection.cursor(at),
        effects: revealTableSource.of(current.fromLine)
      })
      view.focus()
    })
    wrap.appendChild(source)

    const cellAt = (r: number, c: number): HTMLElement | null =>
      wrap.querySelector(`[data-row="${r}"][data-col="${c}"]`)

    /**
     * Write the cell being edited, plus an optional structural change, at once.
     *
     * `op` sees the table as it will be *after* the cell is committed, so an
     * operation never works against stale text. It may return null to decline
     * — the cell's own edit is still saved.
     */
    const apply = (
      cell: HTMLElement,
      op?: (staged: TableModel, r: number, c: number) => TableEdit | null
    ): boolean => {
      const current = model()
      if (!current) return false

      const r = Number(cell.dataset.row)
      const c = Number(cell.dataset.col)

      let edit = setCell(current, r, c, cell.textContent ?? '')
      if (op) edit = op(asModel(current, edit), r, c) ?? edit

      return writeTable(view, current, edit)
    }

    /** Move to another cell, saving the one being left. */
    const moveTo = (cell: HTMLElement, r: number, c: number): void => {
      if (r < 0 || r >= rowCount || c < 0 || c >= width) return
      if (apply(cell)) {
        // The widget is being rebuilt, so the target travels with the write.
        setPendingFocus(this.fromLine, r, c)
        return
      }
      focusCell(cellAt(r, c))
    }

    /** Swap a cell back to its rendered form, for when nothing was written. */
    const rerender = (cell: HTMLElement): void => {
      cell.textContent = ''
      renderCell(cell.dataset.source ?? '', cell)
    }

    wrap.addEventListener('focusin', (event) => {
      const cell = event.target as HTMLElement
      if (!cell?.dataset?.row) return
      cell.textContent = cell.dataset.source ?? ''
    })

    wrap.addEventListener('focusout', (event) => {
      const cell = event.target as HTMLElement
      if (!cell?.dataset?.row) return
      // Leaving the table, or moving to another cell: either way what was typed
      // belongs in the document now. If it wrote, this widget is replaced; if
      // not, the cell goes back to showing rendered markup.
      if (!apply(cell)) rerender(cell)
    })

    wrap.addEventListener('keydown', (event) => {
      const cell = event.target as HTMLElement
      if (!cell?.dataset?.row) return
      const r = Number(cell.dataset.row)
      const c = Number(cell.dataset.col)

      if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) {
          if (c > 0) moveTo(cell, r, c - 1)
          else if (r > 0) moveTo(cell, r - 1, width - 1)
        } else if (c < width - 1) {
          moveTo(cell, r, c + 1)
        } else if (r < rowCount - 1) {
          moveTo(cell, r + 1, 0)
        } else {
          // Tab off the last cell grows the table, the way a spreadsheet does.
          apply(cell, (staged) => insertRow(staged, staged.rows.length))
        }
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        apply(cell, (staged) => insertRow(staged, r + 1))
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        apply(cell)
        view.focus()
        return
      }

      /*
       * Plain Up and Down.
       *
       * A cell is a one-line contenteditable, so the browser's own answer to a
       * vertical arrow inside one is to do nothing at all — which is how a
       * table became a place the caret could get into and never get out of.
       * Within the table they step between rows; off either end they hand the
       * caret back to the document on the line past the table.
       */
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        const dir = event.key === 'ArrowDown' ? 1 : -1
        const next = r + dir
        if (next >= 0 && next < rowCount) {
          moveTo(cell, next, c)
          return
        }
        const current = model()
        if (!current) return
        const beyond = dir > 0 ? current.toLine + 1 : current.fromLine - 1
        apply(cell)
        const doc = view.state.doc
        const line = Math.min(Math.max(beyond, 1), doc.lines)
        view.dispatch({
          selection: EditorSelection.cursor(doc.line(line).from),
          scrollIntoView: true
        })
        view.focus()
        return
      }

      // ⌥⌘ arrows add structure relative to the cell you are in; ⌥⌘⌫ removes it.
      if (!event.altKey || !(event.metaKey || event.ctrlKey)) return

      const ops: Record<string, (staged: TableModel) => TableEdit | null> = {
        ArrowDown: (staged) => insertRow(staged, r + 1),
        ArrowUp: (staged) => insertRow(staged, r),
        ArrowRight: (staged) => insertColumn(staged, c + 1),
        ArrowLeft: (staged) => insertColumn(staged, c),
        Backspace: (staged) => (event.shiftKey ? deleteColumn(staged, c) : deleteRow(staged, r))
      }

      const op = ops[event.key]
      if (!op) return
      event.preventDefault()
      apply(cell, op)
    })

    // A table that was just rewritten puts the caret back where the user was:
    // the DOM node they were typing into no longer exists.
    const restore = takePendingFocus(this.fromLine)
    if (restore) queueMicrotask(() => focusCell(cellAt(restore.row, restore.col)))

    return blockShell(wrap, 'wide')
  }

  /**
   * True so CodeMirror leaves this widget's events alone.
   *
   * This is what makes the cells editable at all: with the default, a click is
   * treated as "put the caret here", the selection lands on the table's own
   * lines, and live preview immediately swaps the grid for raw markdown.
   */
  ignoreEvent(): boolean {
    return true
  }
}

/** Focus a cell and put the caret at the end of its text. */
export function focusCell(cell: HTMLElement | null): void {
  if (!cell) return
  cell.focus()
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * The bar across the top of a fenced code block: what language it is, and a
 * button that copies it.
 *
 * It stands in for the ```` ```python ```` line itself rather than being added
 * above it, because that line is already the block saying what it is — this
 * only draws it as a label instead of as syntax. The caret landing on the line
 * brings the backticks straight back, like every other marker here.
 */
export class CodeHeaderWidget extends WidgetType {
  constructor(
    /** The language as written, or '' for a bare fence. */
    readonly lang: string,
    /** The block's own text, for the copy button. */
    readonly code: string
  ) {
    super()
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.lang === this.lang && other.code === this.code
  }

  toDOM(): HTMLElement {
    const bar = document.createElement('span')
    bar.className = 'cm-codehead'

    const label = document.createElement('span')
    label.className = 'cm-codehead__lang'
    label.textContent = languageFor(this.lang)?.label ?? this.lang
    bar.appendChild(label)

    // Nothing to copy from an empty block, and a button that does nothing is
    // worse than no button.
    if (this.code.trim()) {
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'cm-codehead__copy'
      copy.textContent = 'Copy'
      copy.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        void navigator.clipboard.writeText(this.code).then(
          () => {
            copy.textContent = 'Copied'
            setTimeout(() => {
              if (copy.isConnected) copy.textContent = 'Copy'
            }, 1200)
          },
          () => {
            copy.textContent = 'Failed'
          }
        )
      })
      bar.appendChild(copy)
    }

    return bar
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * A table of contents, built from the note's own headings.
 *
 * Written as a ```toc fence so that it is a block in the file like every other
 * block, and so a note that has one still says so in any other editor. The list
 * is computed at render time rather than written into the document: a contents
 * list that goes stale the moment a heading is renamed is worse than none, and
 * the whole reason to have this rather than to type the list by hand.
 */
export class TocWidget extends WidgetType {
  constructor(
    readonly entries: Array<{ level: number; text: string; line: number }>,
    /** The heading levels asked for, for `eq`. */
    readonly range: string
  ) {
    super()
  }

  eq(other: TocWidget): boolean {
    return (
      other.range === this.range &&
      other.entries.length === this.entries.length &&
      other.entries.every(
        (entry, i) =>
          entry.text === this.entries[i].text &&
          entry.level === this.entries[i].level &&
          entry.line === this.entries[i].line
      )
    )
  }

  get estimatedHeight(): number {
    return Math.max(1, this.entries.length) * 24 + 32
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('nav')
    wrap.className = 'cm-toc'
    wrap.setAttribute('aria-label', 'Contents')

    const head = document.createElement('p')
    head.className = 'cm-toc__head'
    head.textContent = 'Contents'
    wrap.appendChild(head)

    if (this.entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'cm-toc__empty'
      empty.textContent = 'No headings yet.'
      wrap.appendChild(empty)
      return blockShell(wrap)
    }

    const top = Math.min(...this.entries.map((entry) => entry.level))
    const list = document.createElement('ol')
    list.className = 'cm-toc__list'

    for (const entry of this.entries) {
      const row = document.createElement('li')
      row.className = 'cm-toc__row'
      row.style.setProperty('--toc-depth', String(entry.level - top))

      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'cm-toc__link'
      link.textContent = entry.text
      link.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const doc = view.state.doc
        const line = doc.line(Math.min(Math.max(entry.line, 1), doc.lines))
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          scrollIntoView: true
        })
        view.focus()
      })

      row.appendChild(link)
      list.appendChild(row)
    }

    wrap.appendChild(list)
    return blockShell(wrap)
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * An inline footnote, drawn as its number.
 *
 * `^[like this]` puts the aside where it was written, which is what makes the
 * form worth having — and then takes it out of the sentence, which is what
 * makes it a footnote. The text comes back on hover, and in full when the caret
 * lands on the line.
 */
export class FootnoteWidget extends WidgetType {
  constructor(
    readonly number: number,
    readonly text: string
  ) {
    super()
  }

  eq(other: FootnoteWidget): boolean {
    return other.number === this.number && other.text === this.text
  }

  toDOM(): HTMLElement {
    const el = document.createElement('sup')
    el.className = 'tok-footnote tok-footnote--inline'
    el.textContent = String(this.number)
    el.title = this.text
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** The twisty on a heading that owns a collapsible section. */
export class FoldWidget extends WidgetType {
  constructor(
    readonly collapsed: boolean,
    /** What it collapses, for the tooltip: a heading's section, or an item. */
    readonly what: 'section' | 'item' = 'section'
  ) {
    super()
  }

  eq(other: FoldWidget): boolean {
    return other.collapsed === this.collapsed && other.what === this.what
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-fold ${this.collapsed ? 'cm-fold--closed' : ''}`
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '-1')
    el.title = `${this.collapsed ? 'Expand' : 'Collapse'} ${this.what === 'item' ? 'this item' : 'section'}`
    el.textContent = '▾'
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class CollapsedWidget extends WidgetType {
  constructor(readonly lines: number) {
    super()
  }

  eq(other: CollapsedWidget): boolean {
    return other.lines === this.lines
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-collapsed'
    el.textContent = `${this.lines} line${this.lines === 1 ? '' : 's'} hidden`
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export { embedKind, resolveAssetUrl }

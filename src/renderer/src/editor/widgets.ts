import { WidgetType } from '@codemirror/view'
import katex from 'katex'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TaskStatus } from '@shared/types'
import { embedKind, isExternalUrl, toProtocolUrl } from '@shared/attachments'
import { EmbeddedQuery } from '../components/EmbeddedQuery'

/**
 * The block and inline widgets live preview swaps in for raw markdown.
 *
 * Each one obeys the same contract: the document is never rewritten, the widget
 * is only shown while the caret is elsewhere, and `ignoreEvent` returns false so
 * clicks reach the editor's own DOM handlers rather than being swallowed as a
 * selection drag.
 */

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

/** Resolve a vault path or URL to something the renderer is allowed to load. */
export function resolveAssetUrl(target: string, attachmentsFolder: string): string {
  const clean = target.trim()
  if (isExternalUrl(clean)) return clean
  // A bare filename means the attachments folder; a path means the vault root.
  const relative = clean.startsWith('/')
    ? clean.slice(1)
    : clean.includes('/')
      ? clean
      : `${attachmentsFolder}/${clean}`
  return toProtocolUrl(decodeURIComponent(relative))
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.block === this.block
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'cm-embed cm-embed--image' : 'cm-embed cm-embed--image-inline'

    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    img.draggable = false
    // A broken path should say so rather than leave a silent gap.
    img.addEventListener('error', () => {
      wrap.classList.add('cm-embed--missing')
      wrap.textContent = `Missing: ${this.alt || this.src}`
    })
    wrap.appendChild(img)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class MediaWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly kind: 'video' | 'audio' | 'pdf',
    readonly label: string
  ) {
    super()
  }

  eq(other: MediaWidget): boolean {
    return other.src === this.src && other.kind === this.kind
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = `cm-embed cm-embed--${this.kind}`

    if (this.kind === 'pdf') {
      // An <object> keeps Chromium's own PDF viewer, without a plugin.
      const object = document.createElement('object')
      object.data = this.src
      object.type = 'application/pdf'
      object.className = 'cm-embed__pdf'
      const fallback = document.createElement('p')
      fallback.textContent = this.label || 'PDF'
      object.appendChild(fallback)
      wrap.appendChild(object)
      return wrap
    }

    const media = document.createElement(this.kind)
    media.src = this.src
    media.controls = true
    media.className = 'cm-embed__media'
    wrap.appendChild(media)
    return wrap
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
    readonly load: (target: string) => Promise<{ title: string; body: string } | null>,
    readonly onOpen: (target: string) => void
  ) {
    super()
  }

  eq(other: NoteEmbedWidget): boolean {
    return other.target === this.target
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

    return wrap
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
    return el
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

    return wrap
  }

  ignoreEvent(): boolean {
    return false
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

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed cm-embed--query'
    this.root = createRoot(wrap)
    this.root.render(createElement(EmbeddedQuery, { source: this.source }))
    return wrap
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

export type CellAlign = 'left' | 'center' | 'right'

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

/**
 * A GFM table, drawn as a real table while the caret is elsewhere.
 *
 * Pipes-and-dashes is unreadable at a glance, and it is the one construct where
 * the raw form is materially worse than the rendered one. Putting the caret on
 * any row of the table brings the source straight back.
 *
 * Rows are padded to the header's width rather than left ragged: a short row is
 * a typo in the source, and collapsing the table's grid around it hides which
 * row is actually wrong.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly align: CellAlign[] = []
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      other.align.join() === this.align.join()
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table'

    const table = document.createElement('table')
    const [head, ...body] = this.rows
    const width = Math.max(head?.length ?? 0, ...body.map((r) => r.length), this.align.length)

    const cellsInto = (row: string[], parent: HTMLElement, tag: 'th' | 'td'): void => {
      for (let i = 0; i < width; i++) {
        const cell = document.createElement(tag)
        const align = this.align[i] ?? 'left'
        if (align !== 'left') cell.style.textAlign = align
        renderCell(row[i] ?? '', cell)
        parent.appendChild(cell)
      }
    }

    if (head) {
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      cellsInto(head, tr, 'th')
      thead.appendChild(tr)
      table.appendChild(thead)
    }

    const tbody = document.createElement('tbody')
    for (const row of body) {
      const tr = document.createElement('tr')
      cellsInto(row, tr, 'td')
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** The twisty on a heading that owns a collapsible section. */
export class FoldWidget extends WidgetType {
  constructor(readonly collapsed: boolean) {
    super()
  }

  eq(other: FoldWidget): boolean {
    return other.collapsed === this.collapsed
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-fold ${this.collapsed ? 'cm-fold--closed' : ''}`
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '-1')
    el.title = this.collapsed ? 'Expand section' : 'Collapse section'
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

export { embedKind }

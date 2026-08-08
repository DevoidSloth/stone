import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import {
  blockKindAt,
  clearFormatting,
  isWrapped,
  makeLink,
  makeWikilink,
  setBlockKind,
  wrapSelection,
  type BlockKind,
  type InlineMarker
} from './format'

/**
 * The formatting bar that appears over highlighted text, the way Obsidian's
 * does.
 *
 * Two details are what make it feel native rather than bolted on. It waits for
 * the pointer to come up before appearing, so it never chases the cursor
 * mid-drag; and it takes its coordinates from CodeMirror rather than from
 * `window.getSelection()`, because `drawSelection()` paints the selection
 * itself and leaves the DOM selection collapsed — measuring that would put the
 * bar in the top-left corner every time.
 */

const SVG = 'http://www.w3.org/2000/svg'

/** Same 16px grid and 1.5px stroke as the React icon family. */
function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

interface Item {
  id: string
  label: string
  /** Shown in the tooltip after the label. */
  shortcut?: string
  /** A letterform reads better than a glyph for headings and "clear". */
  text?: string
  paths?: string[]
  run: (view: EditorView) => void
  active?: (view: EditorView) => boolean
  /** Starts a new group, drawn with a hairline before it. */
  divide?: boolean
}

const inline = (marker: InlineMarker) => ({
  run: (view: EditorView) => void wrapSelection(view, marker),
  active: (view: EditorView) => isWrapped(view, marker)
})

const block = (kind: BlockKind) => ({
  run: (view: EditorView) => void setBlockKind(view, kind),
  active: (view: EditorView) => blockKindAt(view) === kind
})

const ITEMS: Item[] = [
  {
    id: 'bold',
    label: 'Bold',
    shortcut: '⌘B',
    paths: ['M5 3h4.2a2.6 2.6 0 0 1 0 5.2H5z', 'M5 8.2h4.9a2.9 2.9 0 0 1 0 5.8H5z'],
    ...inline('**')
  },
  {
    id: 'italic',
    label: 'Italic',
    shortcut: '⌘I',
    paths: ['M9.8 2.8h3.4', 'M2.8 13.2h3.4', 'M9.6 2.8 6.4 13.2'],
    ...inline('*')
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    paths: ['M11 3.4H6.6a2 2 0 0 0-1.5 3.3', 'M9 8.6a2.6 2.6 0 0 1-.4 4H4.6', 'M2.5 8h11'],
    ...inline('~~')
  },
  {
    id: 'highlight',
    label: 'Highlight',
    shortcut: '⌘⇧M',
    paths: ['M4.6 9.6 9.4 4.8l1.8 1.8-4.8 4.8H4.6z', 'M2.8 13.6h10.4'],
    ...inline('==')
  },
  {
    id: 'code',
    label: 'Inline code',
    shortcut: '⌘`',
    paths: ['m5.5 5-3 3 3 3', 'm10.5 5 3 3-3 3'],
    ...inline('`')
  },
  {
    id: 'link',
    label: 'Link',
    divide: true,
    paths: [
      'M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9',
      'M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9'
    ],
    run: (view) => void makeLink(view)
  },
  {
    id: 'wikilink',
    label: 'Link to a note',
    paths: ['M6 3.5H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2', 'M10 3.5h2a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'],
    run: (view) => void makeWikilink(view)
  },
  { id: 'h1', label: 'Heading 1', text: 'H1', divide: true, ...block('h1') },
  { id: 'h2', label: 'Heading 2', text: 'H2', ...block('h2') },
  { id: 'h3', label: 'Heading 3', text: 'H3', ...block('h3') },
  {
    id: 'quote',
    label: 'Quote',
    paths: ['M2.6 3.4v9.2', 'M5.6 5h7.8', 'M5.6 8h7.8', 'M5.6 11h4.8'],
    ...block('quote')
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    paths: ['M2.9 4.5h.01', 'M2.9 8h.01', 'M2.9 11.5h.01', 'M6 4.5h7.4', 'M6 8h7.4', 'M6 11.5h7.4'],
    ...block('bullet')
  },
  {
    id: 'task',
    label: 'Task',
    shortcut: '⌘⏎',
    paths: ['m2.4 4.9 1.6 1.6 2.9-3.1', 'm2.4 11.5 1.6 1.6 2.9-3.1', 'M9 5h4.6', 'M9 11.7h4.6'],
    ...block('task')
  },
  {
    id: 'clear',
    label: 'Clear formatting',
    text: 'Tx',
    divide: true,
    run: (view) => void clearFormatting(view)
  }
]

class Toolbar {
  private readonly dom: HTMLDivElement
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private visible = false
  /** Suppressed while the pointer is down, so it never follows a drag. */
  private dragging = false
  private dismissed = false

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement('div')
    this.dom.className = 'seltoolbar'
    this.dom.setAttribute('role', 'toolbar')
    this.dom.setAttribute('aria-label', 'Format selection')
    this.dom.hidden = true

    for (const item of ITEMS) {
      if (item.divide) {
        const rule = document.createElement('span')
        rule.className = 'seltoolbar__rule'
        this.dom.appendChild(rule)
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'seltoolbar__btn'
      if (item.text) button.classList.add('seltoolbar__btn--text')
      button.title = item.shortcut ? `${item.label}  ${item.shortcut}` : item.label
      button.setAttribute('aria-label', item.label)

      if (item.text) button.textContent = item.text
      else if (item.paths) button.appendChild(icon(item.paths))

      // Taking the selection away before the command runs would leave it with
      // nothing to act on, so the press must not move focus.
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', (event) => {
        event.preventDefault()
        item.run(this.view)
        this.sync()
      })

      this.buttons.set(item.id, button)
      this.dom.appendChild(button)
    }

    document.body.appendChild(this.dom)

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onScroll = this.onScroll.bind(this)

    this.view.dom.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('resize', this.onScroll)
  }

  private onPointerDown(): void {
    this.dragging = true
    this.dismissed = false
    this.hide()
  }

  private onPointerUp(): void {
    if (!this.dragging) return
    this.dragging = false
    this.sync()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.visible) return
    // Escape dismisses the bar without collapsing the selection, so the next
    // keystroke still acts on what is highlighted.
    this.dismissed = true
    this.hide()
  }

  private onScroll(): void {
    if (this.visible) this.schedulePosition()
  }

  /**
   * Decide whether the bar belongs on screen right now, and refresh it.
   *
   * Everything here reads state only. Geometry is deliberately left to
   * `schedulePosition`, because this runs inside the plugin's update and
   * CodeMirror throws on any layout read there.
   */
  sync(): void {
    const { state } = this.view
    const selection = state.selection.main

    if (
      this.dragging ||
      this.dismissed ||
      selection.empty ||
      !this.view.hasFocus ||
      state.readOnly
    ) {
      this.hide()
      return
    }

    // Whitespace-only selections are usually an overshoot, not an intention.
    if (!state.sliceDoc(selection.from, selection.to).trim()) {
      this.hide()
      return
    }

    for (const item of ITEMS) {
      const button = this.buttons.get(item.id)
      if (button) button.setAttribute('aria-pressed', String(item.active?.(this.view) ?? false))
    }

    this.dom.hidden = false
    this.visible = true
    this.schedulePosition()
  }

  /**
   * Position on CodeMirror's measure cycle.
   *
   * `coordsAtPos` is a layout read, and calling it from inside `update()`
   * raises "Reading the editor layout isn't allowed during an update" — which
   * CodeMirror treats as a plugin crash and responds to by tearing the plugin
   * down, so the bar disappeared for the rest of the session on the very first
   * selection. `requestMeasure` is the supported way to ask the same question.
   */
  private schedulePosition(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const selection = view.state.selection.main
        return {
          start: view.coordsAtPos(selection.from),
          end: view.coordsAtPos(selection.to),
          content: view.contentDOM.getBoundingClientRect(),
          box: this.dom.getBoundingClientRect()
        }
      },
      write: (measured) => this.place(measured)
    })
  }

  private place(measured: {
    start: { left: number; right: number; top: number; bottom: number } | null
    end: { left: number; right: number; top: number; bottom: number } | null
    content: DOMRect
    box: DOMRect
  }): void {
    const { start, end, content, box } = measured
    if (!this.visible) return
    if (!start || !end) {
      this.hide()
      return
    }

    const sameLine = Math.abs(start.top - end.top) < 2

    // One line centres over the run; a multi-line selection has no meaningful
    // midpoint, so it centres over the column instead.
    const anchorX = sameLine ? (start.left + end.right) / 2 : (content.left + content.right) / 2
    const margin = 8
    const left = Math.min(
      Math.max(anchorX - box.width / 2, margin),
      window.innerWidth - box.width - margin
    )

    let top = Math.min(start.top, end.top) - box.height - margin
    // No room above — the selection starts at the top of the window — so drop
    // below the end of it rather than covering the text being formatted.
    if (top < margin) top = Math.max(start.bottom, end.bottom) + margin
    top = Math.min(top, window.innerHeight - box.height - margin)

    this.dom.style.left = `${Math.round(left)}px`
    this.dom.style.top = `${Math.round(top)}px`
  }

  private hide(): void {
    if (!this.visible && this.dom.hidden) return
    this.dom.hidden = true
    this.visible = false
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.dismissed = false
    if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) {
      this.sync()
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('resize', this.onScroll)
    this.dom.remove()
  }
}

export function selectionToolbar(): Extension {
  return ViewPlugin.define((view) => new Toolbar(view))
}

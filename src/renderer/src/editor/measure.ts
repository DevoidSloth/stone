import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * Keeps CodeMirror's height map honest about widgets that grow after they mount.
 *
 * CodeMirror does not lay the document out itself — it records the height of
 * every line and block it has drawn, and answers every geometry question from
 * that record. `posAtCoords` picks a block by height offset; a click below the
 * recorded document height snaps to the end of the document, and one above the
 * top snaps to position 0. Vertical cursor motion is built on the same call.
 *
 * Every asynchronous widget in `widgets.ts` breaks that record. An image decodes,
 * a mermaid diagram renders, an embed's body arrives, a React query block paints
 * — each one is measured at its placeholder height and then grows, with nothing
 * telling CodeMirror to look again. From that moment the map is short: clicks
 * land below where they were aimed, and arrowing down runs off the end of a
 * document CodeMirror believes is shorter than it is.
 *
 * One ResizeObserver over the widgets in view puts the real numbers back.
 */
const GROWS = '.cm-block, .cm-embed, .cm-table, .cm-math--block, .cm-props, .cm-collapsed'

class WidgetHeights {
  private readonly observer: ResizeObserver
  /** Last height seen per widget, so an unchanged report costs nothing. */
  private readonly sizes = new Map<Element, number>()
  private frame = 0
  private stale = false

  constructor(private readonly view: EditorView) {
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const height = el.offsetHeight
        if (this.sizes.get(el) === height) continue
        this.sizes.set(el, height)
        this.stale = true
      }
      if (this.stale) this.schedule()
    })
    this.schedule()
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.schedule()
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.observer.disconnect()
  }

  /**
   * Off the current frame, deliberately. A plugin's `update` runs *before*
   * CodeMirror writes the new DOM, so querying for widgets from inside it finds
   * the previous set — and calling `requestMeasure` from inside a resize
   * callback re-enters layout in the middle of the browser's own measure pass.
   */
  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.watch()
      if (!this.stale) return
      this.stale = false
      this.view.requestMeasure()
    })
  }

  /** Follow the widgets currently drawn: observe the new, drop the gone. */
  private watch(): void {
    const live = new Set<Element>()
    for (const el of this.view.contentDOM.querySelectorAll(GROWS)) {
      live.add(el)
      if (this.sizes.has(el)) continue
      // Seeded at -1 rather than the current height: a ResizeObserver reports
      // every new target once, and that first report is what fills this in.
      this.sizes.set(el, -1)
      this.observer.observe(el)
    }
    for (const el of [...this.sizes.keys()]) {
      if (live.has(el)) continue
      this.observer.unobserve(el)
      this.sizes.delete(el)
    }
  }
}

export const widgetHeights = ViewPlugin.fromClass(WidgetHeights)

/**
 * Re-measure once the note's webfonts are in.
 *
 * Inter and Newsreader load after first paint. Until they do, every line is
 * measured in the fallback face, and the swap silently shifts the whole
 * document out from under the height map.
 */
class FontMetrics {
  private done = false

  constructor(view: EditorView) {
    void document.fonts?.ready.then(() => {
      if (this.done) return
      view.requestMeasure()
    })
  }

  destroy(): void {
    this.done = true
  }
}

export const fontMetrics = ViewPlugin.fromClass(FontMetrics)

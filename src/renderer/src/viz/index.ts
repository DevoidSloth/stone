/**
 * Program figures: the fences, and the one call that draws them.
 *
 * `memory` for what the machine is holding, `boxes` for what refers to what,
 * `tree` for the shapes that arrive as arrays, `types` for how a design is put
 * together, `hash` for the one structure whose picture has to be computed,
 * `chart` for growth — predicted or measured — and `algo` for the ones that
 * only make sense moving. They share a house style, an error box, and this
 * entry point, which is all the editor, the print window and the exporter need
 * to know about them.
 *
 * A figure that will not parse is never silently dropped. It comes back as a
 * dashed box saying which line it could not read, with the source still in it,
 * because the source is what the person wrote and losing it to a typo would be
 * the worst possible failure for something living inside their notes.
 */

import { vizKind, type VizKind } from '@shared/viz-langs'
import { html } from './svg'
import { VizError } from './source'
import { drawMemory } from './memory'
import { drawTree, type Figure } from './tree'
import { drawTypes } from './types'
import { drawHash } from './hash'
import { drawChart } from './chart'
import { algoWaiting, drawAlgo, drawAlgoStrip, drawAlgoWaiting } from './algo'

export { vizKind, type VizKind }

export interface Rendered {
  element: HTMLElement
  /** Stops anything still running. Safe to call more than once. */
  destroy: () => void
}

/** The still figures, by fence. `algo` is not here: it is the one that moves. */
function still(kind: Exclude<VizKind, 'algo'>, source: string): Figure {
  switch (kind) {
    case 'memory':
      return drawMemory(source)
    case 'boxes':
      return drawMemory(source, 'objects')
    case 'types':
      return drawTypes(source)
    case 'hash':
      return drawHash(source)
    case 'chart':
      return drawChart(source)
    case 'tree':
      return drawTree(source)
  }
}

function errorBox(kind: VizKind, source: string, err: unknown): HTMLElement {
  const message = err instanceof VizError ? err.message : (err as Error)?.message || 'That figure could not be drawn.'
  return html('div', { class: 'viz viz--broken' }, [
    html('p', { class: 'viz__error' }, [message]),
    html('pre', { class: 'viz__source' }, [html('code', {}, [`\`\`\`${kind}\n${source}\n\`\`\``])])
  ])
}

/**
 * A figure, live: the animation plays, the rest are pictures.
 *
 * `pending` is whether an `algo` block waiting on Claude is waiting on anything
 * still running — the editor knows, and the figure has to be told, or a request
 * lost to a restart goes on claiming an answer is coming.
 */
export function renderViz(kind: VizKind, source: string, pending = false): Rendered {
  try {
    if (kind === 'algo') {
      const animation = drawAlgo(source, pending)
      if (animation.caption) {
        animation.element.appendChild(html('p', { class: 'viz__caption' }, [animation.caption]))
      }
      return { element: animation.element, destroy: animation.destroy }
    }

    const figure = still(kind, source)
    const element = html('figure', { class: `viz viz--${kind}` }, [
      figure.title ? html('div', { class: 'viz__title' }, [figure.title]) : null,
      html('div', { class: 'viz__stage' }, [figure.root]),
      figure.caption ? html('figcaption', { class: 'viz__caption' }, [figure.caption]) : null
    ])
    return { element, destroy: () => {} }
  } catch (err) {
    return { element: errorBox(kind, source, err), destroy: () => {} }
  }
}

/**
 * A figure for paper.
 *
 * The same drawing, with nothing that needs a pointer: an animation becomes the
 * strip of stills described in `algo`, and the still figures come through
 * unchanged.
 */
export function renderVizStill(kind: VizKind, source: string): HTMLElement {
  try {
    if (kind !== 'algo') return renderViz(kind, source).element

    // A block still waiting on Claude has no frames to lay out as stills; it
    // prints as the placeholder, which is the honest thing for a note printed
    // before its figure arrived.
    const waiting = algoWaiting(source)
    if (waiting) return drawAlgoWaiting(waiting).element

    return drawAlgoStrip(source).element
  } catch (err) {
    return errorBox(kind, source, err)
  }
}

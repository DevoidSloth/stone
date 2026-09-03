/**
 * Program figures: the three fences, and the one call that draws them.
 *
 * `memory` for what the machine is holding, `boxes` for what refers to what,
 * `tree` for the shapes that arrive as arrays, `algo` for the ones that only
 * make sense moving. They share a house style, an error box, and this entry
 * point, which is all the editor, the print window and the exporter need to
 * know about them.
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
import { drawTree } from './tree'
import { drawAlgo, drawAlgoFilm } from './algo'

export { vizKind, type VizKind }

export interface Rendered {
  element: HTMLElement
  /** Stops anything still running. Safe to call more than once. */
  destroy: () => void
}

function errorBox(kind: VizKind, source: string, err: unknown): HTMLElement {
  const message = err instanceof VizError ? err.message : (err as Error)?.message || 'That figure could not be drawn.'
  return html('div', { class: 'viz viz--broken' }, [
    html('p', { class: 'viz__error' }, [message]),
    html('pre', { class: 'viz__source' }, [html('code', {}, [`\`\`\`${kind}\n${source}\n\`\`\``])])
  ])
}

/** A figure, live: the animation plays, the rest are pictures. */
export function renderViz(kind: VizKind, source: string): Rendered {
  try {
    if (kind === 'algo') {
      const animation = drawAlgo(source)
      if (animation.caption) {
        animation.element.appendChild(html('p', { class: 'viz__caption' }, [animation.caption]))
      }
      return { element: animation.element, destroy: animation.destroy }
    }

    const figure =
      kind === 'memory'
        ? drawMemory(source)
        : kind === 'boxes'
          ? drawMemory(source, 'objects')
          : drawTree(source)
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
 * strip of stills described in `algo`, and the two still figures come through
 * unchanged.
 */
export function renderVizStill(kind: VizKind, source: string): HTMLElement {
  try {
    if (kind !== 'algo') return renderViz(kind, source).element

    const film = drawAlgoFilm(source)
    const strip = html('div', { class: 'viz__film' })
    for (const cell of film.cells) {
      strip.appendChild(
        html('div', { class: 'viz__frame' }, [
          html('div', { class: 'viz__stage' }, [cell.svg]),
          html('p', { class: 'viz__note' }, [cell.note || `Step ${cell.step}`])
        ])
      )
    }
    return html('figure', { class: 'viz viz--algo viz--still' }, [
      film.title ? html('div', { class: 'viz__title' }, [film.title]) : null,
      strip,
      film.caption ? html('figcaption', { class: 'viz__caption' }, [film.caption]) : null
    ])
  } catch (err) {
    return errorBox(kind, source, err)
  }
}

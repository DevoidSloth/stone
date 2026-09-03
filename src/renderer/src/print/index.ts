/**
 * The print window.
 *
 * A hidden renderer whose whole job is to lay out one note and say when it has
 * stopped moving. It exists because the things that make an export look like a
 * real document — KaTeX, Mermaid, the editor's syntax colours, the app's own
 * fonts — all need a browser, and main has none. Rendering here rather than in
 * main also means the export still does not depend on which note is open: the
 * markdown arrives in the payload, not from the editor.
 *
 * The contract is strict about one thing. `ready` must not fire until every
 * diagram has drawn and `document.fonts.ready` has settled, because Chromium
 * will happily print a half-laid-out page and the result looks like a bug
 * rather than a race.
 */

import katex from 'katex'
import { markdownToHtml, escapeHtml, type Heading } from '@shared/markdown-html'
import { toProtocolUrl } from '@shared/attachments'
import { markerFor } from '@shared/print-markers'
import type { PrintPayload } from '@shared/types'
import { highlight } from './highlight'
import { sanitizeSvg } from '../lib/svg'
import { renderVizStill } from '../viz'
import { vizKind } from '@shared/viz-langs'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/newsreader/index.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import 'katex/dist/katex.min.css'
import '../styles/tokens.css'
import '../styles/viz.css'
import '../styles/print.css'

declare global {
  interface Window {
    stonePrint: {
      onRender: (fn: (payload: PrintPayload) => void) => void
      ready: (outline: Heading[]) => void
      failed: (message: string) => void
    }
  }
}

/** Headings worth listing. An h1 is usually the title repeated. */
const TOC_LEVELS = [2, 3]
/** Below this, a contents page costs more than it gives back. */
const TOC_MIN_ENTRIES = 3

function coverPage(payload: PrintPayload): string {
  const { title, icon, subtitle, author, vaultName, edited } = payload
  return `
    <section class="cover">
      <div class="cover__top">
        ${icon ? `<div class="cover__icon">${escapeHtml(icon)}</div>` : ''}
        <h1 class="cover__title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="cover__subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="cover__foot">
        <div class="cover__rule"></div>
        <p class="cover__meta">
          <span>${escapeHtml(author || vaultName)}</span>
          <span>${escapeHtml(edited)}</span>
        </p>
      </div>
    </section>
  `
}

/**
 * The contents page.
 *
 * On the first pass the page numbers are not known, so each one is drawn as a
 * fixed-width placeholder. That is not cosmetic either: the second pass must
 * paginate identically to the first, and a number that changes width could
 * reflow the line it sits on.
 */
function tocPage(headings: Heading[], pageNumbers?: Record<string, number>): string {
  const listed = headings.filter((h) => TOC_LEVELS.includes(h.level))
  if (listed.length < TOC_MIN_ENTRIES) return ''

  const rows = listed
    .map((h) => {
      const page = pageNumbers?.[h.id]
      const number =
        pageNumbers === undefined
          ? '<span class="toc__page toc__page--pending">00</span>'
          : page
            ? `<span class="toc__page">${page}</span>`
            : '<span class="toc__page"></span>'
      return `<li class="toc__row toc__row--h${h.level}">
        <a class="toc__link" href="#${h.id}"><span class="toc__text">${escapeHtml(h.text)}</span></a>
        <span class="toc__dots" aria-hidden="true"></span>
        ${number}
      </li>`
    })
    .join('')

  return `
    <section class="toc">
      <h2 class="toc__head">Contents</h2>
      <ol class="toc__list">${rows}</ol>
    </section>
  `
}

/** Math, in place. A failure prints the source rather than vanishing. */
function renderMath(root: HTMLElement): void {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('.md-math'))) {
    const tex = node.dataset.tex ?? node.textContent ?? ''
    try {
      node.innerHTML = katex.renderToString(tex, {
        displayMode: node.classList.contains('md-math--block'),
        throwOnError: false,
        output: 'html',
        strict: 'ignore'
      })
    } catch {
      node.classList.add('md-math--error')
      node.textContent = tex
    }
  }
}

/**
 * Embedded PDF pages, drawn into the page itself.
 *
 * An `<object>` or an `<iframe>` would show the document on screen and print as
 * an empty rectangle — Chromium does not paint a plugin viewer into a captured
 * PDF. Drawing the page with pdf.js and swapping in the resulting bitmap is the
 * only version of this that survives the export, which is the whole point of
 * embedding it in a note you are going to print.
 *
 * pdf.js is imported on first use: most notes embed no documents, and none of
 * them should pay for the library.
 */
async function renderPdfEmbeds(root: HTMLElement): Promise<void> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>('.md-pdf'))
  if (figures.length === 0) return

  const { openPdf } = await import('../lib/pdfjs')

  for (const figure of figures) {
    const src = figure.dataset.pdf ?? ''
    const wanted = Number(figure.dataset.page ?? '1') || 1
    const caption = figure.querySelector('figcaption')
    try {
      const pdf = await openPdf(src)
      const page = await pdf.getPage(Math.min(wanted, pdf.numPages))

      // Twice the layout width, so the page is still sharp at print resolution
      // rather than at the 96dpi the window happens to be laid out in.
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (PDF_PRINT_WIDTH * 2) / base.width })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d context')
      // `intent: 'print'` is not cosmetic here. On any other intent pdf.js
      // paces its render with `requestAnimationFrame`, and this window is never
      // shown — so no frame is ever produced, the promise never settles, and
      // the export waits out its whole timeout. Printing is also what this is.
      await page.render({ canvasContext: context, viewport, canvas, intent: 'print' }).promise

      const img = document.createElement('img')
      img.src = canvas.toDataURL('image/png')
      img.alt = caption?.textContent ?? 'PDF page'
      figure.insertBefore(img, figure.firstChild)
      figure.classList.add('md-pdf--drawn')
    } catch (err) {
      // A document that will not draw still has a name in its caption, which is
      // more use to the reader than a blank box where a page should be.
      figure.classList.add('md-pdf--failed')
      void err
    }
  }
}

/** The width an embedded page is laid out at, in CSS pixels. */
const PDF_PRINT_WIDTH = 640

/**
 * Mermaid. Imported on first use — a note with no diagrams should not pay for
 * several megabytes of library, and most notes have none.
 */
async function renderDiagrams(root: HTMLElement): Promise<void> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid'))
  if (figures.length === 0) return

  const mermaid = (await import('mermaid')).default
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: 'var(--font-ui)'
  })

  let seq = 0
  for (const figure of figures) {
    const source = figure.dataset.src ?? ''
    try {
      const { svg } = await mermaid.render(`stone-print-mermaid-${++seq}`, source)
      figure.innerHTML = svg
      figure.classList.add('md-mermaid--drawn')
    } catch (err) {
      // A diagram that will not parse still has readable source. Printing the
      // source beats printing an error the reader cannot act on.
      figure.classList.add('md-mermaid--failed')
      figure.innerHTML = `<pre>${escapeHtml(source)}</pre>`
      void err
    }
  }
}

/**
 * Drawings. Scrubbed with the same allowlist the editor uses — a note being
 * printed is no more trusted than a note being read.
 */
function renderDrawings(root: HTMLElement): void {
  for (const figure of Array.from(root.querySelectorAll<HTMLElement>('.md-svg'))) {
    const drawing = sanitizeSvg(figure.dataset.src ?? '')
    if (!drawing) {
      figure.classList.add('md-svg--failed')
      continue
    }
    figure.replaceChildren(drawing)
    figure.classList.add('md-svg--drawn')
  }
}

/**
 * Program figures. Synchronous, unlike the diagrams above: these are laid out
 * from a mono advance grid rather than by a layout engine, which is what lets
 * the same source draw the same picture here as in the editor.
 *
 * An `algo` block prints as a strip of stills rather than as its first frame —
 * see `viz/algo`. Paper cannot play, and one frozen frame of a sort teaches
 * nothing.
 */
function renderProgramFigures(root: HTMLElement): void {
  for (const figure of Array.from(root.querySelectorAll<HTMLElement>('.md-viz'))) {
    const kind = vizKind(figure.dataset.kind ?? '')
    if (!kind) continue
    figure.replaceChildren(renderVizStill(kind, figure.dataset.src ?? ''))
    figure.classList.add('md-viz--drawn')
  }
}

async function render(payload: PrintPayload): Promise<void> {
  const page = document.getElementById('page')
  if (!page) throw new Error('The print page has no root.')

  const { html, headings } = markdownToHtml(payload.markdown, {
    resolveUrl: toProtocolUrl,
    attachmentsFolder: payload.attachmentsFolder,
    embeds: payload.embeds
  })

  const { options } = payload
  const toc = options.toc ? tocPage(headings, payload.pageNumbers) : ''
  page.innerHTML = [
    options.coverPage ? coverPage(payload) : '',
    toc,
    `<article class="doc">${
      options.coverPage ? '' : `<h1 class="doc__title">${escapeHtml(payload.title)}</h1>`
    }${html}</article>`
  ].join('')

  renderMath(page)
  await highlight(page)
  await renderDiagrams(page)
  renderDrawings(page)
  renderProgramFigures(page)
  await renderPdfEmbeds(page)

  // Markers the measuring pass looks for in the finished PDF.
  //
  // They are transparent and out of flow, so they cost no ink and no space and
  // cannot shift where anything lands — which matters, because the second pass
  // has to paginate identically to this one. The text is plain alphanumerics on
  // purpose: it has to survive being read back out of a PDF content stream.
  if (toc && payload.pageNumbers === undefined) {
    headings.forEach((heading, i) => {
      const node = page.querySelector(`#${CSS.escape(heading.id)}`)
      if (!node) return
      const marker = document.createElement('span')
      marker.className = 'page-marker'
      marker.textContent = markerFor(i)
      node.prepend(marker)
    })
  }

  await document.fonts.ready
  // One frame, so anything laid out in the line above has actually painted.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

  window.stonePrint.ready(headings)
}

window.stonePrint.onRender((payload) => {
  render(payload).catch((err: Error) => {
    window.stonePrint.failed(err.message)
  })
})

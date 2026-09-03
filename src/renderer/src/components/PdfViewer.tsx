import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryDoc } from '@shared/types'
import { useStone } from '../store'
import { IconChevronLeft, IconChevronRight } from '../ui/icons'
import { openPdf, enqueueRender, type PDFDocumentProxy } from '../lib/pdfjs'

/**
 * A document, rendered.
 *
 * Chromium's own PDF viewer draws pages beautifully and is completely opaque —
 * there is no way to position anything on top of a page it is scrolling, and no
 * way to drive it from the app. Drawing the pages here with pdf.js buys the
 * thumbnail rail, keyboard paging and a zoom control that belong to Stone
 * rather than to an embedded viewer. When it cannot be done, the iframe is
 * still there as a fallback.
 */

interface Props {
  doc: LibraryDoc
  url: string
}

/**
 * One page in the rail, drawn only once it is scrolled into view.
 *
 * A document can run to hundreds of pages, and rendering all of them up front
 * would cost more than reading the thing. An observer defers each until it is
 * actually on screen, and the renders are serialised through a shared queue so
 * that flinging the rail does not start two hundred decodes at once.
 */
function PageThumb({
  pdf,
  page,
  current,
  enqueue,
  onPick
}: {
  pdf: PDFDocumentProxy | null
  page: number
  current: boolean
  enqueue: (job: () => Promise<void>) => void
  onPick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    if (!pdf || drawn) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        observer.disconnect()
        enqueue(async () => {
          const target = canvas.current
          if (!target) return
          const proxy = await pdf.getPage(page)
          const base = proxy.getViewport({ scale: 1 })
          // Fit the fixed rail box; the page's own aspect decides the rest.
          const scale = (THUMB_WIDTH * (window.devicePixelRatio || 1)) / base.width
          const viewport = proxy.getViewport({ scale })
          target.width = viewport.width
          target.height = viewport.height
          const context = target.getContext('2d')
          if (!context) return
          await proxy.render({ canvasContext: context, viewport, canvas: target }).promise
          setDrawn(true)
        })
      },
      { root: el.closest('.pdfview__rail'), rootMargin: '400px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [pdf, page, drawn, enqueue])

  return (
    <button
      ref={ref}
      type="button"
      className="pdfthumb"
      aria-current={current}
      onClick={onPick}
      title={`Page ${page}`}
    >
      <span className="pdfthumb__box">
        <canvas ref={canvas} className="pdfthumb__canvas" />
      </span>
      <span className="pdfthumb__n">{page}</span>
    </button>
  )
}

const THUMB_WIDTH = 40

/** The size a page was drawn at, so the page box can be laid out around it. */
interface Rendered {
  width: number
  height: number
}

export function PdfViewer({ doc, url }: Props) {
  const toast = useStone((s) => s.toast)

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [loading, setLoading] = useState(true)
  /** Set when pages could not be rendered here; drives the fallback viewer. */
  const [failed, setFailed] = useState<string | null>(null)

  const pageCanvas = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<{ cancel: () => void } | null>(null)

  // ------------------------------------------------------------- load

  useEffect(() => {
    let alive = true
    setLoading(true)

    void (async () => {
      try {
        const next = await openPdf(url)
        if (!alive) return
        setPdf(next)
        setPageCount(next.numPages)
        setPage(1)
      } catch (err) {
        // The document must still be readable when this fails, so it falls back
        // to Chromium's own PDF viewer — no rail, but a working document rather
        // than a blank pane.
        if (alive) {
          setFailed((err as Error).message)
          toast(`Showing pages in the built-in viewer: ${(err as Error).message}`, 'error')
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, toast])

  // ----------------------------------------------------------- render

  useEffect(() => {
    if (!pdf) return
    let alive = true

    void (async () => {
      const pageProxy = await pdf.getPage(page)
      if (!alive) return

      // Render at device resolution so type stays crisp when zoomed.
      const dpr = window.devicePixelRatio || 1
      const viewport = pageProxy.getViewport({ scale: zoom * dpr })

      const canvas = pageCanvas.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height

      const context = canvas.getContext('2d')
      if (!context) return

      renderTask.current?.cancel()
      const task = pageProxy.render({ canvasContext: context, viewport, canvas })
      renderTask.current = task
      try {
        await task.promise
      } catch {
        // A cancelled render is the normal result of turning the page quickly.
        return
      }
      if (!alive) return

      setRendered({ width: viewport.width / dpr, height: viewport.height / dpr })
    })()

    return () => {
      alive = false
    }
  }, [pdf, page, zoom])

  // ------------------------------------------------------- navigation

  const go = useCallback(
    (next: number) => {
      setPage((current) => {
        const target = Math.min(Math.max(next, 1), Math.max(pageCount, 1))
        if (target !== current) scrollRef.current?.scrollTo({ top: 0 })
        return target
      })
    },
    [pageCount]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.isContentEditable)) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') go(page + 1)
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(page - 1)
      if (event.key === 'Home') go(1)
      if (event.key === 'End') go(pageCount)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, page, pageCount])

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1),
    [pageCount]
  )

  // Pages could not be drawn here, so hand the document to the viewer that can.
  const fellBack = failed !== null || (!loading && pageCount === 0)
  if (fellBack) {
    return <iframe className="docpane__frame" src={url} title={doc.name} />
  }

  return (
    <div className="pdfview">
      <div className="pdfview__bar">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <IconChevronLeft size={14} />
        </button>

        <span className="pdfview__count">
          <input
            className="field pdfview__page"
            value={page}
            aria-label="Page number"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''))
              if (n) go(n)
            }}
          />
          <span> / {pageCount || '—'}</span>
        </span>

        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
        >
          <IconChevronRight size={14} />
        </button>

        <div className="pdfview__spacer" />

        <div className="segmented pdfview__zoom">
          {[0.75, 1, 1.5, 2].map((z) => (
            <button
              key={z}
              type="button"
              className="segmented__btn"
              aria-selected={zoom === z}
              onClick={() => setZoom(z)}
            >
              {Math.round(z * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="pdfview__body">
        {/* The rail: how you flip through a document rather than scroll it. */}
        <div className="pdfview__rail">
          {pages.map((n) => (
            <PageThumb
              key={n}
              pdf={pdf}
              page={n}
              current={n === page}
              enqueue={enqueueRender}
              onPick={() => go(n)}
            />
          ))}
        </div>

        <div className="pdfview__scroll" ref={scrollRef}>
          {loading && <p className="pdfview__status">Opening…</p>}
          <div
            className="pdfview__page"
            style={rendered ? { width: rendered.width, height: rendered.height } : undefined}
          >
            <canvas
              ref={pageCanvas}
              className="pdfview__canvas"
              style={rendered ? { width: rendered.width, height: rendered.height } : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The one pdf.js in the renderer.
 *
 * Both the document pane and the editor's PDF embeds need it, and pdf.js keeps
 * its worker on module-global state — configuring it twice from two places is
 * the kind of thing that works until an import order changes. Setting it up
 * here once means every caller gets a library that is already wired.
 */

/**
 * The *legacy* build, deliberately.
 *
 * The modern build calls `Uint8Array.prototype.toHex`, a builtin too new for
 * the Chromium in Electron 34 — the failure surfaces as `n.toHex is not a
 * function` from inside the worker, which is exactly as opaque as it sounds.
 * The legacy build is the one pdf.js ships for runtimes that lack the newest
 * builtins, and it is why this import path is longer than it looks like it
 * should be. Revisit only when Electron here is new enough.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * pdf.js only ships an ES-module worker, and a packaged Stone runs from
 * `file://` — where Chromium refuses to start a module worker at all. The
 * symptom is silent: the worker loads, the handshake never completes, and
 * `getDocument` hangs forever without rejecting.
 *
 * Inlining it sidesteps that. Vite compiles the worker to a classic script and
 * hands back a `blob:` worker, which has no module-loading rules to fall foul
 * of and works identically in dev over http and in production over file.
 * Rendering stays off the main thread, which is what keeps a 300-page document
 * scrolling while pages decode.
 */
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

export { pdfjs }
export type { PDFDocumentProxy }

/**
 * Open a document from a URL.
 *
 * The bytes are fetched here rather than handed to pdf.js as a URL. Over
 * `stone-file://` the response is a stream with no content-length, and pdf.js
 * waits on range requests the scheme does not answer — it hangs rather than
 * failing. These documents are a few megabytes, so reading them once and
 * passing the buffer is both simpler and predictable.
 */
export async function fetchPdf(url: string): Promise<PDFDocumentProxy> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`the pages could not be read (${response.status})`)
  const data = new Uint8Array(await response.arrayBuffer())
  return await pdfjs.getDocument({ data }).promise
}

/**
 * The same document opened by several embeds is parsed once.
 *
 * A note that shows four pages of one report would otherwise fetch and parse
 * the whole file four times, on every re-render the editor does. Keyed by URL,
 * and holding the promise rather than the result so that concurrent openings
 * collapse into one too.
 */
const open = new Map<string, Promise<PDFDocumentProxy>>()

export function openPdf(url: string): Promise<PDFDocumentProxy> {
  const cached = open.get(url)
  if (cached) return cached
  const loading = fetchPdf(url).catch((err) => {
    // A failure must not be cached, or a document that was still being written
    // when it was first embedded stays broken for the rest of the session.
    open.delete(url)
    throw err
  })
  open.set(url, loading)
  return loading
}

/**
 * One page render at a time, across the whole renderer.
 *
 * pdf.js will accept every request at once and then contend with itself; a note
 * with a dozen embedded pages otherwise starts a dozen decodes on first paint
 * and blocks the editor while they finish.
 */
const queue: (() => Promise<void>)[] = []
let draining = false

export function enqueueRender(job: () => Promise<void>): void {
  queue.push(job)
  if (draining) return
  draining = true
  void (async () => {
    while (queue.length > 0) {
      const next = queue.shift()!
      try {
        await next()
      } catch {
        // A page that will not draw is not worth interrupting the rest.
      }
    }
    draining = false
  })()
}

/**
 * Reading text back out of a PDF, page by page.
 *
 * This is a different job from `pdf-text.ts`, which scrapes content streams so
 * the library index has something to search. That scraper cannot help here:
 * Chromium subsets the fonts it embeds and gives each subset its own encoding,
 * so a stream read literally comes back as plausible-looking nonsense. Finding
 * a specific token needs the `ToUnicode` map, and decoding those properly is
 * exactly what pdf.js already does — the same dependency, and the same legacy
 * build, the document viewer runs on.
 */

import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * pdf.js is ESM and main is CommonJS, so it arrives through a dynamic import.
 * Loaded once, and only when something actually asks to read a PDF.
 */
let pdfjs: Promise<PdfjsModule> | null = null

function library(): Promise<PdfjsModule> {
  if (!pdfjs) pdfjs = import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

/** The text on each page, in page order. */
export async function pageTexts(pdf: Buffer): Promise<string[]> {
  const { getDocument } = await library()
  // Nothing here renders, so the machinery that would need system fonts is off.
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false })

  try {
    const document: PDFDocumentProxy = await task.promise
    const pages: string[] = []
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => (item as TextItem).str ?? '').join(''))
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}

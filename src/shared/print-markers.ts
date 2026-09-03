/**
 * The tokens the print window stamps beside each heading, and the pattern main
 * looks for when reading them back out of the finished PDF.
 *
 * Kept here so the two ends cannot drift: a marker written in one shape and
 * searched for in another fails silently, and the only symptom is a contents
 * page with no page numbers on it.
 *
 * Plain uppercase letters and digits, deliberately. A marker has to survive a
 * round trip through a PDF content stream, where punctuation and spacing are at
 * the mercy of how the text was laid out.
 */

export function markerFor(index: number): string {
  return `SPMK${String(index).padStart(3, '0')}`
}

/** Matches any marker in text pulled back out of a PDF. */
export const MARKER_RE = /SPMK(\d{3})/g

/**
 * What counts as a page icon.
 *
 * An icon does not have to be a picture. A chapter number, a two-letter
 * monogram, or a symbol like § or → often says more about a page than the
 * nearest emoji does, and it stays portable: the frontmatter still holds one
 * ordinary character, so the note opens the same anywhere.
 *
 * The two kinds are drawn differently. Emoji arrive with their own colour and
 * shape and need nothing from us; typed glyphs are set in the UI face and
 * given a tile, because a bare "AB" floating beside pictured neighbours reads
 * as a page that failed to load rather than one that was styled.
 */

/**
 * Pictographs, plus the two joiners that turn ordinary characters into emoji:
 * a variation selector (❄ becomes ❄️) and the keycap mark (1 becomes 1️⃣).
 * Digits and punctuation carry the `Emoji` property themselves, so testing for
 * that instead would call every number an emoji.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\uFE0F\u20E3]/u

/** Two letters fit a monogram; three is the most that stays readable small. */
export const MAX_GLYPH_LENGTH = 3

export type PageIconKind = 'emoji' | 'glyph'

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null

/** Split into what a reader would call characters, not code points. */
export function graphemes(text: string): string[] {
  if (segmenter) return [...segmenter.segment(text)].map((s) => s.segment)
  return [...text]
}

export function pageIconKind(icon: string): PageIconKind {
  return PICTOGRAPHIC.test(icon) ? 'emoji' : 'glyph'
}

/** How many characters the glyph tile has to hold, for sizing it. */
export function pageIconLength(icon: string): number {
  return graphemes(icon).length
}

/**
 * Clean up anything typed or pasted into the icon field: one emoji, or up to
 * three other characters. Whitespace goes entirely — an icon is never spaced.
 */
export function normalizePageIcon(input: string): string | null {
  const parts = graphemes(input.replace(/\s+/g, ''))
  if (parts.length === 0) return null
  if (pageIconKind(parts[0]) === 'emoji') return parts[0]
  const glyph = parts.filter((p) => pageIconKind(p) === 'glyph').slice(0, MAX_GLYPH_LENGTH)
  return glyph.length > 0 ? glyph.join('') : parts[0]
}

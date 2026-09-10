/**
 * Coloured text and coloured highlights.
 *
 * Markdown has no colour, so this is written as the HTML every renderer already
 * understands — `<span style="color:…">` and `<mark style="background:…">`,
 * which is what Obsidian's own colour plugins write and what GitHub, pandoc and
 * this app's exporter all pass through. A note keeps reading correctly
 * everywhere; in a plain text editor it reads as a tag around a word, which is
 * the worst case and is survivable.
 *
 * Two rules make the palette work in both themes:
 *
 * - **Text colours are mid-tones.** A colour picked on white and read on near
 *   black has to clear both grounds, so nothing here is lighter than a mid-tone
 *   or darker than one.
 * - **Highlights are translucent.** A wash with alpha lands over whatever the
 *   page is, so it tints the dark theme and the light one alike — and the text
 *   on top stays the theme's own ink instead of becoming unreadable.
 *
 * The values are literal hex rather than `var(--red)` on purpose: a CSS
 * variable resolves to Stone's palette here and to nothing at all anywhere
 * else, and a colour that silently disappears in another editor is worse than
 * one that is merely approximate there.
 */

export interface Swatch {
  name: string
  label: string
  /** For `<span style="color:…">`. */
  ink: string
  /** For `<mark style="background:…">`. */
  wash: string
}

export const SWATCHES: Swatch[] = [
  { name: 'red', label: 'Red', ink: '#e05252', wash: '#e0525233' },
  { name: 'orange', label: 'Orange', ink: '#d9863c', wash: '#d9863c33' },
  { name: 'yellow', label: 'Yellow', ink: '#b08900', wash: '#f5d13b40' },
  { name: 'green', label: 'Green', ink: '#2fa36b', wash: '#2fa36b33' },
  { name: 'blue', label: 'Blue', ink: '#4a90d9', wash: '#4a90d933' },
  { name: 'purple', label: 'Purple', ink: '#9b6bd9', wash: '#9b6bd933' },
  { name: 'grey', label: 'Grey', ink: '#8a8f98', wash: '#8a8f9826' }
]

/**
 * A colour value that is safe to put back into a `style` attribute.
 *
 * Only hex — 3, 4, 6 or 8 digits. The value comes out of a note, and a note is
 * a file that can arrive from anywhere: an unchecked style attribute is an
 * injection point, and there is no colour worth being one for. Anything else
 * renders as plain text with the tag showing, which says plainly that the
 * document contains something this does not trust.
 */
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function safeColour(value: string): string | null {
  const clean = value.trim().replace(/;$/, '').trim()
  return HEX_RE.test(clean) ? clean.toLowerCase() : null
}

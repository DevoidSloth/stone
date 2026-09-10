/**
 * The drawing primitives the program figures are built from.
 *
 * Every fence — `memory`, `tree`, `types`, `algo` — ends up as one SVG, and they
 * all need the same handful of things: an element builder that does not
 * fight the SVG namespace, a way to know how wide a label will be before it is
 * drawn, and arrowheads.
 *
 * Text is measured arithmetically rather than by putting it in the document and
 * asking. That is a deliberate trade. A figure has to lay out identically in
 * three places — the editor, the print window, and an export that may run
 * before fonts have loaded — and `getBBox()` gives a different answer in each
 * of them. Every label in these figures is an identifier, a number or a type
 * name, so they are all set in the mono face, where one character is one
 * advance and the arithmetic is exact.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

type Attrs = Record<string, string | number | undefined | false>

/** An SVG element, its attributes, and its children, in one call. */
export function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> = []
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === '') continue
    node.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** As above, for the HTML around a figure — controls, captions, error boxes. */
export function html<K extends keyof HTMLElementTagNameMap>(
  name: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === '') continue
    node.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/**
 * Mono advance widths, as a fraction of the font size.
 *
 * Geist Mono — the app's code face — is a 0.6em grid, and every fallback in the
 * stack (SF Mono, Menlo, Consolas) is the same. The constant is the whole
 * reason these figures can be laid out without a browser.
 */
const ADVANCE = 0.6

/** How wide `text` will be, set in the mono face at `size` pixels. */
export function textWidth(text: string, size: number): number {
  // Codepoints, not UTF-16 units: an emoji in a label is one glyph, and the
  // mono faces set it about two advances wide.
  let units = 0
  for (const ch of text) units += ch.codePointAt(0)! > 0x2100 ? 2 : 1
  return units * size * ADVANCE
}

/** Clamp a label to `max` pixels, ending in an ellipsis if it had to be cut. */
export function ellipsize(text: string, size: number, max: number): string {
  if (textWidth(text, size) <= max) return text
  const room = Math.max(1, Math.floor(max / (size * ADVANCE)) - 1)
  return `${text.slice(0, room)}…`
}

/** Text, centred on a point, with the vertical centring browsers agree on. */
export function label(
  text: string,
  x: number,
  y: number,
  className: string,
  size: number,
  anchor: 'middle' | 'start' | 'end' = 'middle'
): SVGTextElement {
  return svg(
    'text',
    {
      x,
      y,
      class: className,
      'text-anchor': anchor,
      // `dominant-baseline: central` is the one baseline keyword Chromium and
      // the print pipeline place identically; `middle` drifts by a pixel or two
      // between them, which is visible in a grid of boxes.
      'dominant-baseline': 'central',
      'font-size': size
    },
    [text]
  )
}

let markerSeq = 0

/**
 * The `<defs>` for one figure: an arrowhead, a hollow arrowhead, and a dot.
 *
 * Marker ids are document-global, and a note can hold a dozen figures, so each
 * figure mints its own. The returned prefix is what callers put in `marker-end`.
 */
export function arrowDefs(): { defs: SVGDefsElement; arrow: string; open: string; hollow: string; dot: string } {
  const id = `viz-${++markerSeq}`
  const marker = (suffix: string, path: SVGElement, size: number, refX: number): SVGMarkerElement =>
    svg(
      'marker',
      {
        id: `${id}-${suffix}`,
        viewBox: '0 0 10 10',
        refX,
        refY: 5,
        markerWidth: size,
        markerHeight: size,
        orient: 'auto-start-reverse',
        markerUnits: 'userSpaceOnUse'
      },
      [path]
    )

  const defs = svg('defs', {}, [
    marker('arrow', svg('path', { d: 'M 0 1 L 9 5 L 0 9 z', class: 'viz-arrowhead' }), 9, 8),
    marker('open', svg('path', { d: 'M 0 1 L 9 5 L 0 9', class: 'viz-arrowhead viz-arrowhead--open' }), 9, 8),
    // UML's generalisation head: a closed triangle filled with the page rather
    // than the line, so the edge stops at its base instead of showing through
    // it. Larger than the others because it is the whole notation — a figure
    // where it reads as a solid arrowhead is saying something different.
    marker('hollow', svg('path', { d: 'M 0.6 1 L 9.4 5 L 0.6 9 z', class: 'viz-arrowhead viz-arrowhead--hollow' }), 12, 9.4),
    marker('dot', svg('circle', { cx: 5, cy: 5, r: 3.2, class: 'viz-arrowhead' }), 7, 5)
  ])

  return {
    defs,
    arrow: `url(#${id}-arrow)`,
    open: `url(#${id}-open)`,
    hollow: `url(#${id}-hollow)`,
    dot: `url(#${id}-dot)`
  }
}

/**
 * A cubic from one point to another, leaving and arriving horizontally.
 *
 * Pointer arrows in a memory diagram nearly always go left to right across a
 * gutter, and a curve that leaves the field box flat and arrives at the target
 * flat reads as a wire rather than as a line that happens to connect two
 * things. When the target is behind the source — a `prev` pointer, a cycle —
 * the control points are pushed out far enough that the curve bows clear of
 * whatever is between them instead of cutting through it.
 */
export function wire(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bow = 0
): string {
  const dx = to.x - from.x
  const back = dx < 40
  const reach = back ? Math.max(56, Math.abs(dx) * 0.5 + 48) : Math.max(28, dx * 0.5)
  const c1 = { x: from.x + reach, y: from.y + bow }
  const c2 = { x: to.x - reach, y: to.y + bow }
  return `M ${round(from.x)} ${round(from.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(to.x)} ${round(to.y)}`
}

/**
 * A wire that leaves downwards and arrives horizontally.
 *
 * The exit from an array cell is the case: a bucket table's third slot cannot
 * leave to the right without crossing the fourth, so it drops out of the bottom
 * of its own cell first and only then turns towards what it points at.
 */
export function elbow(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const drop = Math.max(22, Math.abs(to.y - from.y) * 0.5)
  const reach = Math.max(24, Math.abs(to.x - from.x) * 0.4)
  return `M ${round(from.x)} ${round(from.y)} C ${round(from.x)} ${round(from.y + drop)}, ${round(to.x - reach)} ${round(to.y)}, ${round(to.x)} ${round(to.y)}`
}

/**
 * A wire that drops, runs back underneath, and comes up into its target.
 *
 * The case is a pointer that goes backwards — the `cdr` of the last pair in a
 * cycle, a `prev` in a doubly linked list. Routed like a forward one it would
 * cut straight through the boxes between its ends and arrive at the wrong side;
 * routed under them it reads as what it is, a link back.
 */
export function underpass(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const depth = Math.max(26, Math.abs(to.x - from.x) * 0.16 + 22)
  return `M ${round(from.x)} ${round(from.y)} C ${round(from.x)} ${round(from.y + depth)}, ${round(to.x)} ${round(to.y + depth)}, ${round(to.x)} ${round(to.y)}`
}

/** Two decimals is finer than a pixel at any zoom these figures reach. */
export function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The named colours a figure may ask for.
 *
 * A fence says `#red`; what it gets is the note's own red, so a figure written
 * on a white page is still legible on a dark one. Anything not on this list is
 * ignored rather than passed through, because the alternative is a fence that
 * can paint arbitrary CSS into the document.
 */
const ACCENTS: Record<string, string> = {
  red: 'var(--red)',
  green: 'var(--green)',
  blue: 'var(--accent)',
  yellow: 'var(--yellow)',
  purple: 'var(--purple)',
  gray: 'var(--text-faint)',
  grey: 'var(--text-faint)',
  accent: 'var(--accent)'
}

/** The colour an accent name resolves to, or undefined if it names none. */
export function accentValue(accent: string | undefined): string | undefined {
  return accent ? ACCENTS[accent.toLowerCase()] : undefined
}

/** The same, as a `style` attribute, for elements built in one call. */
export function accentStyle(accent: string | undefined): string | undefined {
  const value = accentValue(accent)
  return value ? `--viz-accent: ${value}` : undefined
}

export function isAccent(name: string): boolean {
  return name.toLowerCase() in ACCENTS
}

/**
 * Drawing an `svg` fence.
 *
 * Mermaid says what a system does; it cannot say what a thing looks like. An
 * SVG block is the escape hatch for the rest — a labelled diagram of a knee, a
 * circuit, a force diagram, a floor plan — and Claude's drawing mode writes
 * into it.
 *
 * All of which means arbitrary markup ends up inside the app's own document,
 * and a note is not always something the user wrote: it can come from the web
 * clipper, from a synced folder, from a vault a friend shared. So nothing is
 * trusted. The source is parsed detached, walked, and rebuilt from a list of
 * elements and attributes that can only draw — no scripts, no foreign HTML, no
 * request that leaves the machine.
 *
 * A blocklist would be the shorter code and the wrong one: SVG grew `<script>`,
 * `<foreignObject>`, `<use href>`, `<animate>` with event attributes and
 * `javascript:` URLs at different times, and it will grow more. An allowlist is
 * only ever wrong by refusing to draw something.
 */

/** Elements that draw, define, or group. Everything else is dropped. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'marker',
  'path',
  'line',
  'polyline',
  'polygon',
  'rect',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'textpath',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'filter',
  'fegaussianblur',
  'fedropshadow',
  'feoffset',
  'feblend',
  'femerge',
  'femergenode',
  'fecolormatrix',
  'fecomposite',
  'feflood',
  'switch'
])

/**
 * Attributes that are geometry, paint or text metrics.
 *
 * Presentation attributes are listed one by one rather than waved through,
 * because the set of SVG attributes that do something other than paint is
 * exactly the set that is dangerous.
 */
const ATTRIBUTES = new Set([
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'dx',
  'dy',
  'transform',
  'gradienttransform',
  'gradientunits',
  'patterntransform',
  'patternunits',
  'patterncontentunits',
  'markerunits',
  'markerwidth',
  'markerheight',
  'refx',
  'refy',
  'orient',
  'offset',
  'spreadmethod',
  'fr',
  'fx',
  'fy',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'stddeviation',
  'in',
  'in2',
  'result',
  'mode',
  'values',
  'flood-color',
  'flood-opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'color',
  'paint-order',
  'shape-rendering',
  'vector-effect',
  'marker-start',
  'marker-mid',
  'marker-end',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'text-decoration',
  'writing-mode',
  'white-space',
  'baseline-shift',
  'startoffset',
  'overflow',
  'display',
  'visibility',
  'xml:space',
  'preserveaspectratio',
  'class',
  'id',
  'style'
])

/**
 * `url(#…)` and nothing else.
 *
 * A `fill` or a `filter` may name a gradient defined in the same block, which
 * is the whole point of `<defs>`; it may not name anything off the machine,
 * because a request for it is a pixel that tells someone the note was opened.
 */
const LOCAL_URL = /^url\(\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*\)$/

/** Only the local half of `href`: `<use href="#part">` is fine, http is not. */
function safeHref(value: string): boolean {
  return value.trim().startsWith('#')
}

/**
 * A `style` attribute with nothing in it that fetches or escapes the block.
 *
 * Inline styles are worth keeping — a drawing that sets `font-family` in one
 * place instead of on forty `<text>` elements is a smaller drawing — but they
 * are also where `url(http…)`, `expression(…)` and `@import` would go.
 */
function safeStyle(value: string): boolean {
  const lowered = value.toLowerCase()
  if (lowered.includes('@import') || lowered.includes('expression(')) return false
  if (lowered.includes('javascript:') || lowered.includes('behavior:')) return false
  for (const match of lowered.matchAll(/url\([^)]*\)/g)) {
    if (!LOCAL_URL.test(match[0].trim())) return false
  }
  return true
}

function keepAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  // Every scripting hook in SVG is an `on…` attribute, so this one line is most
  // of the job; the allowlist below is what catches the ones that are not.
  if (lower.startsWith('on')) return false
  if (lower === 'href' || lower === 'xlink:href') return safeHref(value)
  if (!ATTRIBUTES.has(lower)) return false
  if (lower === 'style') return safeStyle(value)
  // A paint attribute pointing at a gradient is the one other place a URL hides.
  if (value.includes('url(')) return LOCAL_URL.test(value.trim())
  return true
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Rebuild one element and its children, keeping only what is on the lists. */
function clean(source: Element, into: SVGElement, doc: Document): void {
  for (const child of Array.from(source.children)) {
    const name = child.localName.toLowerCase()
    if (!ELEMENTS.has(name)) continue

    const copy = doc.createElementNS(SVG_NS, child.localName)
    for (const attribute of Array.from(child.attributes)) {
      if (keepAttribute(attribute.name, attribute.value)) {
        copy.setAttribute(attribute.name, attribute.value)
      }
    }
    if (child.children.length === 0) copy.textContent = child.textContent
    else clean(child, copy, doc)
    into.appendChild(copy)
  }
}

/**
 * Parse a block of SVG source into an element safe to put in the document,
 * or null if it is not SVG at all.
 *
 * The parse happens in a document made by `DOMParser`, which is inert: it runs
 * no script and fetches nothing, so even the markup that gets dropped never
 * had a chance to do anything on the way through.
 */
export function sanitizeSvg(source: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(source.trim(), 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.localName.toLowerCase() !== 'svg') return null
  // The parser reports a failure as a document of its own rather than by
  // throwing, and that document's root is not an `svg`, so the check above has
  // already caught it — except when the source has an `<svg>` inside the error
  // report, which this second look rules out.
  if (parsed.getElementsByTagName('parsererror').length > 0) return null

  const out = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  for (const attribute of Array.from(root.attributes)) {
    // `color` on the root is dropped, and only there. It is what
    // `currentColor` resolves to, so a drawing that sets it — they often set it
    // to near-black — pins itself to one theme and disappears against the
    // other. Removing it hands the resolution back to the note's own text
    // colour. Inside the picture it is left alone: a `color` on a group is a
    // deliberate palette for that subtree, not a page assumption.
    if (attribute.name.toLowerCase() === 'color') continue
    if (keepAttribute(attribute.name, attribute.value)) {
      out.setAttribute(attribute.name, attribute.value)
    }
  }
  clean(root, out, document)
  if (out.children.length === 0) return null

  // Scale to the column rather than to whatever the drawing declared. A
  // viewBox is what makes that possible, so one is invented from the width and
  // height when the source only gave those.
  const width = out.getAttribute('width')
  const height = out.getAttribute('height')
  if (!out.getAttribute('viewBox') && width && height) {
    out.setAttribute('viewBox', `0 0 ${parseFloat(width) || 0} ${parseFloat(height) || 0}`)
  }
  out.removeAttribute('width')
  out.removeAttribute('height')
  out.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return out
}

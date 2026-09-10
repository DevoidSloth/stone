/**
 * The `types` fence: a hierarchy of classes and interfaces.
 *
 * This is the figure every design document opens with — the one the reader
 * needs before any prose about the design makes sense: which types exist, and
 * which is a subtype of which. It is a tiny picture, and drawing it is
 * nevertheless the reason people reach for a diagram tool, open it once, fight
 * a canvas, and paste a screenshot into a document that is otherwise text.
 *
 * It is not a `tree`. A tree has one root and every node has one parent, and
 * the entire point of a type hierarchy is that `Bird` is under both `Animal`
 * and `Winged` — the moment a design is worth drawing, it has stopped being a
 * tree. So the body here is a set of declarations rather than an outline, the
 * layout is layered rather than nested, and a type may name as many supertypes
 * as it has.
 *
 * The source is the declaration a person would have written anyway:
 *
 *     abstract class Animal
 *     interface Winged
 *     class Dog extends Animal
 *     class Bird extends Animal implements Winged
 *
 * Nothing in there is positioning. Which row a type lands on comes from how far
 * it is below the deepest of its supertypes, and where it sits in that row is
 * chosen to keep it under the things it inherits from — so adding a type to the
 * middle of a hierarchy rearranges the picture instead of breaking it.
 */

import { accentStyle, arrowDefs, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, items, readSource, VizError } from './source'
import type { Figure } from './tree'

export const TYPES_KEYS = ['title', 'caption'] as const

/**
 * What a node is.
 *
 * The list is Java's, because Java is where this figure is set as homework and
 * where the abstract/interface distinction carries the most weight, but nothing
 * below is Java-specific: a `trait` is an `interface` and a `struct` is a
 * `class` as far as the drawing is concerned.
 */
export type TypeKind = 'class' | 'abstract' | 'interface' | 'enum' | 'record'

const KINDS: Record<string, TypeKind> = {
  class: 'class',
  abstract: 'abstract',
  'abstract class': 'abstract',
  interface: 'interface',
  trait: 'interface',
  protocol: 'interface',
  enum: 'enum',
  record: 'record',
  struct: 'class'
}

/** How a kind names itself under the type's name. */
const KIND_LABEL: Record<TypeKind, string> = {
  class: '',
  abstract: 'abstract class',
  interface: 'interface',
  enum: 'enum',
  record: 'record'
}

interface Supertype {
  name: string
  /** Drawn dashed: a class realising an interface, rather than extending a class. */
  implement: boolean
  /** For the error message when the name is one nothing declares. */
  line: number
}

interface TypeNode {
  /** The name it is declared with, drawn on the box and used to find it. */
  name: string
  /** The line under the name — the kind, unless the source overrode it. */
  sub?: string
  kind: TypeKind
  /** Whether the kind was written down, or inferred from being referred to. */
  declared: boolean
  members: string[]
  supers: Supertype[]
  accent?: string
  highlight?: boolean
  dim?: boolean

  /** Filled in by `size`. */
  w: number
  h: number
  /** Filled in by `layout`. */
  x: number
  y: number
  layer: number
  parents: TypeNode[]
  children: TypeNode[]
}

const NAME_SIZE = 13
const KIND_SIZE = 10
const MEMBER_SIZE = 11
const PAD_X = 13
const TOP_PAD = 9
const NAME_LINE = 16
const KIND_LINE = 13
const MEMBER_LINE = 15
const MIN_W = 78
const MAX_W = 320
const GAP = 26
const LAYER_GAP = 54
const PAD = 16

// ------------------------------------------------------------------- reading

/**
 * Split a declaration into the type it declares and the types above it.
 *
 * `extends` and `implements` are the keywords Java uses and the ones anyone
 * writing this figure already has in their fingers. `<` is there for the
 * languages that have neither, and for the four-line sketch where writing
 * `class` three times is three times too many. It needs the spaces around it,
 * so a `Box < T >` in a name is never mistaken for a subtype relation.
 */
function splitSupers(text: string, line: number): { head: string; supers: Supertype[] } {
  const supers: Supertype[] = []

  // `split` with a capturing group keeps the keyword, so the parts alternate
  // list, keyword, list — which is exactly what has to be walked to know
  // whether each list was extended or implemented.
  const parts = text.split(/\s+(extends|implements)\s+/i)
  let head = parts[0]
  for (let i = 1; i < parts.length; i += 2) {
    const implement = parts[i].toLowerCase() === 'implements'
    for (const name of items(parts[i + 1] ?? '')) supers.push({ name, implement, line })
  }

  const shorthand = head.split(/\s+<\s+/)
  if (shorthand.length > 1) {
    head = shorthand[0]
    for (const name of items(shorthand.slice(1).join(' '))) supers.push({ name, implement: false, line })
  }

  return { head: head.trim(), supers }
}

/** A line that opens with a kind keyword, and so declares rather than describes. */
const DECLARES = new RegExp(`^(${Object.keys(KINDS).join('|')})\\s+\\S`, 'i')

function blank(name: string, kind: TypeKind, declared: boolean): TypeNode {
  return {
    name,
    kind,
    declared,
    members: [],
    supers: [],
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    layer: 0,
    parents: [],
    children: []
  }
}

/**
 * Read the body into types.
 *
 * A line at the left margin declares a type; anything indented under it is a
 * member of that type, taken as written — the visibility marks, the parameter
 * list and the return type are all just text, because a figure that tried to
 * parse a signature would only be a worse compiler.
 */
function read(lines: Array<{ text: string; indent: number; n: number }>): TypeNode[] {
  const byName = new Map<string, TypeNode>()
  const order: TypeNode[] = []
  let current: TypeNode | null = null
  let base = 0

  const declare = (name: string, kind: TypeKind, declared: boolean, line: number): TypeNode => {
    const existing = byName.get(name)
    if (!existing) {
      const made = blank(name, kind, declared)
      byName.set(name, made)
      order.push(made)
      return made
    }
    if (declared && existing.declared) {
      throw new VizError(`${name} is declared twice`, line)
    }
    // A type named as a supertype before it was declared keeps its place in the
    // figure and picks up the kind its own line gives it.
    if (declared) {
      existing.kind = kind
      existing.declared = true
    }
    return existing
  }

  for (const line of lines) {
    if (current && line.indent > base) {
      // Indentation is what a `tree` uses for structure, so someone will try it
      // here. It means something else — the members of the type above — and a
      // declaration indented under another would quietly become a field of it,
      // which is the one mistake this figure must not make silently.
      if (DECLARES.test(line.text)) {
        throw new VizError(
          `indenting puts ${line.text} inside ${current.name} as a member. Write it at the left margin with \`extends ${current.name}\` to put it under ${current.name}.`,
          line.n
        )
      }
      current.members.push(line.text)
      continue
    }

    const decl = /^([A-Za-z]+(?:\s+class)?)\s+(\S.*)$/.exec(line.text)
    const keyword = decl ? KINDS[decl[1].toLowerCase()] : undefined
    const rest = keyword ? decl![2] : line.text

    // Annotations come off the whole declaration before the supertypes are
    // read: they sit at the end of the line, which is where the last supertype
    // is, and a `*` left in that list would be looked up as a type name.
    const marks = annotate(rest)
    const { head, supers } = splitSupers(marks.label, line.n)
    if (!head) throw new VizError('a type needs a name', line.n)

    const node = declare(head, keyword ?? 'class', keyword !== undefined, line.n)
    node.supers.push(...supers)
    node.accent = marks.accent ?? node.accent
    node.highlight = marks.highlight || node.highlight
    node.dim = marks.dim || node.dim
    if (marks.sub) node.sub = marks.sub

    current = node
    base = line.indent
  }

  for (const node of order) {
    for (const superType of node.supers) {
      // A name used as a supertype and never declared is a class. It is the
      // whole point of the short form — `Dog < Animal` is a figure of two boxes
      // — and a typo does not vanish, it arrives as a box of its own, which is
      // the loudest way a figure can say the name was not the one you meant.
      const parent = byName.get(superType.name) ?? declare(superType.name, 'class', false, superType.line)
      if (parent === node) throw new VizError(`${node.name} cannot be its own supertype`, superType.line)
      if (!node.parents.includes(parent)) {
        node.parents.push(parent)
        parent.children.push(node)
      }
    }
  }

  return order
}

// -------------------------------------------------------------------- layout

/** The kind line a node shows, if it shows one. */
function subLine(node: TypeNode): string | undefined {
  if (node.sub !== undefined) return node.sub || undefined
  return KIND_LABEL[node.kind] || undefined
}

function size(node: TypeNode): void {
  const sub = subLine(node)
  const widths = [
    textWidth(node.name, NAME_SIZE),
    sub ? textWidth(sub, KIND_SIZE) : 0,
    ...node.members.map((member) => textWidth(member, MEMBER_SIZE))
  ]
  // Rounded up, and only here: the same arithmetic decides the box's width and
  // how much room the text inside it has, and a label exactly as wide as its
  // own box must not lose its last character to the last bit of a float.
  node.w = Math.ceil(Math.min(MAX_W, Math.max(MIN_W, Math.max(...widths) + PAD_X * 2)))
  node.h =
    TOP_PAD * 2 +
    NAME_LINE +
    (sub ? KIND_LINE : 0) +
    (node.members.length ? node.members.length * MEMBER_LINE + 8 : 0)
}

/**
 * How far below the top of the figure a type sits: one row further down than
 * the deepest of its supertypes.
 *
 * Depth is taken from the longest path rather than the shortest, so an edge
 * always points upwards and a type never sits level with something it inherits
 * from. A cycle is a real error in the source — a hierarchy with one in it does
 * not exist in any language — so it is reported rather than broken arbitrarily.
 */
function assignLayers(nodes: TypeNode[]): void {
  const state = new Map<TypeNode, 'open' | 'done'>()

  const depth = (node: TypeNode): number => {
    const seen = state.get(node)
    if (seen === 'done') return node.layer
    if (seen === 'open') throw new VizError(`${node.name} is above and below itself — the hierarchy has a cycle`)
    state.set(node, 'open')
    let layer = 0
    for (const parent of node.parents) layer = Math.max(layer, depth(parent) + 1)
    node.layer = layer
    state.set(node, 'done')
    return layer
  }

  for (const node of nodes) depth(node)
}

/**
 * Place a row so that every node sits as near as possible to where its own
 * edges want it, without any two overlapping.
 *
 * The rows are short and the constraint is one-dimensional, so this can be
 * solved rather than nudged: subtract each node's minimum offset from its
 * target and the "no overlaps" constraint becomes "non-decreasing", which is
 * isotonic regression — pool adjacent violators, and the result is the row that
 * is closest to what the edges asked for out of all the rows that are legal.
 */
function separate(row: TypeNode[], desired: number[]): void {
  if (row.length === 0) return

  const offset = [0]
  for (let i = 1; i < row.length; i++) {
    offset[i] = offset[i - 1] + row[i - 1].w / 2 + GAP + row[i].w / 2
  }

  const blocks: Array<{ sum: number; count: number; value: number }> = []
  for (let i = 0; i < row.length; i++) {
    let block = { sum: desired[i] - offset[i], count: 1, value: desired[i] - offset[i] }
    while (blocks.length && blocks[blocks.length - 1].value > block.value) {
      const prev = blocks.pop()!
      const sum = prev.sum + block.sum
      const count = prev.count + block.count
      block = { sum, count, value: sum / count }
    }
    blocks.push(block)
  }

  let at = 0
  for (const block of blocks) {
    for (let k = 0; k < block.count; k++, at++) row[at].x = block.value + offset[at]
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Rows, ordered and placed.
 *
 * Two passes, in the order they have to happen: first the order within each row
 * — sorting each row by where its neighbours in the row above (then below)
 * average out, which is what pulls a shared subtype in between its two
 * supertypes instead of leaving its edges crossing everything between them —
 * and only then the coordinates, relaxed against that fixed order.
 */
function layout(nodes: TypeNode[]): { rows: TypeNode[][]; width: number; height: number } {
  for (const node of nodes) size(node)
  assignLayers(nodes)

  const depth = Math.max(...nodes.map((node) => node.layer))
  const rows: TypeNode[][] = Array.from({ length: depth + 1 }, () => [])
  for (const node of nodes) rows[node.layer].push(node)

  for (let pass = 0; pass < 6; pass++) {
    const downwards = pass % 2 === 0
    const index = new Map<TypeNode, number>()
    const walk = downwards ? rows : [...rows].reverse()
    walk.forEach((row) => row.forEach((node, at) => index.set(node, at)))

    for (const row of walk) {
      const keys = new Map<TypeNode, number>()
      row.forEach((node, at) => {
        const near = (downwards ? node.parents : node.children).map((other) => index.get(other))
        const known = near.filter((value): value is number => value !== undefined)
        keys.set(node, known.length ? mean(known) : at)
      })
      row.sort((a, b) => keys.get(a)! - keys.get(b)!)
      row.forEach((node, at) => index.set(node, at))
    }
  }

  let y = 0
  for (const row of rows) {
    let x = 0
    for (const node of row) {
      node.x = x + node.w / 2
      node.y = y
      x += node.w + GAP
    }
    y += Math.max(...row.map((node) => node.h)) + LAYER_GAP
  }

  for (let pass = 0; pass < 8; pass++) {
    const downwards = pass % 2 === 0
    const walk = downwards ? rows.slice(1) : rows.slice(0, -1).reverse()
    for (const row of walk) {
      const desired = row.map((node) => {
        const near = downwards ? node.parents : node.children
        return near.length ? mean(near.map((other) => other.x)) : node.x
      })
      separate(row, desired)
    }
  }

  const left = Math.min(...nodes.map((node) => node.x - node.w / 2))
  for (const node of nodes) node.x -= left

  return {
    rows,
    width: Math.max(...nodes.map((node) => node.x + node.w / 2)),
    height: Math.max(...nodes.map((node) => node.y + node.h))
  }
}

// ---------------------------------------------------------------------- draw

/** Where a line from the middle of a box towards a point leaves the box. */
function border(node: TypeNode, towards: { x: number; y: number }): { x: number; y: number } {
  const cx = node.x
  const cy = node.y + node.h / 2
  const dx = towards.x - cx
  const dy = towards.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min(
    dx === 0 ? Infinity : Math.abs(node.w / 2 / dx),
    dy === 0 ? Infinity : Math.abs(node.h / 2 / dy)
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function drawNode(node: TypeNode): SVGGElement {
  const group = svg('g', {
    class: `viz-node viz-type viz-type--${node.kind}${node.highlight ? ' is-marked' : ''}${node.dim ? ' is-dim' : ''}`,
    style: accentStyle(node.accent)
  })

  group.appendChild(
    svg('rect', {
      class: `viz-node__shape${node.kind === 'interface' ? ' viz-node__shape--open' : ''}`,
      x: round(node.x - node.w / 2),
      y: round(node.y),
      width: round(node.w),
      height: round(node.h),
      rx: 6
    })
  )

  const room = node.w - PAD_X * 2
  const sub = subLine(node)
  let baseline = node.y + TOP_PAD + NAME_LINE / 2
  group.appendChild(
    label(
      ellipsize(node.name, NAME_SIZE, room),
      round(node.x),
      round(baseline),
      `viz-node__label${node.kind === 'abstract' ? ' viz-node__label--abstract' : ''}`,
      NAME_SIZE
    )
  )
  baseline += NAME_LINE / 2

  if (sub) {
    group.appendChild(
      label(ellipsize(sub, KIND_SIZE, room), round(node.x), round(baseline + KIND_LINE / 2), 'viz-node__sub', KIND_SIZE)
    )
    baseline += KIND_LINE
  }

  if (node.members.length) {
    const rule = round(baseline + TOP_PAD / 2)
    group.appendChild(
      svg('line', {
        class: 'viz-box__rule',
        x1: round(node.x - node.w / 2),
        y1: rule,
        x2: round(node.x + node.w / 2),
        y2: rule
      })
    )
    node.members.forEach((member, at) => {
      group.appendChild(
        label(
          ellipsize(member, MEMBER_SIZE, room),
          round(node.x - node.w / 2 + PAD_X),
          round(rule + 4 + MEMBER_LINE / 2 + at * MEMBER_LINE),
          'viz-type__member',
          MEMBER_SIZE,
          'start'
        )
      )
    })
  }

  return group
}

/**
 * Draw the hierarchy.
 *
 * The arrowhead is UML's: a hollow triangle, pointing at the supertype, so the
 * figure says which way the relation runs without a legend. A class realising
 * an interface gets the dashed line UML gives it — and gets it without being
 * told, since a class under an interface can only be implementing it.
 */
export function drawTypes(source: string): Figure {
  const { directives, lines } = readSource(source, TYPES_KEYS)
  if (lines.length === 0) {
    throw new VizError(
      'nothing to draw. Write one type a line: `abstract class Animal`, then `class Dog extends Animal`.'
    )
  }

  const nodes = read(lines)
  const { rows, width, height } = layout(nodes)

  const { defs, hollow } = arrowDefs()
  const edges = svg('g', { class: 'viz-edges' })
  for (const node of nodes) {
    for (const parent of node.parents) {
      const implement =
        node.supers.some((one) => one.name === parent.name && one.implement) ||
        (parent.kind === 'interface' && node.kind !== 'interface')
      const from = border(node, { x: parent.x, y: parent.y + parent.h / 2 })
      const to = border(parent, { x: node.x, y: node.y + node.h / 2 })
      edges.appendChild(
        svg('line', {
          class: `viz-edge${implement ? ' viz-edge--implements' : ''}${node.dim || parent.dim ? ' is-dim' : ''}`,
          x1: round(from.x),
          y1: round(from.y),
          x2: round(to.x),
          y2: round(to.y),
          'marker-end': hollow
        })
      )
    }
  }

  const shapes = svg('g', { class: 'viz-nodes' })
  for (const row of rows) for (const node of row) shapes.appendChild(drawNode(node))

  const title = directives.get('title')
  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${-PAD} ${-PAD} ${round(width + PAD * 2)} ${round(height + PAD * 2)}`,
      width: round(width + PAD * 2),
      height: round(height + PAD * 2),
      role: 'img',
      'aria-label': title ? `Type hierarchy: ${title}` : 'Type hierarchy'
    },
    [defs, edges, shapes]
  )

  return { root, title, caption: directives.get('caption') }
}

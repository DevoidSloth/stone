/**
 * `graph` — nodes, edges, and what it costs to cross them.
 *
 * The eighth structure on the whiteboard and the one this set was missing. A
 * `tree` is a graph that agreed to be a tree; everything from lecture on is
 * not — a road map, a dependency, a state machine, a residual network — and
 * none of the other fences can hold one, because every one of them derives its
 * layout from an order the source gives it. A graph has no such order. That is
 * the whole problem, and it is why this file is mostly a layout.
 *
 * Three of them, because "where should this node go" has three good answers and
 * they are not interchangeable:
 *
 *   spring   — the default. Repulsion between every pair, attraction along
 *              every edge, run to a standstill. Finds the shape a person would
 *              have drawn: clusters sit apart, a ring comes out round.
 *   circle   — everything on one circle, in the order written. For a small
 *              dense graph, where a spring layout is a hairball and the honest
 *              picture is "all of these touch all of those".
 *   layered  — breadth-first from `start:`, left to right. For an automaton or
 *              a DAG, where the *direction* is the content.
 *
 * The spring layout is seeded from a circle and has no randomness in it, so a
 * note redrawn tomorrow is the same picture. That matters more here than a
 * slightly better arrangement would: a figure that reshuffles itself on every
 * keystroke is unreadable while you are writing the paragraph under it.
 *
 * `algo` borrows the layout and the drawing from here to run a traversal over
 * a graph — see `graphStage` there. Everything this file exports beyond
 * `drawGraph` exists for that.
 */

import { accentStyle, arrowDefs, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, items, readSource, VizError, type Annotated, type SourceLine } from './source'
import type { Figure } from './tree'

export const GRAPH_KEYS = [
  'title',
  'caption',
  'layout',
  'start',
  'accept',
  'path',
  'directed',
  'undirected'
] as const

export interface GraphNode extends Annotated {
  /** What edges call it. The label is what is drawn, and starts out the same. */
  id: string
  x: number
  y: number
  w: number
  h: number
  /** An automaton's accepting state: a second outline inside the first. */
  accept?: boolean
  /** Where the arrow from nowhere points. */
  start?: boolean
}

export interface GraphEdge {
  from: number
  to: number
  /** Written after the colon. A string, not a number — `w` and `∞` are weights. */
  weight?: string
  directed: boolean
  accent?: string
  dim?: boolean
  highlight?: boolean
  /** How far this edge bows off the straight line, for a pair with two of them. */
  bow: number
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Whether any edge carried an arrow, which decides the whole notation. */
  directed: boolean
  byId: Map<string, number>
}

// --------------------------------------------------------------------- shape

const NODE_H = 30
/** With a second line under the label — a distance, a cost. */
const NODE_H_SUB = 38
const LABEL_SIZE = 12
const SUB_SIZE = 10
const PAD = 18

function sizeNode(node: GraphNode, reserveSub: boolean): void {
  const wide = Math.max(textWidth(node.label, LABEL_SIZE), textWidth(node.sub ?? '', SUB_SIZE))
  node.h = node.sub !== undefined || reserveSub ? NODE_H_SUB : NODE_H
  node.w = Math.max(node.h, Math.ceil(wide) + 18)
}

// ------------------------------------------------------------------ the read

/**
 * An edge, written with spaces around its arrow.
 *
 * Two patterns rather than one because a bare `-` is also a character in a
 * name: `state-1 -> state-2` is one edge between two hyphenated nodes, and the
 * only thing that says so is the whitespace. So the spaced form allows `-`, and
 * the unspaced form — for `a->b`, which is how people actually type it — does
 * not.
 */
const EDGE_SPACED = /^(.+?)\s+(<->|<-|->|--|-)\s+(.+?)(?:\s*:\s*(.+))?$/
const EDGE_TIGHT = /^([^<>-]+?)(<->|<-|->|--)([^:]+?)(?:\s*:\s*(.+))?$/

interface ReadEdge {
  from: string
  to: string
  weight?: string
  directed: boolean
}

function readEdge(text: string): ReadEdge | null {
  const match = EDGE_SPACED.exec(text) ?? EDGE_TIGHT.exec(text)
  if (!match) return null

  const [, left, arrow, right, weight] = match
  const from = left.trim()
  const to = right.trim()
  if (!from || !to) return null

  // `<-` is the same edge written backwards, which is worth allowing because
  // half of a relaxation step reads better that way.
  const flipped = arrow === '<-'
  return {
    from: flipped ? to : from,
    to: flipped ? from : to,
    weight: weight?.trim() || undefined,
    directed: arrow !== '--' && arrow !== '-'
  }
}

/**
 * The nodes and edges, from the body of a fence.
 *
 * Nodes come into existence by being mentioned. A line that is not an edge is a
 * node on its own — an isolated vertex, or somewhere to hang an annotation that
 * the edge lines have no room for.
 */
export function buildGraph(lines: SourceLine[], directives: Map<string, string>): Graph {
  const nodes: GraphNode[] = []
  const byId = new Map<string, number>()
  const edges: GraphEdge[] = []
  let sawArrow = false

  const touch = (raw: string, line: number): number => {
    const read = annotate(raw)
    if (!read.label) throw new VizError('a node with no name', line)
    const held = byId.get(read.label)
    if (held !== undefined) {
      // A declaration line for a node an edge already mentioned: the
      // annotations are the point of writing it, so they win.
      const node = nodes[held]
      if (read.sub !== undefined) node.sub = read.sub
      if (read.accent) node.accent = read.accent
      if (read.highlight) node.highlight = true
      if (read.dim) node.dim = true
      return held
    }
    const node: GraphNode = { ...read, id: read.label, x: 0, y: 0, w: 0, h: 0 }
    byId.set(node.id, nodes.length)
    nodes.push(node)
    return nodes.length - 1
  }

  for (const line of lines) {
    const edge = readEdge(line.text)
    if (!edge) {
      touch(line.text, line.n)
      continue
    }
    if (edge.directed) sawArrow = true
    // The annotations on an edge ride on its target, which is where a reader
    // looks when following it: `a -> b: 4 #red` is a red edge into b.
    const marks = annotate(edge.to)
    edges.push({
      from: touch(edge.from, line.n),
      to: touch(marks.label, line.n),
      weight: edge.weight,
      directed: edge.directed,
      accent: marks.accent,
      dim: marks.dim,
      highlight: marks.highlight,
      bow: 0
    })
  }

  if (nodes.length === 0) {
    throw new VizError('nothing to draw. Try `a -> b: 4` for an edge, or `a -- b` for one with no direction.')
  }

  // `directed:`/`undirected:` override what the arrows implied, for a graph
  // written one way and meant the other.
  const directed = directives.has('undirected') ? false : directives.has('directed') ? true : sawArrow

  for (const one of items(directives.get('accept') ?? '')) {
    const at = byId.get(one)
    if (at !== undefined) nodes[at].accept = true
  }
  for (const one of items(directives.get('start') ?? '')) {
    const at = byId.get(one)
    if (at !== undefined) nodes[at].start = true
  }

  bowApart(edges)
  return { nodes, edges, directed, byId }
}

/**
 * Push parallel edges off the straight line between their ends.
 *
 * Two nodes with an edge each way is the common case — a road, a residual
 * network — and drawn straight they are one line with two arrowheads, which
 * says something different and is usually a lie about the weights.
 */
function bowApart(edges: GraphEdge[]): void {
  const seen = new Map<string, number>()
  for (const edge of edges) {
    if (edge.from === edge.to) continue
    const key = [edge.from, edge.to].sort((a, b) => a - b).join(':')
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    if (count === 0) continue
    // ±14, ±28 … and the direction of the bow follows which way the edge runs,
    // so a pair curves apart rather than one crossing the other.
    const size = 14 * Math.ceil(count / 2) * (count % 2 === 1 ? 1 : -1)
    edge.bow = edge.from < edge.to ? size : -size
  }
}

// -------------------------------------------------------------------- layout

interface Point {
  x: number
  y: number
}

/** Nodes evenly round a circle, in the order they were written. */
function layoutCircle(graph: Graph): Point[] {
  const n = graph.nodes.length
  const radius = Math.max(60, (n * 46) / (2 * Math.PI))
  return graph.nodes.map((_, i) => ({
    // Starting at the top and going clockwise, which is how a person numbers
    // the vertices of a drawn polygon.
    x: radius * Math.sin((2 * Math.PI * i) / n),
    y: -radius * Math.cos((2 * Math.PI * i) / n)
  }))
}

/**
 * Breadth-first from the start, left to right.
 *
 * The layout an automaton wants: one column per distance from the entry state,
 * which puts the accepting states at the end and makes the direction of the
 * machine the direction of the page.
 */
function layoutLayered(graph: Graph): Point[] {
  const n = graph.nodes.length
  const near: number[][] = graph.nodes.map(() => [])
  for (const edge of graph.edges) {
    near[edge.from].push(edge.to)
    if (!graph.directed) near[edge.to].push(edge.from)
  }

  const layer = new Array<number>(n).fill(-1)
  const roots = graph.nodes.map((node, i) => (node.start ? i : -1)).filter((i) => i >= 0)
  const queue = roots.length > 0 ? [...roots] : [0]
  for (const root of queue) layer[root] = 0

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]
    for (const next of near[at]) {
      if (layer[next] !== -1) continue
      layer[next] = layer[at] + 1
      queue.push(next)
    }
  }

  // A node no walk reached still has to go somewhere: the column after the
  // deepest one, rather than on top of the origin.
  const deepest = Math.max(0, ...layer)
  for (let i = 0; i < n; i++) if (layer[i] === -1) layer[i] = deepest + 1

  const columns = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const column = columns.get(layer[i]) ?? []
    column.push(i)
    columns.set(layer[i], column)
  }

  const out = new Array<Point>(n)
  for (const [depth, column] of columns) {
    column.forEach((node, row) => {
      out[node] = { x: depth * 150, y: (row - (column.length - 1) / 2) * 90 }
    })
  }
  return out
}

/**
 * Fruchterman–Reingold: repulsion everywhere, attraction along the edges.
 *
 * Seeded from a circle rather than from random positions, and with a fixed
 * iteration count and cooling schedule, so the same source is the same picture
 * every time it is drawn — in the editor, in the print window, and in an export
 * next year. A layout that wandered would be worse than a worse layout.
 */
function layoutSpring(graph: Graph): Point[] {
  const n = graph.nodes.length
  if (n === 1) return [{ x: 0, y: 0 }]

  const points = layoutCircle(graph).map((p) => ({ x: p.x / 100, y: p.y / 100 }))
  // The ideal edge length in these unit coordinates: the classic k for a unit
  // square, which is what the forces below are balanced around.
  const k = Math.sqrt(1 / n)
  let heat = 0.11

  for (let pass = 0; pass < 320; pass++) {
    const push: Point[] = points.map(() => ({ x: 0, y: 0 }))

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = points[i].x - points[j].x
        let dy = points[i].y - points[j].y
        let d = Math.hypot(dx, dy)
        // Two nodes exactly on top of each other have no direction to separate
        // in; nudged along one axis they find one on the next pass.
        if (d < 1e-6) {
          dx = (i - j) * 1e-3
          dy = 1e-3
          d = Math.hypot(dx, dy)
        }
        const force = (k * k) / d
        push[i].x += (dx / d) * force
        push[i].y += (dy / d) * force
        push[j].x -= (dx / d) * force
        push[j].y -= (dy / d) * force
      }
    }

    for (const edge of graph.edges) {
      if (edge.from === edge.to) continue
      const dx = points[edge.from].x - points[edge.to].x
      const dy = points[edge.from].y - points[edge.to].y
      const d = Math.max(1e-6, Math.hypot(dx, dy))
      const force = (d * d) / k
      push[edge.from].x -= (dx / d) * force
      push[edge.from].y -= (dy / d) * force
      push[edge.to].x += (dx / d) * force
      push[edge.to].y += (dy / d) * force
    }

    for (let i = 0; i < n; i++) {
      const d = Math.max(1e-9, Math.hypot(push[i].x, push[i].y))
      points[i].x += (push[i].x / d) * Math.min(d, heat)
      points[i].y += (push[i].y / d) * Math.min(d, heat)
    }
    heat *= 0.982
  }

  return points.map((p) => ({ x: p.x * 100, y: p.y * 100 }))
}

/**
 * Place the nodes, then scale until none of them overlap.
 *
 * The layouts above work in arbitrary units and know nothing about how wide a
 * label is. Rather than teach each of them, the whole picture is scaled up
 * until the closest pair of nodes clears — which preserves the shape the layout
 * found, and is the one operation that cannot make it worse.
 */
export function layoutGraph(graph: Graph, style: string | undefined, reserveSub: boolean): void {
  for (const node of graph.nodes) sizeNode(node, reserveSub)

  const named = (style ?? '').trim().toLowerCase()
  const points =
    named === 'circle' || named === 'ring'
      ? layoutCircle(graph)
      : named === 'layered' || named === 'layers' || named === 'left-right'
        ? layoutLayered(graph)
        : layoutSpring(graph)

  let scale = 1
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const dx = points[i].x - points[j].x
      const dy = points[i].y - points[j].y
      const gap = Math.hypot(dx, dy)
      if (gap < 1e-6) continue
      // Half of each box plus a gutter, measured along the line between them —
      // which over-reserves for a diagonal pair and is the right way to be
      // wrong, since a weight has to fit between them too.
      const want = (graph.nodes[i].w + graph.nodes[j].w) / 2 + 34
      scale = Math.max(scale, want / gap)
    }
  }
  // A very large graph would otherwise scale itself off the page.
  scale = Math.min(scale, 6)

  graph.nodes.forEach((node, i) => {
    node.x = round(points[i].x * scale)
    node.y = round(points[i].y * scale)
  })
}

// ------------------------------------------------------------------- drawing

/** Where the line from `centre` towards `towards` leaves the node's outline. */
function edgeOf(node: GraphNode, towards: Point): Point {
  const dx = towards.x - node.x
  const dy = towards.y - node.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return { x: node.x, y: node.y }
  // The stadium is treated as the ellipse inside it. The error is a couple of
  // pixels at the corners and nobody has ever seen it; the alternative is
  // intersecting a rounded rectangle, which is a page of arithmetic.
  const rx = node.w / 2
  const ry = node.h / 2
  const t = 1 / Math.hypot(dx / rx, dy / ry)
  return { x: node.x + dx * t, y: node.y + dy * t }
}

/** The path for one edge, and the point its weight should be written at. */
function edgePath(graph: Graph, edge: GraphEdge): { d: string; at: Point } {
  const from = graph.nodes[edge.from]
  const to = graph.nodes[edge.to]

  if (edge.from === edge.to) {
    // A self-loop, up and over the top of the node. Every automaton needs one
    // and no straight line can be one.
    const x = from.x
    const y = from.y - from.h / 2
    const spread = Math.max(13, from.w / 4)
    const rise = 46
    return {
      d: `M ${round(x - spread)} ${round(y)} C ${round(x - spread * 2.4)} ${round(y - rise)}, ${round(x + spread * 2.4)} ${round(y - rise)}, ${round(x + spread)} ${round(y)}`,
      at: { x, y: y - rise * 0.72 }
    }
  }

  const a = edgeOf(from, to)
  const b = edgeOf(to, from)
  if (edge.bow === 0) {
    return { d: `M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  // The control point is pushed off the midpoint at a right angle to the line,
  // so a bowed edge leaves and arrives at the same places a straight one would.
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const len = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y))
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const cx = mx + nx * edge.bow * 2
  const cy = my + ny * edge.bow * 2
  return {
    d: `M ${round(a.x)} ${round(a.y)} Q ${round(cx)} ${round(cy)}, ${round(b.x)} ${round(b.y)}`,
    // Half way along a quadratic is half way between the midpoint and the
    // control point, not at the control point itself.
    at: { x: (mx + cx) / 2, y: (my + cy) / 2 }
  }
}

function drawNode(node: GraphNode): SVGGElement {
  const group = svg('g', {
    class: `viz-node${node.highlight ? ' is-marked' : ''}${node.dim ? ' is-dim' : ''}`,
    style: accentStyle(node.accent)
  })

  const x = round(node.x - node.w / 2)
  const y = round(node.y - node.h / 2)
  group.appendChild(
    svg('rect', { class: 'viz-node__shape', x, y, width: round(node.w), height: round(node.h), rx: round(node.h / 2) })
  )
  if (node.accept) {
    // The double outline of an accepting state, inset rather than drawn around:
    // growing the box would move the edges that end at it.
    group.appendChild(
      svg('rect', {
        class: 'viz-node__shape viz-graph__accept',
        x: round(x + 3.5),
        y: round(y + 3.5),
        width: round(node.w - 7),
        height: round(node.h - 7),
        rx: round((node.h - 7) / 2)
      })
    )
  }

  const room = node.w - 12
  const hasSub = node.sub !== undefined && node.sub !== ''
  group.appendChild(
    label(
      ellipsize(node.label, LABEL_SIZE, room),
      round(node.x),
      round(node.y - (hasSub ? 6 : 0)),
      'viz-node__label',
      LABEL_SIZE
    )
  )
  return group
}

export interface GraphFigure {
  root: SVGSVGElement
  /** One group per node, in `graph.nodes` order — for marking one, later. */
  nodes: SVGGElement[]
  /** The second line under each node, empty until something writes to it. */
  subs: SVGTextElement[]
  /** One group per edge, for lighting the one being crossed. */
  edges: SVGGElement[]
}

/**
 * The whole picture: edges under nodes, weights over both.
 *
 * Split out from `drawGraph` because `algo` draws the same graph and then
 * changes it frame by frame — see `graphStage`. Nothing here reads a directive;
 * by this point every decision has been made.
 */
export function drawGraphFigure(graph: Graph): GraphFigure {
  const { defs, arrow } = arrowDefs()
  const edgeLayer = svg('g', { class: 'viz-graph__edges' })
  const nodeLayer = svg('g', { class: 'viz-nodes' })
  const drawnEdges: SVGGElement[] = []

  for (const edge of graph.edges) {
    const { d, at } = edgePath(graph, edge)
    const group = svg('g', {
      class: `viz-graph__edge${edge.highlight ? ' is-marked' : ''}${edge.dim ? ' is-dim' : ''}`,
      style: accentStyle(edge.accent)
    })
    group.appendChild(
      svg('path', {
        class: 'viz-edge',
        d,
        'marker-end': (edge.directed || graph.directed) && edge.from !== edge.to ? arrow : undefined
      })
    )

    if (edge.weight) {
      const wide = textWidth(edge.weight, 10) + 8
      // A disc behind the number: a weight sitting on its own line is unreadable
      // where the line passes through the middle of the glyph.
      group.appendChild(
        svg('rect', {
          class: 'viz-graph__weight-bed',
          x: round(at.x - wide / 2),
          y: round(at.y - 8),
          width: round(wide),
          height: 16,
          rx: 5
        })
      )
      group.appendChild(label(edge.weight, round(at.x), round(at.y), 'viz-graph__weight', 10))
    }

    edgeLayer.appendChild(group)
    drawnEdges.push(group)
  }

  // A self-loop rises 46 above its node, and the start arrow reaches 30 to the
  // left of one, so the extents are taken from the drawing rather than from the
  // boxes alone.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of graph.nodes) {
    minX = Math.min(minX, node.x - node.w / 2 - (node.start ? 34 : 0))
    maxX = Math.max(maxX, node.x + node.w / 2)
    minY = Math.min(minY, node.y - node.h / 2)
    maxY = Math.max(maxY, node.y + node.h / 2)
  }
  for (const edge of graph.edges) {
    if (edge.from === edge.to) minY = Math.min(minY, graph.nodes[edge.from].y - graph.nodes[edge.from].h / 2 - 52)
    else if (edge.bow !== 0) {
      const { at } = edgePath(graph, edge)
      minX = Math.min(minX, at.x - 14)
      maxX = Math.max(maxX, at.x + 14)
      minY = Math.min(minY, at.y - 12)
      maxY = Math.max(maxY, at.y + 12)
    }
  }

  const drawnNodes: SVGGElement[] = []
  const subs: SVGTextElement[] = []
  for (const node of graph.nodes) {
    const group = drawNode(node)
    if (node.start) {
      // The arrow from nowhere. Drawn with the node rather than with the edges
      // because it belongs to the state, not to a transition.
      group.insertBefore(
        svg('path', {
          class: 'viz-edge',
          d: `M ${round(node.x - node.w / 2 - 30)} ${round(node.y)} L ${round(node.x - node.w / 2 - 3)} ${round(node.y)}`,
          'marker-end': arrow
        }),
        group.firstChild
      )
    }
    const sub = label(node.sub ?? '', round(node.x), round(node.y + 10), 'viz-node__sub', SUB_SIZE)
    group.appendChild(sub)
    subs.push(sub)
    nodeLayer.appendChild(group)
    drawnNodes.push(group)
  }

  const view = {
    x: minX - PAD,
    y: minY - PAD,
    w: maxX - minX + PAD * 2,
    h: maxY - minY + PAD * 2
  }
  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`,
      width: round(view.w),
      height: round(view.h),
      role: 'img'
    },
    [defs, edgeLayer, nodeLayer]
  )

  return { root, nodes: drawnNodes, subs, edges: drawnEdges }
}

/** Light the nodes on `path:`, and every edge that joins two of them in turn. */
function markPath(graph: Graph, written: string): string | null {
  const names = items(written)
  if (names.length === 0) return null

  const walk: number[] = []
  for (const name of names) {
    const at = graph.byId.get(name)
    if (at === undefined) throw new VizError(`\`path:\` names \`${name}\`, which is not a node here`)
    walk.push(at)
    graph.nodes[at].highlight = true
  }

  for (let i = 0; i + 1 < walk.length; i++) {
    const edge = graph.edges.find(
      (one) =>
        (one.from === walk[i] && one.to === walk[i + 1]) ||
        (!one.directed && one.from === walk[i + 1] && one.to === walk[i])
    )
    if (edge) edge.highlight = true
  }

  const cost = walk
    .slice(0, -1)
    .map((at, i) => graph.edges.find((one) => one.from === at && one.to === walk[i + 1])?.weight)
  const total = cost.every((one) => one !== undefined && Number.isFinite(Number(one)))
    ? cost.reduce((sum, one) => sum + Number(one), 0)
    : null
  return `${names.join(' → ')}${total === null ? '' : ` — ${total}`}`
}

export function drawGraph(source: string): Figure {
  const { directives, lines } = readSource(source, GRAPH_KEYS)
  const graph = buildGraph(lines, directives)

  const written = directives.get('path')
  const walked = written === undefined ? null : markPath(graph, written)

  layoutGraph(graph, directives.get('layout'), false)
  const figure = drawGraphFigure(graph)

  return {
    root: figure.root,
    title: directives.get('title'),
    caption: directives.get('caption') ?? walked ?? undefined
  }
}

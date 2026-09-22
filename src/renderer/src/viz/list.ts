/**
 * The `list` fence: the chain, and nothing around it.
 *
 * A `memory` block already draws a linked list — the heap lays itself out
 * along its own pointers, so a run of `Node` boxes comes out as a chain across
 * the page without anyone positioning anything. What it draws it as, though,
 * is *storage*: a heap outlined and labelled, a stack beside it, every box
 * titled `n1`, `n2` with a type in the corner and its fields named down the
 * side. All of that is the right answer to "where does this live", and all of
 * it is furniture when the question was "what is a linked list".
 *
 * So this fence draws the picture off the whiteboard instead. A node is one
 * box in two parts — the value on the left, the link on the right — the link
 * has an arrow out of it into the box after it, and the last one is struck
 * through. No stack, no heap, no boundary between them, and no name on a node
 * that the program does not have a name for.
 *
 * The source is the list, written the way it is said out loud:
 *
 *     head: 1 2 3
 *
 * Everything that makes a list worth drawing is one line on top of that:
 * `doubly:` for the back links, `circular:` for the one that goes round, and
 * `at curr 1` for the pointers walking it — which is what turns the figure
 * from a picture of the data into a picture of the algorithm over it.
 */

import { accentStyle, arrowDefs, ellipsize, label, round, svg, textWidth, underpass } from './svg'
import { annotate, flag, isNull, items, readSource, VizError } from './source'
import type { Figure } from './tree'

export const LIST_KEYS = ['title', 'caption', 'list', 'head', 'doubly', 'double', 'circular'] as const

interface ListNode {
  value: string
  /** A second, smaller line under the box — an address, an index, a note. */
  sub?: string
  accent?: string
  highlight?: boolean
  dim?: boolean
}

/** A named arrow into one node: `head`, `tail`, `prev`, `slow`, `fast`. */
interface Pointer {
  name: string
  /** As written: negative counts back from the end, and is resolved later. */
  index: number
  accent?: string
  dim?: boolean
  /** How far above the boxes it sits, so two pointers never overprint. */
  lane: number
  line?: number
}

interface Chain {
  nodes: ListNode[]
  pointers: Pointer[]

  /** Filled in by the layout. */
  y: number
  /** How far above the boxes the pointer lanes reach. */
  top: number
  /** How far below them the back links dip. */
  under: number
  lanes: number
}

const VALUE_SIZE = 12
const NAME_SIZE = 10
const SUB_SIZE = 9
const NODE_H = 32
/** The link half of a node: wide enough for a stud, narrow enough to read as a slot. */
const LINK_W = 24
const MIN_VALUE_W = 34
const GAP = 42
/** From the top of a box to the name of the pointer nearest it. */
const LANE_BASE = 27
const POINTER_H = 17
const SUB_H = 14
const ROW_GAP = 30
const NULL_W = 28
const PAD = 16
/** Room either side for a pointer name that is wider than the node under it. */
const MARGIN = 22

// ------------------------------------------------------------------- reading

/** Section words from the other fences, so the error can say where they went. */
const SECTIONS = new Set(['stack', 'heap', 'globals', 'global', 'static', 'frames', 'objects'])

/** `"to do"` is one value with a space in it, and keeps neither quote. */
function unquote(text: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(text)
  return quoted ? quoted[2] : text
}

/**
 * Read one line of values into nodes.
 *
 * Three separators, because all three are how people write a list down and
 * none of them is ambiguous here: `1 -> 2 -> 3` is the list as it is drawn,
 * `1, 2, 3` is the list as it is printed, and a plain `1 2 3` is the list as
 * it is dictated. Only the first two leave room for a node to carry an
 * annotation — `2 *` split on spaces is a value and a stray asterisk — so a
 * marked-up node is written with the arrows or the commas in.
 */
function parseNodes(text: string, line?: number): ListNode[] {
  const body = text.trim()
  if (!body) return []

  const parts = body.includes('->') ? body.split('->') : body.includes(',') ? body.split(',') : items(body)

  const nodes: ListNode[] = []
  parts.forEach((raw, at) => {
    const part = raw.trim()
    // `1 -> 2 ->` is a list of two whose author was still typing the arrow.
    if (!part) return

    const marks = annotate(part)
    const value = unquote(marks.label)

    if (isNull(value)) {
      // Every list ends in null; that is what the strike through the last link
      // says. One written in the middle is a different structure, and quietly
      // dropping it would draw a list the source did not describe.
      if (at < parts.length - 1) {
        throw new VizError('a null ends the list, so it can only be the last thing on the line', line)
      }
      return
    }
    if (!value) throw new VizError('a node needs a value', line)

    nodes.push({
      value,
      sub: marks.sub,
      accent: marks.accent,
      highlight: marks.highlight,
      dim: marks.dim
    })
  })

  return nodes
}

function newChain(nodes: ListNode[]): Chain {
  return { nodes, pointers: [], y: 0, top: 0, under: 0, lanes: 0 }
}

/** `at curr 1`, `at tail -1 #red` — a named pointer above one node. */
function parsePointer(rest: string, line?: number): Pointer {
  const marks = annotate(rest)
  const split = /^(\S+)\s+(-?\d+)$/.exec(marks.label)
  if (!split) {
    throw new VizError(
      `\`at ${rest}\` needs a name and a position, like \`at curr 1\`. \`-1\` is the last node.`,
      line
    )
  }
  return {
    name: split[1],
    index: Number(split[2]),
    accent: marks.accent,
    dim: marks.dim,
    lane: 0,
    line
  }
}

/**
 * Read the body into chains.
 *
 * One chain a line. A line that opens with a name and a colon is a chain with
 * a pointer of that name into its first node, which is what `head:` is — the
 * pointer is not a special case bolted on, it is the general `at` form written
 * where it is nearly always wanted.
 */
function parseChains(lines: Array<{ text: string; indent: number; n: number }>, chains: Chain[]): void {
  for (const line of lines) {
    if (/[{}]/.test(line.text)) {
      throw new VizError(
        'that is a `memory` box. Here a node is only its value, so the whole list is `head: 1 2 3`.',
        line.n
      )
    }

    const at = /^at\s+(\S.*)$/i.exec(line.text)
    if (at) {
      const chain = chains[chains.length - 1]
      if (!chain) throw new VizError('`at` points into a list, and there is no list above it yet', line.n)
      chain.pointers.push(parsePointer(at[1], line.n))
      continue
    }

    const named = /^([A-Za-z_$][\w$]*)\s*:\s*(.*)$/.exec(line.text)
    if (named && SECTIONS.has(named[1].toLowerCase())) {
      throw new VizError(
        `a list has no ${named[1].toLowerCase()} — it is the chain and nothing around it. Write the values as \`head: 1 2 3\`, or use a \`memory\` block for where they live.`,
        line.n
      )
    }

    const chain = newChain(parseNodes(named ? named[2] : line.text, line.n))
    if (named) chain.pointers.push({ name: named[1], index: 0, lane: 0, line: line.n })
    chains.push(chain)
  }
}

/**
 * Which node the last link goes back to, or null for a list that ends.
 *
 * `circular:` on its own is the ring — back to the front. With a number it is
 * the other shape a cycle comes in, the one a two-pointer walk is looking for:
 * a tail that rejoins the list part-way along.
 */
function circularTarget(directives: Map<string, string>): number | null {
  if (!directives.has('circular')) return null
  const raw = (directives.get('circular') ?? '').trim()
  if (raw === '' || /^(true|yes|on)$/i.test(raw)) return 0
  if (/^(false|no|off)$/i.test(raw)) return null
  const at = Number(raw)
  if (!Number.isInteger(at)) {
    throw new VizError(`\`circular: ${raw}\` needs the position the last link goes back to, like \`circular: 1\``)
  }
  return at
}

/** A position as written — negative counts back from the end — against a chain. */
function resolve(index: number, count: number, what: string, line?: number): number {
  const at = index < 0 ? count + index : index
  if (!Number.isInteger(at) || at < 0 || at >= count) {
    throw new VizError(
      count === 0
        ? `${what} points into a list with no nodes in it`
        : `${what} points at position ${index}, and the list has ${count} node${count === 1 ? '' : 's'} (0 to ${count - 1})`,
      line
    )
  }
  return at
}

// -------------------------------------------------------------------- layout

/**
 * Which lane each pointer sits in.
 *
 * A lane is only spent when it has to be: two pointers far enough apart share
 * the row nearest the boxes, and only ones whose names would collide are
 * pushed up. That keeps `prev` and `curr` side by side at the same height,
 * which is how they are drawn by hand, while `slow` and `fast` on the same
 * node still stack instead of overprinting.
 */
function assignLanes(chain: Chain, centre: (index: number) => number): number {
  const lanes: Array<Array<[number, number]>> = []
  for (const pointer of chain.pointers) {
    const half = Math.max(textWidth(pointer.name, NAME_SIZE), 20) / 2 + 7
    const cx = centre(pointer.index)
    const span: [number, number] = [cx - half, cx + half]
    let lane = 0
    while ((lanes[lane] ?? []).some(([from, to]) => span[0] < to && from < span[1])) lane++
    ;(lanes[lane] ??= []).push(span)
    pointer.lane = lane
  }
  return lanes.length
}

/**
 * How far a link that runs back underneath dips below the boxes.
 *
 * Exact rather than estimated: both ends of an `underpass` sit at the same
 * height, so its cubic reaches three quarters of the depth of its control
 * points and no more. The viewBox is grown by that much, because the one thing
 * a figure must never do is draw over the paragraph after it.
 */
function backDepth(dx: number): number {
  return Math.max(26, Math.abs(dx) * 0.16 + 22)
}

// ---------------------------------------------------------------------- draw

interface Metrics {
  /** The value half of a node — one width for every node in the figure. */
  valueW: number
  /** The prev half, on a doubly linked list; zero on a singly linked one. */
  prevW: number
  nodeW: number
  stepX: number
}

/** Where one node goes, and which of its links end in nothing. */
interface Place {
  x: number
  y: number
  /**
   * How far under the box the second line sits.
   *
   * Nought, unless the chain has links running back underneath it — those own
   * the space directly below the boxes, and a note drawn into it would have a
   * wire through the middle of it.
   */
  subDrop: number
  nullNext: boolean
  nullPrev: boolean
}

function drawNode(node: ListNode, metrics: Metrics, at: Place, doubly: boolean): SVGGElement {
  const { x, y, nullNext, nullPrev } = at
  const group = svg('g', {
    class: `viz-list__node${node.highlight ? ' is-marked' : ''}${node.dim ? ' is-dim' : ''}`,
    style: accentStyle(node.accent)
  })

  group.appendChild(
    svg('rect', {
      class: 'viz-cell__shape',
      x: round(x),
      y: round(y),
      width: round(metrics.nodeW),
      height: NODE_H,
      rx: 5
    })
  )

  const rule = (at: number): void => {
    group.appendChild(
      svg('line', { class: 'viz-box__rule', x1: round(at), y1: round(y), x2: round(at), y2: round(y + NODE_H) })
    )
  }
  if (doubly) rule(x + metrics.prevW)
  rule(x + metrics.prevW + metrics.valueW)

  group.appendChild(
    label(
      ellipsize(node.value, VALUE_SIZE, metrics.valueW - 8),
      round(x + metrics.prevW + metrics.valueW / 2),
      round(y + NODE_H / 2),
      'viz-cell__value',
      VALUE_SIZE
    )
  )

  const strike = (cx: number): void => {
    group.appendChild(
      svg('line', {
        class: 'viz-row__strike',
        x1: round(cx - LINK_W / 2 + 6),
        y1: round(y + NODE_H - 7),
        x2: round(cx + LINK_W / 2 - 6),
        y2: round(y + 7)
      })
    )
  }
  const stud = (cx: number): void => {
    group.appendChild(svg('circle', { class: 'viz-row__stud', cx: round(cx), cy: round(y + NODE_H / 2), r: 3 }))
  }

  const nextX = x + metrics.nodeW - LINK_W / 2
  if (nullNext) strike(nextX)
  else stud(nextX)

  if (doubly) {
    const prevX = x + LINK_W / 2
    if (nullPrev) strike(prevX)
    else stud(prevX)
  }

  if (node.sub) {
    group.appendChild(
      label(
        ellipsize(node.sub, SUB_SIZE, metrics.nodeW + 12),
        round(x + metrics.nodeW / 2),
        round(y + NODE_H + at.subDrop + SUB_H / 2),
        'viz-cell__index',
        SUB_SIZE
      )
    )
  }

  return group
}

/** The empty list: the pointer, and the nothing it points at. */
function drawEmpty(x: number, y: number): SVGGElement {
  const group = svg('g', { class: 'viz-list__node' })
  group.appendChild(
    svg('rect', { class: 'viz-row__nil', x: round(x), y: round(y + 3), width: NULL_W, height: NODE_H - 6, rx: 4 })
  )
  group.appendChild(
    svg('line', {
      class: 'viz-row__strike',
      x1: round(x + 5),
      y1: round(y + NODE_H - 8),
      x2: round(x + NULL_W - 5),
      y2: round(y + 8)
    })
  )
  return group
}

export function drawList(source: string): Figure {
  const { directives, lines } = readSource(source, LIST_KEYS)
  const doubly = flag(directives, 'doubly') || flag(directives, 'double')
  const circular = circularTarget(directives)

  const chains: Chain[] = []
  // The one-line forms first: they are written at the top of the block, and a
  // `head:` that has become a directive has to keep that place in the figure.
  if (directives.has('head')) {
    const chain = newChain(parseNodes(directives.get('head') ?? ''))
    chain.pointers.push({ name: 'head', index: 0, lane: 0 })
    chains.push(chain)
  }
  if (directives.has('list')) chains.push(newChain(parseNodes(directives.get('list') ?? '')))
  parseChains(lines, chains)

  if (chains.length === 0) {
    throw new VizError('nothing to draw. Write the list: `head: 1 2 3`, or `1 -> 2 -> 3` for the chain on its own.')
  }

  for (const chain of chains) {
    for (const pointer of chain.pointers) {
      // A `head:` on an empty list is the picture of an empty list, so it is
      // the one pointer allowed to point at nothing.
      if (chain.nodes.length === 0 && pointer.index === 0) continue
      pointer.index = resolve(pointer.index, chain.nodes.length, `\`${pointer.name}\``, pointer.line)
    }
  }

  const values = chains.flatMap((chain) => chain.nodes.map((node) => node.value))
  const valueW = Math.ceil(
    Math.max(MIN_VALUE_W, ...values.map((value) => textWidth(value, VALUE_SIZE) + 16))
  )
  const prevW = doubly ? LINK_W : 0
  const metrics: Metrics = {
    valueW,
    prevW,
    nodeW: prevW + valueW + LINK_W,
    stepX: prevW + valueW + LINK_W + GAP
  }

  const nodeX = (index: number): number => index * metrics.stepX
  const centre = (index: number): number => nodeX(index) + metrics.nodeW / 2

  let top = 0
  let width = 0
  for (const chain of chains) {
    chain.lanes = assignLanes(chain, (index) => (chain.nodes.length ? centre(index) : NULL_W / 2))
    // The furthest lane's name, plus half of it above its own middle.
    chain.top = chain.lanes ? LANE_BASE + (chain.lanes - 1) * POINTER_H + 7 : 0
    chain.y = top + chain.top

    const count = chain.nodes.length
    const back = circular === null || count === 0 ? null : resolve(circular, count, '`circular`')
    let under = 0
    if (doubly && count > 1) under = Math.max(under, backDepth(metrics.stepX - metrics.nodeW / 2 + LINK_W / 2))
    if (back !== null) {
      under = Math.max(under, backDepth(nodeX(count - 1) + metrics.nodeW - LINK_W / 2 - centre(back)))
      // A ring on a doubly linked list closes both ways round, so the first
      // node's prev reaches back to the last one across the same span.
      if (doubly) under = Math.max(under, backDepth(nodeX(count - 1) + metrics.nodeW / 2 - LINK_W / 2))
    }
    // An `underpass` reaches exactly three quarters of the depth of its
    // control points, both of its ends being at the same height.
    chain.under = under * 0.75 + (under > 0 ? 5 : 0)

    const subs = chain.nodes.some((node) => node.sub) ? SUB_H : 0
    top = chain.y + NODE_H + subs + chain.under + ROW_GAP
    width = Math.max(width, count ? nodeX(count - 1) + metrics.nodeW : NULL_W)
  }
  const height = Math.max(0, top - ROW_GAP)

  const { defs, arrow, open } = arrowDefs()
  const wires = svg('g', { class: 'viz-wires' })
  const shapes = svg('g', { class: 'viz-list__nodes' })
  const pointers = svg('g', { class: 'viz-list__pointers' })

  for (const chain of chains) {
    const count = chain.nodes.length
    const mid = chain.y + NODE_H / 2
    const bottom = chain.y + NODE_H
    const back = circular === null || count === 0 ? null : resolve(circular, count, '`circular`')

    chain.nodes.forEach((node, index) => {
      const x = nodeX(index)
      const last = index === count - 1
      shapes.appendChild(
        drawNode(
          node,
          metrics,
          {
            x,
            y: chain.y,
            subDrop: chain.under,
            nullNext: last && back === null,
            nullPrev: doubly && index === 0 && back === null
          },
          doubly
        )
      )

      // The link out of the next half, straight across into the side of the
      // box after it. Nothing is routed around anything: they are in a row.
      if (!last) {
        wires.appendChild(
          svg('line', {
            class: `viz-wire${node.dim ? ' is-dim' : ''}`,
            x1: round(x + metrics.nodeW - LINK_W / 2),
            y1: round(mid),
            x2: round(nodeX(index + 1) - 3),
            y2: round(mid),
            'marker-end': arrow
          })
        )
      }

      // A back link goes under the gap it spans rather than through the boxes
      // beside it — the same routing a `prev` gets in a memory diagram, and
      // the reason a doubly linked list can be drawn at all without the two
      // directions crossing.
      if (doubly && index > 0) {
        wires.appendChild(
          svg('path', {
            class: 'viz-wire',
            d: underpass(
              { x: x + LINK_W / 2, y: bottom },
              { x: nodeX(index - 1) + metrics.nodeW / 2, y: bottom }
            ),
            'marker-end': arrow
          })
        )
      }
    })

    if (back !== null) {
      const from = { x: nodeX(count - 1) + metrics.nodeW - LINK_W / 2, y: bottom }
      wires.appendChild(
        svg('path', {
          class: 'viz-wire',
          d: underpass(from, { x: centre(back), y: bottom }),
          'marker-end': arrow
        })
      )
      if (doubly) {
        wires.appendChild(
          svg('path', {
            class: 'viz-wire',
            d: underpass({ x: LINK_W / 2, y: bottom }, { x: nodeX(count - 1) + metrics.nodeW / 2, y: bottom }),
            'marker-end': arrow
          })
        )
      }
    }

    if (count === 0) shapes.appendChild(drawEmpty(0, chain.y))

    // Pointers on one node are one column: the names stack, and only the
    // lowest of them grows a stem. Two arrows into the same box would say
    // there are two boxes, and a stem drawn up past a name would strike
    // through it — `slow` and `fast` on the same node are exactly the figure
    // this fence exists to draw, so they have to stack cleanly.
    const columns = new Map<number, Pointer[]>()
    for (const pointer of chain.pointers) {
      const column = columns.get(pointer.index)
      if (column) column.push(pointer)
      else columns.set(pointer.index, [pointer])
    }

    for (const column of columns.values()) {
      const nearest = column.reduce((low, one) => (one.lane < low.lane ? one : low))
      const cx = count ? centre(nearest.index) : NULL_W / 2
      const laneY = (lane: number): number => chain.y - (LANE_BASE + lane * POINTER_H)

      const stem = svg('g', {
        class: `viz-list__pointer${nearest.dim ? ' is-dim' : ''}`,
        style: accentStyle(nearest.accent)
      })
      stem.appendChild(
        svg('path', {
          class: 'viz-pointer__stem',
          d: `M ${round(cx)} ${round(laneY(nearest.lane) + 8)} L ${round(cx)} ${round(chain.y - 2)}`,
          'marker-end': open
        })
      )
      pointers.appendChild(stem)

      for (const pointer of column) {
        const group = svg('g', {
          class: `viz-list__pointer${pointer.dim ? ' is-dim' : ''}`,
          style: accentStyle(pointer.accent)
        })
        group.appendChild(
          label(
            ellipsize(pointer.name, NAME_SIZE, metrics.nodeW + 30),
            round(cx),
            round(laneY(pointer.lane)),
            'viz-pointer__label',
            NAME_SIZE
          )
        )
        pointers.appendChild(group)
      }
    }
  }

  const title = directives.get('title')
  const view = {
    x: -PAD - MARGIN,
    y: -PAD,
    w: width + (PAD + MARGIN) * 2,
    h: height + PAD * 2
  }
  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`,
      width: round(view.w),
      height: round(view.h),
      role: 'img',
      'aria-label': title ? `Linked list: ${title}` : 'Linked list'
    },
    [defs, wires, shapes, pointers]
  )

  return { root, title, caption: directives.get('caption') }
}

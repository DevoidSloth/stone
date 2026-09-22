/**
 * The `algo` fence: an algorithm, running.
 *
 * A sort is a sequence of states, and the whole difficulty of learning one is
 * holding those states in your head at once. A still picture of an array cannot
 * show it; a paragraph describing it is the thing you were confused by. So this
 * fence takes the array and the list of moves, and plays them back.
 *
 * The moves are written the way you would say them out loud — `compare 0 1`,
 * `swap 0 1`, `mark 4 sorted` — and every one of them becomes a frame. Frames
 * are folded from the start rather than stored, so stepping backwards is exact
 * and free, and the scrubber can land anywhere.
 *
 * Two decisions are worth stating. Values carry an identity through the whole
 * run, so a swap is one value sliding past another rather than two labels
 * changing — which is the only way the picture teaches anything a table would
 * not. And nothing plays until it is asked to: a note holding six of these
 * should be as still as any other page of prose.
 */

import { accentStyle, accentValue, arrowDefs, ellipsize, html, label, round, svg, textWidth } from './svg'
import { annotate, flag, items, numeric, readSource, VizError, type SourceLine } from './source'
import { buildTree, drawTreeNode, layoutTree, type Figure, type TreeNode } from './tree'
import { buildGraph, drawGraphFigure, layoutGraph, type Graph } from './graph'

export const ALGO_KEYS = [
  'title',
  'caption',
  // A block Claude is still answering. Directives rather than a magic first
  // line, so a half-finished block is as readable in another editor as here.
  'pending',
  'prompt',
  'error',
  'array',
  'stack',
  'queue',
  'list',
  'bst',
  'heap',
  'level',
  // The one structure written as lines rather than as a value — see `prepare`,
  // where the `---` rule stops being decoration for a graph and starts being
  // the split between the picture and the run over it.
  'graph',
  'layout',
  'start',
  'accept',
  'directed',
  'undirected',
  'speed',
  'autoplay',
  'loop',
  // The run, frozen. A loop invariant is not an animation — it is three
  // pictures, and the argument is what stayed true across them.
  'stills'
] as const

/** How a mark reads. Anything unlisted is simply "of note". */
const MARK_ACCENT: Record<string, string> = {
  sorted: 'green',
  done: 'green',
  found: 'green',
  ok: 'green',
  pivot: 'purple',
  target: 'purple',
  key: 'purple',
  visited: 'blue',
  seen: 'blue',
  current: 'blue',
  out: 'gray',
  removed: 'gray',
  skipped: 'gray',
  dead: 'gray'
}

const CELL_H = 34
const CELL_GAP = 6
const MIN_CELL_W = 36
const INDEX_H = 16
const POINTER_H = 18
const RANGE_H = 16
const PAD = 14

type Shape = 'array' | 'stack' | 'queue' | 'list' | 'tree' | 'graph'

interface Step {
  verb: string
  args: string[]
  rest: string
  line: number
}

/** One rendered moment. Marks and pointers persist; `active` and `note` do not. */
interface Frame {
  /** Item ids, in display order. */
  slots: number[]
  values: Map<number, string>
  /** Slot index → mark name. A mark is about a position, not a value. */
  marks: Map<number, string>
  active: number[]
  pointers: Array<{ name: string; index: number }>
  ranges: Array<{ name: string; lo: number; hi: number }>
  note?: string
}

// ------------------------------------------------------------------- parsing

function parseSteps(lines: Array<{ text: string; n: number }>): Step[] {
  return lines.map((line) => {
    const parts = line.text.split(/\s+/)
    const verb = parts[0].toLowerCase()
    return {
      verb,
      args: parts.slice(1),
      rest: line.text.slice(parts[0].length).trim(),
      line: line.n
    }
  })
}

/**
 * Resolve one argument to a position.
 *
 * `noun` is what the structure calls its positions, so a tree says "node" and
 * says how to name one — by the time a step gets here, a label that matched has
 * already been rewritten to its index, and anything left is a typo worth being
 * specific about.
 */
function index(step: Step, raw: string | undefined, length: number, noun: 'slot' | 'node' = 'slot'): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new VizError(
      noun === 'node'
        ? `\`${raw ?? ''}\` is not a node here — name one by its label, or \`#2\` for the third in pre-order`
        : `\`${step.verb}\` wants a slot number, not \`${raw ?? ''}\``,
      step.line
    )
  }
  // Negative indices count from the end, the way every language people write
  // these in already does.
  const at = value < 0 ? length + value : value
  if (at < 0 || at >= length) {
    if (length === 0) throw new VizError(`\`${step.verb}\` has nothing left to work on`, step.line)
    throw new VizError(
      noun === 'node'
        ? `\`${raw ?? ''}\` is not a node here — the tree has ${length}`
        : `slot ${value} is out of range; there ${length === 1 ? 'is 1 slot' : `are ${length} slots`}`,
      step.line
    )
  }
  return at
}

function clone(frame: Frame): Frame {
  return {
    slots: [...frame.slots],
    values: new Map(frame.values),
    marks: new Map(frame.marks),
    active: [],
    pointers: frame.pointers.map((p) => ({ ...p })),
    ranges: frame.ranges.map((r) => ({ ...r })),
    note: undefined
  }
}

/**
 * Fold the steps into frames.
 *
 * Every step produces exactly one frame, including the ones that change
 * nothing, because a `note` on its own is how you slow a run down at the point
 * that needs explaining.
 */
function runSteps(start: Frame, steps: Step[], shape: Shape): Frame[] {
  const frames: Frame[] = [start]
  const noun = shape === 'tree' || shape === 'graph' ? 'node' : 'slot'
  const slot = (step: Step, raw: string | undefined, length: number): number =>
    index(step, raw, length, noun)
  let nextItem = start.slots.length

  for (const step of steps) {
    const frame = clone(frames[frames.length - 1])
    const n = frame.slots.length
    const setMark = (at: number, name: string | undefined): void => {
      if (name) frame.marks.set(at, name)
      else frame.marks.delete(at)
    }

    switch (step.verb) {
      case 'note':
      case 'say':
        frame.note = step.rest
        break

      case 'hold':
      case 'pause':
        frame.note = step.rest || frames[frames.length - 1].note
        break

      case 'compare':
      case 'look':
      case 'read':
      case 'visit': {
        if (step.args.length === 0) throw new VizError(`\`${step.verb}\` needs at least one slot`, step.line)
        frame.active = step.args.map((arg) => slot(step, arg, n))
        if (step.verb === 'visit') for (const at of frame.active) setMark(at, 'visited')
        break
      }

      case 'swap': {
        const a = slot(step, step.args[0], n)
        const b = slot(step, step.args[1], n)
        const held = frame.slots[a]
        frame.slots[a] = frame.slots[b]
        frame.slots[b] = held
        frame.active = [a, b]
        break
      }

      case 'set':
      case 'write': {
        const at = slot(step, step.args[0], n)
        frame.values.set(frame.slots[at], step.args.slice(1).join(' ') || '')
        frame.active = [at]
        break
      }

      case 'mark': {
        const name = (step.args[step.args.length - 1] ?? '').match(/^-?\d+$/)
          ? 'marked'
          : (step.args.pop() ?? 'marked')
        const spans = step.args.length ? step.args : ['0']
        for (const arg of spans) {
          const span = /^(-?\d+)\.\.(-?\d+)$/.exec(arg)
          if (span) {
            const lo = slot(step, span[1], n)
            const hi = slot(step, span[2], n)
            for (let at = Math.min(lo, hi); at <= Math.max(lo, hi); at++) setMark(at, name)
          } else {
            setMark(slot(step, arg, n), name)
          }
        }
        break
      }

      case 'unmark': {
        if (step.args[0] === 'all' || step.args.length === 0) frame.marks.clear()
        else for (const arg of step.args) setMark(slot(step, arg, n), undefined)
        break
      }

      case 'at':
      case 'pointer': {
        const name = step.args[0]
        if (!name) throw new VizError('`at` needs a name and a slot, as in `at i 3`', step.line)
        const rest = step.args[1]
        const without = frame.pointers.filter((p) => p.name !== name)
        if (rest === undefined || rest === 'off' || rest === 'none') {
          frame.pointers = without
        } else {
          frame.pointers = [...without, { name, index: slot(step, rest, n) }]
        }
        break
      }

      case 'range':
      case 'window': {
        // The name is optional, and left off more often than not: `range 0 4`
        // is the bracket over the part still being sorted, and it does not need
        // calling anything. Two numbers and no name is that; a name and two
        // numbers is a bracket with a label on it.
        const named = step.args.length > 2 || !/^\d+$/.test(step.args[0] ?? '')
        const name = named ? step.args[0] : ''
        const bounds = named ? step.args.slice(1) : step.args
        if (named && !name) {
          throw new VizError(
            '`range` needs two slots, as in `range 0 4` or `range window 0 4`',
            step.line
          )
        }
        const without = frame.ranges.filter((r) => r.name !== name)
        if (bounds[0] === undefined || bounds[0] === 'off') {
          frame.ranges = without
        } else {
          const lo = slot(step, bounds[0], n)
          const hi = slot(step, bounds[1], n)
          frame.ranges = [...without, { name, lo: Math.min(lo, hi), hi: Math.max(lo, hi) }]
        }
        break
      }

      case 'push':
      case 'enqueue':
      case 'add': {
        const id = nextItem++
        frame.values.set(id, step.rest || '')
        frame.slots.push(id)
        frame.active = [frame.slots.length - 1]
        break
      }

      case 'pop':
      case 'dequeue': {
        if (frame.slots.length === 0) throw new VizError(`\`${step.verb}\` on an empty ${shape}`, step.line)
        // A stack pops its last slot; a queue takes from its first.
        const taken = step.verb === 'dequeue' || shape === 'queue' ? 0 : frame.slots.length - 1
        frame.slots.splice(taken, 1)
        // Marks are positional, so removing a slot shifts every mark past it.
        frame.marks = shiftKeys(frame.marks, taken)
        frame.active = []
        break
      }

      case 'insert': {
        const where = Math.min(Math.max(0, Number(step.args[0]) || 0), frame.slots.length)
        const id = nextItem++
        frame.values.set(id, step.args.slice(1).join(' '))
        frame.slots.splice(where, 0, id)
        frame.active = [where]
        break
      }

      case 'remove':
      case 'delete': {
        const gone = slot(step, step.args[0], n)
        frame.slots.splice(gone, 1)
        frame.marks = shiftKeys(frame.marks, gone)
        break
      }

      case 'clear':
        frame.marks.clear()
        frame.pointers = []
        frame.ranges = []
        break

      default:
        throw new VizError(
          `\`${step.verb}\` is not a step. Try compare, swap, set, mark, at, range, push, pop, or note.`,
          step.line
        )
    }

    frames.push(frame)
  }

  return frames
}

/** Drop the mark at `at` and pull the ones after it back by one. */
function shiftKeys(marks: Map<number, string>, at: number): Map<number, string> {
  const next = new Map<number, string>()
  for (const [key, value] of marks) {
    if (key === at) continue
    next.set(key > at ? key - 1 : key, value)
  }
  return next
}

// ----------------------------------------------------------- the lane stages

interface Stage {
  root: SVGSVGElement
  apply: (frame: Frame, previous: Frame | null) => void
}

/**
 * An array, a stack, a queue or a linked list — all the same row of cells,
 * differing in which way it runs and what is drawn between the cells.
 *
 * The elements are made once and moved, never rebuilt. That is what makes a
 * swap slide: the `<g>` holding a value keeps its identity across frames, so
 * changing its transform is something CSS can animate, where replacing it would
 * just be a jump.
 */
function laneStage(shape: Shape, frames: Frame[], marksUsed: Set<string>): Stage {
  const vertical = shape === 'stack'
  const widest = Math.max(
    MIN_CELL_W,
    ...frames.flatMap((frame) => [...frame.values.values()].map((v) => textWidth(v, 12) + 16))
  )
  const cellW = Math.ceil(widest)
  const stepX = cellW + (shape === 'list' ? 34 : CELL_GAP)
  const stepY = CELL_H + CELL_GAP
  const most = Math.max(...frames.map((frame) => frame.slots.length))

  // Pointers get a lane each, in the order they first appear, so two pointers
  // that land on the same slot never draw on top of each other.
  const pointerLane = new Map<string, number>()
  for (const frame of frames) {
    for (const pointer of frame.pointers) {
      if (!pointerLane.has(pointer.name)) pointerLane.set(pointer.name, pointerLane.size)
    }
  }
  const rangeLane = new Map<string, number>()
  for (const frame of frames) {
    for (const range of frame.ranges) {
      if (!rangeLane.has(range.name)) rangeLane.set(range.name, rangeLane.size)
    }
  }

  const rangeTop = rangeLane.size * RANGE_H
  const laneTop = rangeTop
  const laneW = vertical ? cellW : Math.max(cellW, most * stepX - (stepX - cellW))
  const laneH = vertical ? most * stepY - CELL_GAP : CELL_H
  const belowLane = laneTop + laneH + (shape === 'stack' ? 6 : INDEX_H)
  const height = belowLane + pointerLane.size * POINTER_H + 6

  const slotX = (at: number): number => (vertical ? 0 : at * stepX)
  const slotY = (at: number, count: number): number =>
    vertical ? laneTop + (count - 1 - at) * stepY : laneTop

  const { defs, arrow, open } = arrowDefs()
  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `${-PAD - 26} ${-PAD} ${laneW + PAD * 2 + 52} ${height + PAD * 2}`,
    width: round(laneW + PAD * 2 + 52),
    height: round(height + PAD * 2),
    role: 'img'
  })
  root.appendChild(defs)

  const linkLayer = svg('g', { class: 'viz-links' })
  const rangeLayer = svg('g', { class: 'viz-ranges' })
  const cellLayer = svg('g', { class: 'viz-cells' })
  const indexLayer = svg('g', { class: 'viz-indices' })
  const pointerLayer = svg('g', { class: 'viz-pointers' })
  root.append(rangeLayer, linkLayer, cellLayer, indexLayer, pointerLayer)

  // Slot furniture — the index under each position, and the arrows between
  // positions in a list. These belong to the slot, not the value, so they never
  // move once drawn.
  for (let at = 0; at < most; at++) {
    if (shape === 'list' && at < most - 1) {
      const y = laneTop + CELL_H / 2
      linkLayer.appendChild(
        svg('line', {
          class: 'viz-link',
          x1: round(slotX(at) + cellW),
          y1: round(y),
          x2: round(slotX(at + 1) - 4),
          y2: round(y),
          'marker-end': arrow
        })
      )
    }
    if (shape === 'array' || shape === 'queue') {
      indexLayer.appendChild(
        label(String(at), round(slotX(at) + cellW / 2), round(laneTop + CELL_H + INDEX_H / 2), 'viz-cell__index', 9)
      )
    }
    if (vertical) {
      indexLayer.appendChild(
        label(String(at), round(-10), round(slotY(at, most) + CELL_H / 2), 'viz-cell__index', 9, 'end')
      )
    }
  }

  if (shape === 'queue') {
    indexLayer.appendChild(label('front', round(-8), round(laneTop + CELL_H / 2), 'viz-lane__end', 9, 'end'))
    indexLayer.appendChild(label('back', round(laneW + 8), round(laneTop + CELL_H / 2), 'viz-lane__end', 9, 'start'))
  }

  // One `<g>` per value, made once. `most` of them exist even if a frame shows
  // fewer; the extras are hidden rather than destroyed.
  const cells = new Map<number, { group: SVGGElement; shape: SVGRectElement; text: SVGTextElement }>()
  const cellFor = (id: number): { group: SVGGElement; shape: SVGRectElement; text: SVGTextElement } => {
    let made = cells.get(id)
    if (!made) {
      const box = svg('rect', { class: 'viz-cell__shape', x: 0, y: 0, width: cellW, height: CELL_H, rx: 5 })
      const text = label('', cellW / 2, CELL_H / 2, 'viz-cell__value', 12)
      const group = svg('g', { class: 'viz-cell' }, [box, text])
      cellLayer.appendChild(group)
      made = { group, shape: box, text }
      cells.set(id, made)
    }
    return made
  }
  for (const frame of frames) for (const id of frame.slots) cellFor(id)

  // A named pointer is a caret with a label. Below the row for a lane that runs
  // across, beside it for one that runs down — and the stem is drawn long
  // enough to reach back to the slot from whichever lane the pointer sits in,
  // so three pointers on one slot are all still visibly attached to it.
  const pointers = new Map<string, SVGGElement>()
  for (const [name, lane] of pointerLane) {
    const stem = lane * POINTER_H + 9
    const group = svg('g', { class: 'viz-pointer' }, [
      svg('path', {
        class: 'viz-pointer__stem',
        d: vertical
          ? `M -12 8 L -2 8`
          : `M ${round(cellW / 2)} ${round(-stem)} L ${round(cellW / 2)} 0`,
        'marker-start': open
      }),
      vertical
        ? label(ellipsize(name, 10, 60), 2, 8, 'viz-pointer__label', 10, 'start')
        : label(ellipsize(name, 10, cellW + 18), round(cellW / 2), 8, 'viz-pointer__label', 10)
    ])
    group.style.transform = `translate(0px, ${round(belowLane + lane * POINTER_H + 4)}px)`
    pointerLayer.appendChild(group)
    pointers.set(name, group)
  }

  const ranges = new Map<string, { group: SVGGElement; bar: SVGPathElement; text: SVGTextElement }>()
  for (const [name] of rangeLane) {
    const bar = svg('path', { class: 'viz-range__bar', d: '' })
    const text = label(name, 0, -RANGE_H + 5, 'viz-range__label', 9)
    const group = svg('g', { class: 'viz-range' }, [bar, text])
    rangeLayer.appendChild(group)
    ranges.set(name, { group, bar, text })
  }

  const apply = (frame: Frame): void => {
    const count = frame.slots.length
    const seen = new Set<number>()

    frame.slots.forEach((id, at) => {
      seen.add(id)
      const cell = cellFor(id)
      cell.group.style.transform = `translate(${round(slotX(at))}px, ${round(slotY(at, vertical ? most : count))}px)`
      cell.group.style.opacity = '1'
      const value = frame.values.get(id) ?? ''
      cell.text.textContent = ellipsize(value, 12, cellW - 8)

      const mark = frame.marks.get(at)
      const accent = mark ? (MARK_ACCENT[mark] ?? 'yellow') : undefined
      cell.group.setAttribute(
        'class',
        `viz-cell${mark ? ' is-marked' : ''}${frame.active.includes(at) ? ' is-active' : ''}`
      )
      const colour = accentValue(accent)
      if (colour) cell.group.style.setProperty('--viz-accent', colour)
      else cell.group.style.removeProperty('--viz-accent')
      if (mark) marksUsed.add(mark)
    })

    // A value that has been popped fades where it stood rather than vanishing.
    for (const [id, cell] of cells) {
      if (seen.has(id)) continue
      cell.group.style.opacity = '0'
      cell.group.setAttribute('class', 'viz-cell is-gone')
    }

    for (const [name, group] of pointers) {
      const pointer = frame.pointers.find((p) => p.name === name)
      const lane = pointerLane.get(name) ?? 0
      group.style.opacity = pointer ? '1' : '0'
      if (pointer) {
        group.style.transform = vertical
          ? `translate(${round(cellW + 14)}px, ${round(slotY(pointer.index, most) + CELL_H / 2 - 8)}px)`
          : `translate(${round(slotX(pointer.index))}px, ${round(belowLane + lane * POINTER_H + 4)}px)`
      }
    }

    for (const [name, drawn] of ranges) {
      const range = frame.ranges.find((r) => r.name === name)
      drawn.group.style.opacity = range ? '1' : '0'
      if (!range) continue
      const lane = rangeLane.get(name) ?? 0
      const x1 = slotX(range.lo)
      const x2 = slotX(range.hi) + cellW
      const y = rangeTop - lane * RANGE_H - 6
      drawn.bar.setAttribute('d', `M ${round(x1)} ${round(y + 4)} L ${round(x1)} ${round(y)} L ${round(x2)} ${round(y)} L ${round(x2)} ${round(y + 4)}`)
      drawn.text.setAttribute('x', round((x1 + x2) / 2).toString())
      drawn.text.setAttribute('y', round(y - 5).toString())
    }
  }

  return { root, apply }
}

/**
 * A tree, with the traversal walked over it.
 *
 * The layout is the `tree` fence's, unchanged, so the same source draws the
 * same picture whether it is still or moving. Only the classes on the nodes
 * change between frames — nothing in a tree animation moves, because the shape
 * of the tree is the thing being explained and a tree that reflows mid-walk is
 * unreadable.
 */
function treeStage(tree: TreeNode, frames: Frame[], marksUsed: Set<string>): Stage {
  const { nodes, edges, width, top, bottom } = layoutTree(tree)
  const { defs } = arrowDefs()
  const shapes = svg('g', { class: 'viz-nodes' })
  const drawn = nodes.map((node) => {
    const group = drawTreeNode(node)
    shapes.appendChild(group)
    return group
  })

  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${-PAD} ${round(top - PAD)} ${round(width + PAD * 2)} ${round(bottom - top + PAD * 2)}`,
      width: round(width + PAD * 2),
      height: round(bottom - top + PAD * 2),
      role: 'img'
    },
    [defs, edges, shapes]
  )

  const apply = (frame: Frame): void => {
    drawn.forEach((group, at) => {
      const mark = frame.marks.get(at)
      const accent = mark ? (MARK_ACCENT[mark] ?? 'yellow') : undefined
      group.setAttribute(
        'class',
        `viz-node${mark ? ' is-marked' : ''}${frame.active.includes(at) ? ' is-active' : ''}`
      )
      const colour = accentValue(accent)
      if (colour) group.style.setProperty('--viz-accent', colour)
      else group.style.removeProperty('--viz-accent')
      if (mark) marksUsed.add(mark)
    })
  }

  return { root, apply }
}

/**
 * A graph, with the walk over it drawn on top.
 *
 * The same contract as `treeStage` — lay the picture out once, then say what
 * each frame does to it — with one addition: an edge lights when *both* of its
 * ends are active. That is derived rather than written, and it is the whole
 * reason `compare a b` is the step for relaxing an edge: the fence needs no
 * verb for "cross this edge", because crossing one is looking at both of the
 * things it joins.
 *
 * A node's value is its second line rather than its name. A graph's nodes are
 * named by the source and never renamed; what changes as a shortest-path
 * algorithm runs is the number under each one, which is exactly what `set b 4`
 * should write.
 */
function graphStage(graph: Graph, frames: Frame[], marksUsed: Set<string>): Stage {
  const figure = drawGraphFigure(graph)

  const apply = (frame: Frame): void => {
    figure.nodes.forEach((group, at) => {
      const node = graph.nodes[at]
      const mark = frame.marks.get(at)
      const accent = mark ? (MARK_ACCENT[mark] ?? 'yellow') : node.accent
      group.setAttribute(
        'class',
        `viz-node${mark || node.highlight ? ' is-marked' : ''}${frame.active.includes(at) ? ' is-active' : ''}${node.dim ? ' is-dim' : ''}`
      )
      const colour = accentValue(accent)
      if (colour) group.style.setProperty('--viz-accent', colour)
      else group.style.removeProperty('--viz-accent')
      if (mark) marksUsed.add(mark)
    })

    figure.subs.forEach((text, at) => {
      text.textContent = frame.values.get(at) ?? ''
    })

    figure.edges.forEach((group, at) => {
      const edge = graph.edges[at]
      group.classList.toggle(
        'is-active',
        frame.active.includes(edge.from) && frame.active.includes(edge.to)
      )
    })
  }

  return { root: figure.root, apply }
}

// ------------------------------------------------------------------ playback

export interface Animation extends Figure {
  /** The whole figure — svg, caption and transport — as one element. */
  element: HTMLElement
  destroy: () => void
}

interface Prepared {
  frames: Frame[]
  stage: Stage
  marksUsed: Set<string>
  directives: Map<string, string>
}

/**
 * Everything up to the first paint: the steps read, the frames folded, and the
 * stage built. Shared by the player and by the still it prints as.
 */
function prepare(source: string): Prepared {
  const whole = readSource(source, ALGO_KEYS)

  // A graph is written as lines, and so are the steps, so for this one shape
  // the `---` rule has to mean something. Everywhere else it stays what it has
  // always been — a place to rest the eye, dropped before anything reads the
  // block — and the two halves are read together.
  let directives = whole.directives
  let structure: SourceLine[] = []
  let body = whole.lines
  if (whole.directives.has('graph')) {
    const at = source.split('\n').findIndex((line) => line.trim() === '---')
    if (at === -1) {
      throw new VizError(
        'a `graph:` run needs a `---` between the graph and the steps, or there is no telling which lines are which'
      )
    }
    const above = readSource(source.split('\n').slice(0, at).join('\n'), ALGO_KEYS)
    const below = readSource(source.split('\n').slice(at + 1).join('\n'), ALGO_KEYS)
    directives = new Map([...above.directives, ...below.directives])
    structure = above.lines
    body = below.lines
  }

  const shape: Shape = directives.has('graph')
    ? 'graph'
    : directives.has('stack')
      ? 'stack'
      : directives.has('queue')
        ? 'queue'
        : directives.has('list')
          ? 'list'
          : directives.has('bst') || directives.has('heap') || directives.has('level')
            ? 'tree'
            : 'array'

  const steps = parseSteps(body)

  // A tree names its nodes; a lane numbers its slots. Either way a step arrives
  // holding a name, and it has to become the index the frames are folded over.
  let start: Frame
  let tree: TreeNode | null = null
  let graph: Graph | null = null
  if (shape === 'graph') {
    graph = buildGraph(structure, directives)
    // Room for a second line under every node is reserved before the layout
    // runs, whether or not anything has written one yet: a node that grew when
    // its distance arrived would move every edge that ends at it.
    layoutGraph(graph, directives.get('layout'), true)

    // A step names a node the way the graph does. Rewriting the names to
    // indices here is what lets every verb below stay index-based.
    for (const step of steps) {
      step.args = step.args.map((arg) => {
        const at = graph?.byId.get(arg)
        return at === undefined ? arg : String(at)
      })
    }

    start = {
      slots: graph.nodes.map((_, at) => at),
      values: new Map(graph.nodes.flatMap((node, at) => (node.sub ? [[at, node.sub] as [number, string]] : []))),
      marks: new Map(),
      active: [],
      pointers: [],
      ranges: []
    }
  } else if (shape === 'tree') {
    tree = buildTree(directives, [])
    const order: TreeNode[] = []
    const collect = (node: TreeNode): void => {
      order.push(node)
      for (const child of node.children) if (child) collect(child)
    }
    collect(tree)
    const byLabel = new Map<string, number>()
    order.forEach((node, at) => {
      if (!byLabel.has(node.label)) byLabel.set(node.label, at)
    })
    for (const step of steps) {
      step.args = step.args.map((arg) => {
        if (arg.startsWith('#')) return arg.slice(1)
        const found = byLabel.get(arg)
        return found === undefined ? arg : String(found)
      })
    }
    start = {
      slots: order.map((_, at) => at),
      values: new Map(order.map((node, at) => [at, node.label])),
      marks: new Map(),
      active: [],
      pointers: [],
      ranges: []
    }
  } else {
    const key = shape === 'array' ? 'array' : shape
    const values = items(directives.get(key) ?? '').map((raw) => annotate(raw).label)
    start = {
      slots: values.map((_, at) => at),
      values: new Map(values.map((value, at) => [at, value])),
      marks: new Map(),
      active: [],
      pointers: [],
      ranges: []
    }
  }

  if (start.slots.length === 0 && steps.length === 0) {
    throw new VizError(
      'nothing to run. Give it `array: 5 3 8 1` and some steps, such as `compare 0 1` and `swap 0 1`.'
    )
  }

  const frames = runSteps(start, steps, shape)
  const marksUsed = new Set<string>()
  const stage =
    shape === 'graph' && graph
      ? graphStage(graph, frames, marksUsed)
      : shape === 'tree' && tree
        ? treeStage(tree, frames, marksUsed)
        : laneStage(shape, frames, marksUsed)

  // A pass over every frame before the first paint, so the legend below the
  // figure is complete from the start rather than growing as it plays.
  for (const frame of frames) for (const mark of frame.marks.values()) marksUsed.add(mark)

  return { frames, stage, marksUsed, directives }
}

// ------------------------------------------------------- waiting for an answer

/**
 * The block Claude has been asked for and has not answered yet.
 *
 * Generating one of these takes a minute or two, and the point of asking for it
 * from inside the note is that the minute is spent taking notes rather than
 * watching a dialog. So the block goes into the document straight away, holding
 * the space the figure will need, and the note carries on underneath it. The
 * source is real: `pending:` names the request, `prompt:` says what was asked
 * for, and if the app is closed before the answer lands, what is left behind is
 * a block saying what it was for rather than a mystery.
 *
 * `error:` is the same block after a request that failed. It keeps the prompt,
 * because the prompt is the part worth another try.
 */
export function algoWaiting(source: string): Map<string, string> | null {
  const { directives } = readSource(source, ALGO_KEYS)
  return directives.has('pending') || directives.has('error') ? directives : null
}

/**
 * Five empty slots, the width of a real figure, so nothing jumps when it lands.
 *
 * `live` is whether the request is actually still out. A block whose request
 * was lost — the app was closed while it was being drawn — is not going to be
 * filled in by anything, and a figure that shimmers away saying otherwise is a
 * lie the note would go on telling for as long as it was kept.
 */
export function drawAlgoWaiting(directives: Map<string, string>, live = false): Animation {
  const failed = directives.get('error')?.trim()
  const asked = directives.get('prompt')?.trim()
  const cellW = 48
  const step = cellW + CELL_GAP
  const slots = 5
  const width = slots * step - CELL_GAP
  const height = CELL_H + INDEX_H

  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
    width: round(width + PAD * 2),
    height: round(height + PAD * 2),
    role: 'img'
  })
  for (let at = 0; at < slots; at++) {
    root.appendChild(
      svg('rect', {
        class: 'viz-cell__shape viz-cell__shape--waiting',
        x: round(at * step),
        y: 0,
        width: cellW,
        height: CELL_H,
        rx: 5,
        // Each slot a beat behind the one before it, so the wait reads as a
        // sweep across the figure rather than five things blinking at once.
        style: `animation-delay: ${at * 140}ms`
      })
    )
  }

  const element = html('div', {
    class: failed || !live ? 'viz viz--algo viz--waiting is-failed' : 'viz viz--algo viz--waiting'
  })
  const named = asked || directives.get('title') || 'An algorithm'
  element.appendChild(html('div', { class: 'viz__title' }, [named]))
  element.appendChild(html('div', { class: 'viz__stage' }, [root]))
  const said = failed
    ? failed
    : live
      ? 'Claude is drawing this. Keep writing — it will appear here when it lands.'
      : 'This was asked for and never arrived. Ask for it again, or delete the block.'
  element.appendChild(html('p', { class: failed ? 'viz__error' : 'viz__caption' }, [said]))
  return { root, element, destroy: () => {} }
}

/**
 * The strip of stills, as one element.
 *
 * Built here rather than by each caller so that a run frozen on screen and the
 * same run on paper are the same picture. The frames are laid out by CSS, which
 * is what lets three stills of an eight-cell array sit in a row on a wide note
 * and stack on a narrow one without the figure being measured twice.
 */
export function drawAlgoStrip(source: string): Animation {
  const film = drawAlgoFilm(source)
  const strip = html('div', { class: 'viz__film' })
  for (const cell of film.cells) {
    strip.appendChild(
      html('div', { class: 'viz__frame' }, [
        html('div', { class: 'viz__stage' }, [cell.svg]),
        html('p', { class: 'viz__note' }, [cell.note || `Step ${cell.step}`])
      ])
    )
  }

  const element = html('figure', { class: 'viz viz--algo viz--still' }, [
    film.title ? html('div', { class: 'viz__title' }, [film.title]) : null,
    strip,
    film.caption ? html('figcaption', { class: 'viz__caption' }, [film.caption]) : null
  ])

  return {
    root: film.cells[0]?.svg ?? svg('svg'),
    element,
    title: film.title,
    caption: film.caption,
    destroy: () => {}
  }
}

export function drawAlgo(source: string, live = false): Animation {
  const waiting = algoWaiting(source)
  if (waiting) return drawAlgoWaiting(waiting, live)

  // A run asked to hold still never gets a transport: the figure is the frames
  // side by side, and a play button under it would be offering to animate an
  // argument that is not about time.
  if (readSource(source, ALGO_KEYS).directives.has('stills')) return drawAlgoStrip(source)

  const { frames, stage, marksUsed, directives } = prepare(source)

  const speed = Math.min(4000, Math.max(120, numeric(directives, 'speed', 700)))
  const loop = flag(directives, 'loop')

  // ------------------------------------------------------------------ chrome

  const element = html('div', { class: 'viz viz--algo' })
  const title = directives.get('title')
  if (title) element.appendChild(html('div', { class: 'viz__title' }, [title]))
  element.appendChild(html('div', { class: 'viz__stage' }, [stage.root]))

  const note = html('p', { class: 'viz__note' })
  element.appendChild(note)

  const button = (name: string, glyph: string, hint: string): HTMLButtonElement =>
    html('button', { type: 'button', class: `viz__btn viz__btn--${name}`, 'aria-label': hint, title: hint }, [glyph])

  const restart = button('restart', '↺', 'Back to the start')
  const back = button('back', '‹', 'Previous step')
  const play = button('play', '▶', 'Play')
  const forward = button('forward', '›', 'Next step')
  const scrub = html('input', {
    type: 'range',
    class: 'viz__scrub',
    min: 0,
    max: frames.length - 1,
    value: 0,
    'aria-label': 'Step'
  }) as HTMLInputElement
  const counter = html('span', { class: 'viz__counter' })

  element.appendChild(html('div', { class: 'viz__transport' }, [restart, back, play, forward, scrub, counter]))

  if (marksUsed.size) {
    const legend = html('div', { class: 'viz__legend' })
    for (const mark of marksUsed) {
      const swatch = html('span', { class: 'viz__swatch' })
      const accent = accentStyle(MARK_ACCENT[mark] ?? 'yellow')
      if (accent) swatch.setAttribute('style', accent)
      legend.appendChild(html('span', { class: 'viz__key' }, [swatch, mark]))
    }
    element.appendChild(legend)
  }

  // ---------------------------------------------------------------- the loop

  let at = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const show = (next: number): void => {
    at = Math.max(0, Math.min(frames.length - 1, next))
    stage.apply(frames[at], at > 0 ? frames[at - 1] : null)
    scrub.value = String(at)
    counter.textContent = `${at} / ${frames.length - 1}`
    // The note persists visually until something replaces it: a caption that
    // blinks off on the next step is unreadable at any speed worth watching.
    let carried = ''
    for (let n = at; n >= 0; n--) {
      if (frames[n].note) {
        carried = frames[n].note ?? ''
        break
      }
    }
    note.textContent = carried
    back.disabled = at === 0
    forward.disabled = at === frames.length - 1
  }

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    play.textContent = '▶'
    play.setAttribute('aria-label', 'Play')
    element.classList.remove('is-playing')
  }

  const begin = (): void => {
    if (timer) return
    if (at >= frames.length - 1) show(0)
    play.textContent = '❚❚'
    play.setAttribute('aria-label', 'Pause')
    element.classList.add('is-playing')
    timer = setInterval(() => {
      if (at >= frames.length - 1) {
        if (loop) show(0)
        else stop()
        return
      }
      show(at + 1)
    }, speed)
  }

  play.addEventListener('click', () => (timer ? stop() : begin()))
  back.addEventListener('click', () => {
    stop()
    show(at - 1)
  })
  forward.addEventListener('click', () => {
    stop()
    show(at + 1)
  })
  restart.addEventListener('click', () => {
    stop()
    show(0)
  })
  scrub.addEventListener('input', () => {
    stop()
    show(Number(scrub.value))
  })

  // Arrow keys, but only once the transport has been touched — a note is full
  // of arrow-key navigation already, and stealing it from the caret would be
  // the worst kind of surprise.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    stop()
    show(at + (event.key === 'ArrowRight' ? 1 : -1))
  })

  show(0)
  if (flag(directives, 'autoplay')) begin()

  return {
    root: stage.root,
    element,
    title,
    caption: directives.get('caption'),
    destroy: stop
  }
}

/** At most this many stills in a printed run; the rest are sampled out. */
const FILM_MAX = 12

/**
 * The steps a `stills:` directive asks to be frozen, if it asks for any.
 *
 * A bare `stills:` means "whichever ones matter", which is the same judgement
 * the printed strip makes. A list means exactly those steps, and that is the
 * form the figure exists for: `stills: 0 6 14` is on entry, held, and on exit —
 * the three pictures a loop invariant is argued with, and the reason they must
 * be choosable rather than sampled.
 */
function chosenStills(directives: Map<string, string>, frames: number): number[] | 'auto' | null {
  if (!directives.has('stills')) return null
  const raw = (directives.get('stills') ?? '').trim()
  if (raw === '' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'auto') return 'auto'

  return items(raw).map((one) => {
    const at = Number(one)
    if (!Number.isInteger(at)) throw new VizError(`\`${one}\` is not a step number`)
    // Negative counts back from the end, so `stills: 0 -1` is start and finish
    // without having to know how many steps were written.
    const index = at < 0 ? frames + at : at
    if (index < 0 || index >= frames) {
      throw new VizError(`there is no step ${at} — the run has ${frames - 1}`)
    }
    return index
  })
}

/**
 * The same run, still.
 *
 * A PDF cannot play, and a single frozen frame of an animation is close to
 * useless — the start says nothing about the algorithm and the end says nothing
 * about how it got there. A textbook prints these as a strip of stills, so that
 * is what an export gets: the frames that carry a note, first and last always,
 * and enough of the rest to fill the strip. `stills:` asks for the same
 * treatment on screen, and then the choice of frames is the author's.
 */
export function drawAlgoFilm(source: string): {
  title?: string
  caption?: string
  cells: Array<{ svg: SVGSVGElement; note: string; step: number }>
} {
  const { frames, stage, directives } = prepare(source)

  const asked = chosenStills(directives, frames.length)
  let chosen: number[]

  if (Array.isArray(asked)) {
    chosen = asked
  } else {
    const wanted = new Set<number>([0, frames.length - 1])
    frames.forEach((frame, at) => {
      if (frame.note) wanted.add(at)
    })
    // Fill up to the cap with an even spread, so a run with no notes at all still
    // shows its shape rather than only its ends.
    for (let n = 0; wanted.size < Math.min(FILM_MAX, frames.length); n++) {
      wanted.add(Math.round((n * (frames.length - 1)) / Math.min(FILM_MAX - 1, frames.length - 1)))
      if (n > frames.length) break
    }
    chosen = [...wanted].sort((a, b) => a - b).slice(0, FILM_MAX)
  }

  const cells = chosen.map((at) => {
    stage.apply(frames[at], at > 0 ? frames[at - 1] : null)
    let note = ''
    for (let n = at; n >= 0; n--) {
      if (frames[n].note) {
        note = frames[n].note ?? ''
        break
      }
    }
    return { svg: stage.root.cloneNode(true) as SVGSVGElement, note, step: at }
  })

  return { title: directives.get('title'), caption: directives.get('caption'), cells }
}

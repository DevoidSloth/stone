/**
 * The `tree` fence: trees, drawn the way a textbook draws them.
 *
 * Mermaid can draw a graph, and for a flowchart that is the right tool. It is
 * the wrong one for the trees a programmer actually needs to see, for two
 * reasons. A binary tree with one child missing has to *look* lopsided — a
 * `flowchart` will happily centre the only child under its parent and lose the
 * one fact that mattered. And the way these trees arrive is as an array: a heap
 * is `[9, 7, 8, 3]`, a LeetCode tree is `[1, 2, 3, null, null, 4, 5]`, a BST is
 * the order things were inserted in. Redrawing those as node-and-edge lists by
 * hand is exactly the work worth not doing.
 *
 * So the fence takes them as arrays, or as an indented outline where a `.`
 * holds an empty slot open, and lays the result out tidily: every subtree gets
 * the width it needs, and a parent sits over the midpoint of its children,
 * including the missing ones.
 */

import { accentStyle, arrowDefs, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, isNull, items, readSource, VizError, type Annotated } from './source'
import { readRecurrence, solve, type Solved } from './recurrence'

export const TREE_KEYS = [
  'title',
  'bst',
  'heap',
  'level',
  'traverse',
  'caption',
  'recurrence',
  'depth',
  'cost',
  'total',
  'rotate'
] as const

export interface TreeNode extends Annotated {
  children: Array<TreeNode | null>
  /** Filled in by `measure`. */
  boxW: number
  boxH: number
  round: boolean
  /** Filled in by `place`. */
  cx: number
  cy: number
  /** Its position in the traversal, when one was asked for. */
  order?: number
}

const LABEL_SIZE = 12
const SUB_SIZE = 10
const RADIUS = 17
const BOX_H = 30
const BOX_H_SUB = 40
const GAP = 18
const LEVEL_H = 66
const NULL_W = 16
const PAD = 16

function node(from: Annotated, boxed = false): TreeNode {
  const width = textWidth(from.label, LABEL_SIZE)
  const subWidth = from.sub ? textWidth(from.sub, SUB_SIZE) : 0
  // A short label gets a circle, which is what a tree of numbers is drawn with
  // everywhere; anything longer gets a box, because a circle wide enough for
  // `left_child` is a stadium and reads as a state machine. `boxed` is for the
  // trees whose labels are of mixed length by construction — `n`, `n/2`,
  // `n/16` — where letting each node pick would draw three different shapes
  // for what is obviously one kind of thing.
  const isRound = !boxed && from.label.length <= 3 && !from.sub
  return {
    ...from,
    children: [],
    round: isRound,
    boxW: isRound ? RADIUS * 2 : Math.max(36, Math.max(width, subWidth) + 22),
    boxH: from.sub ? BOX_H_SUB : isRound ? RADIUS * 2 : BOX_H,
    cx: 0,
    cy: 0
  }
}

// ------------------------------------------------------------------ builders

/** A BST built by inserting in the order given. Equal keys go right. */
function fromInsertions(values: string[]): TreeNode | null {
  let root: TreeNode | null = null
  const insert = (into: TreeNode, leaf: TreeNode): void => {
    // Numeric where both look numeric, lexicographic otherwise, so a tree of
    // words sorts the way a tree of words should.
    const a = Number(leaf.label)
    const b = Number(into.label)
    const goLeft =
      Number.isFinite(a) && Number.isFinite(b) ? a < b : leaf.label.localeCompare(into.label) < 0
    // A binary node always has two slots, so an only child stays on its side.
    if (into.children.length < 2) into.children = [into.children[0] ?? null, into.children[1] ?? null]
    const slot = goLeft ? 0 : 1
    const child = into.children[slot]
    if (child) insert(child, leaf)
    else into.children[slot] = leaf
  }
  for (const value of values) {
    if (isNull(value)) continue
    const leaf = node(annotate(value))
    if (!root) root = leaf
    else insert(root, leaf)
  }
  return root
}

/**
 * A complete binary tree from an array, the way a heap is stored.
 *
 * The indices are drawn under each node, because `parent(i) = (i - 1) / 2` is
 * the entire idea of a heap and a picture without the indices in it is a
 * picture of a tree, not of a heap.
 */
function fromHeap(values: string[]): TreeNode | null {
  const nodes = values.map((value, index) => {
    const parsed = annotate(value)
    return node({ ...parsed, sub: parsed.sub ?? `[${index}]` })
  })
  nodes.forEach((parent, index) => {
    const left = nodes[index * 2 + 1] ?? null
    const right = nodes[index * 2 + 2] ?? null
    if (left || right) parent.children = [left, right]
  })
  return nodes[0] ?? null
}

/**
 * A level-order array with holes, which is how every tree in every coding
 * problem is written down. `[1, 2, 3, null, null, 4, 5]`, in other words —
 * except that a hole has no children, so the array is consumed breadth-first
 * rather than indexed.
 */
function fromLevelOrder(values: string[]): TreeNode | null {
  if (values.length === 0 || isNull(values[0])) return null
  const root = node(annotate(values[0]))
  const queue: TreeNode[] = [root]
  let at = 1
  while (queue.length && at < values.length) {
    const parent = queue.shift()!
    const pair: Array<TreeNode | null> = []
    for (let slot = 0; slot < 2; slot++) {
      const raw = values[at++]
      if (raw === undefined || isNull(raw)) {
        pair.push(null)
        continue
      }
      const child = node(annotate(raw))
      pair.push(child)
      queue.push(child)
    }
    if (pair[0] || pair[1]) parent.children = pair
  }
  return root
}

/**
 * An indented outline, for the trees that are not arrays: a parse tree, a
 * directory, a trie. Indentation is compared, never counted, so two spaces and
 * four spaces both work as long as one file picks one.
 */
function fromOutline(lines: Array<{ text: string; indent: number; n: number }>): TreeNode | null {
  let root: TreeNode | null = null
  const stack: Array<{ indent: number; node: TreeNode }> = []

  for (const line of lines) {
    while (stack.length && line.indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1]?.node ?? null

    if (isNull(line.text)) {
      if (!parent) throw new VizError('an empty slot needs a parent above it', line.n)
      parent.children.push(null)
      continue
    }

    const made = node(annotate(line.text))
    if (!parent) {
      if (root) throw new VizError('a tree has one root; indent this under it', line.n)
      root = made
    } else {
      parent.children.push(made)
    }
    stack.push({ indent: line.indent, node: made })
  }

  return root
}

/**
 * The tree a recurrence unrolls into.
 *
 * Every node is a call, labelled with the size of the problem it was handed, so
 * the picture answers "how small has it got by level three" by being read
 * rather than by being calculated. The bottom row is the base case: the
 * recursion has stopped, and what is left is the count of leaves, which is the
 * other half of where the answer comes from.
 */
function fromRecurrence(sizes: string[], branch: number): TreeNode {
  const total = sizes.reduce((sum, _, level) => sum + Math.pow(branch, level), 0)
  if (total > 64) {
    throw new VizError(
      `${total} calls is more than a figure can show. Lower \`depth:\`, or fewer subproblems.`
    )
  }

  const build = (level: number): TreeNode => {
    const made = node({ label: sizes[level] }, true)
    if (level < sizes.length - 1) {
      made.children = Array.from({ length: branch }, () => build(level + 1))
    }
    return made
  }
  return build(0)
}

/**
 * The recurrence a `tree` block was given, already solved.
 *
 * Read in one place and used in two — the builder needs the sizes, the drawing
 * needs the costs — so that a block cannot end up with a tree of one shape and
 * a cost column belonging to another.
 */
function recurrenceOf(directives: Map<string, string>): { solved: Solved; branch: number; source: string } | null {
  const written = directives.get('recurrence')
  if (written === undefined) return null

  const rec = readRecurrence(written)
  const asked = Number(directives.get('depth'))
  // Three levels below the root is the figure everyone draws for a binary
  // recurrence. A three-way one has twenty-seven leaves by then and is a mile
  // wide, so it gets one level fewer unless the block asks for more.
  const fallback = rec.branch >= 3 ? 2 : 3
  const depth = Number.isInteger(asked) && asked >= 1 && asked <= 8 ? asked : fallback
  return { solved: solve(rec, depth), branch: rec.branch, source: rec.source }
}

// -------------------------------------------------------------------- layout

/** The horizontal room a subtree needs, including the gaps inside it. */
function measure(tree: TreeNode | null, widths: Map<TreeNode, number>): number {
  if (!tree) return NULL_W
  const kids = tree.children
  if (kids.length === 0) {
    widths.set(tree, tree.boxW)
    return tree.boxW
  }
  let span = 0
  kids.forEach((child, index) => {
    span += measure(child, widths)
    if (index > 0) span += GAP
  })
  const total = Math.max(tree.boxW, span)
  widths.set(tree, total)
  return total
}

/**
 * Give every node a centre.
 *
 * A parent sits over the midpoint between its first and last child slot — slot,
 * not child, so a node whose right child is missing leans left, which is the
 * whole point of drawing a binary tree rather than listing it.
 */
function place(
  tree: TreeNode,
  left: number,
  depth: number,
  widths: Map<TreeNode, number>,
  nulls: Array<{ x: number; y: number; parent: TreeNode }>
): void {
  const total = widths.get(tree) ?? tree.boxW
  tree.cy = depth * LEVEL_H + tree.boxH / 2

  if (tree.children.length === 0) {
    tree.cx = left + total / 2
    return
  }

  let span = 0
  tree.children.forEach((child, index) => {
    span += child ? (widths.get(child) ?? child.boxW) : NULL_W
    if (index > 0) span += GAP
  })

  let cursor = left + (total - span) / 2
  const centres: number[] = []
  for (const child of tree.children) {
    const width = child ? (widths.get(child) ?? child.boxW) : NULL_W
    if (child) {
      place(child, cursor, depth + 1, widths, nulls)
      centres.push(child.cx)
    } else {
      const cx = cursor + width / 2
      centres.push(cx)
      nulls.push({ x: cx, y: (depth + 1) * LEVEL_H + 7, parent: tree })
    }
    cursor += width + GAP
  }

  tree.cx = (centres[0] + centres[centres.length - 1]) / 2
}

/** Walk order for the `traverse:` directive. */
function traversal(tree: TreeNode | null, order: string): TreeNode[] {
  const out: TreeNode[] = []
  if (!tree) return out

  if (order === 'level' || order === 'bfs') {
    const queue: TreeNode[] = [tree]
    while (queue.length) {
      const next = queue.shift()!
      out.push(next)
      for (const child of next.children) if (child) queue.push(child)
    }
    return out
  }

  const walk = (current: TreeNode): void => {
    const kids = current.children
    if (order === 'pre' || order === 'preorder' || order === 'dfs') out.push(current)
    // In-order on a node with more than two children is only defined for the
    // first child, so the rest follow the node — which is what an outline of a
    // parse tree wants anyway.
    if (kids[0]) walk(kids[0])
    if (order === 'in' || order === 'inorder') out.push(current)
    for (const child of kids.slice(1)) if (child) walk(child)
    if (order === 'post' || order === 'postorder') out.push(current)
  }
  walk(tree)
  return out
}

/**
 * Turn a fence's directives and body into a tree.
 *
 * Split out from the drawing so that `algo` can animate a traversal over the
 * same tree the `tree` fence would have drawn, from the same source lines.
 */
export function buildTree(
  directives: Map<string, string>,
  lines: Array<{ text: string; indent: number; n: number }>
): TreeNode {
  const unrolled = recurrenceOf(directives)
  if (unrolled) return fromRecurrence(unrolled.solved.sizes, unrolled.branch)

  const builders = (['bst', 'heap', 'level'] as const).filter((key) => directives.has(key))
  if (builders.length > 1) {
    throw new VizError(`pick one of ${builders.join(', ')} — they each describe the whole tree`)
  }

  const builder = builders[0]
  const tree =
    builder === 'bst'
      ? fromInsertions(items(directives.get('bst') ?? ''))
      : builder === 'heap'
        ? fromHeap(items(directives.get('heap') ?? ''))
        : builder === 'level'
          ? fromLevelOrder(items(directives.get('level') ?? ''))
          : fromOutline(lines)

  if (!tree) {
    throw new VizError(
      'nothing to draw. Give it an outline, or `bst: 5 3 8`, `heap: 9 7 8`, or `level: 1 2 3 . . 4 5`.'
    )
  }
  return tree
}

export interface TreeLayout {
  /** Every real node, in pre-order — the order badges and steps count in. */
  nodes: TreeNode[]
  /** The edges and empty-slot stubs, ready to drop in behind the nodes. */
  edges: SVGGElement
  width: number
  top: number
  bottom: number
}

/** Size every node, place it, and draw the lines between them. */
export function layoutTree(tree: TreeNode): TreeLayout {
  const widths = new Map<TreeNode, number>()
  const holes: Array<{ x: number; y: number; parent: TreeNode }> = []
  const width = measure(tree, widths)
  place(tree, 0, 0, widths, holes)

  // Depth comes out of the placement rather than a second walk over the tree.
  const nodes: TreeNode[] = []
  const collect = (current: TreeNode): void => {
    nodes.push(current)
    for (const child of current.children) if (child) collect(child)
  }
  collect(tree)

  const edges = svg('g', { class: 'viz-edges' })
  for (const parent of nodes) {
    for (const child of parent.children) {
      if (!child) continue
      const from = edgeFrom(parent, { x: child.cx, y: child.cy })
      const to = edgeTo(child, { x: parent.cx, y: parent.cy })
      edges.appendChild(
        svg('line', {
          class: `viz-edge${child.dim ? ' is-dim' : ''}`,
          x1: round(from.x),
          y1: round(from.y),
          x2: round(to.x),
          y2: round(to.y)
        })
      )
    }
  }

  // An empty slot: a short stub to a hollow square. Drawn, not omitted, because
  // "this child is missing" is a fact about the tree.
  for (const hole of holes) {
    const from = edgeFrom(hole.parent, { x: hole.x, y: hole.y })
    edges.appendChild(
      svg('line', {
        class: 'viz-edge is-dim',
        x1: round(from.x),
        y1: round(from.y),
        x2: round(hole.x),
        y2: round(hole.y - 6)
      })
    )
    edges.appendChild(
      svg('rect', { class: 'viz-node__hole', x: round(hole.x - 5), y: round(hole.y - 5), width: 10, height: 10, rx: 2 })
    )
  }

  return {
    nodes,
    edges,
    width,
    top: Math.min(...nodes.map((n) => n.cy - n.boxH / 2)),
    bottom: Math.max(...nodes.map((n) => n.cy + n.boxH / 2), ...holes.map((n) => n.y + 8))
  }
}

// ---------------------------------------------------------------------- draw

/** Where an edge meets a node, given the direction it comes from. */
function edgeTo(child: TreeNode, from: { x: number; y: number }): { x: number; y: number } {
  if (child.round) {
    const dx = child.cx - from.x
    const dy = child.cy - from.y
    const length = Math.hypot(dx, dy) || 1
    return { x: child.cx - (dx / length) * RADIUS, y: child.cy - (dy / length) * RADIUS }
  }
  return { x: child.cx, y: child.cy - child.boxH / 2 }
}

function edgeFrom(parent: TreeNode, to: { x: number; y: number }): { x: number; y: number } {
  if (parent.round) {
    const dx = to.x - parent.cx
    const dy = to.y - parent.cy
    const length = Math.hypot(dx, dy) || 1
    return { x: parent.cx + (dx / length) * RADIUS, y: parent.cy + (dy / length) * RADIUS }
  }
  return { x: parent.cx, y: parent.cy + parent.boxH / 2 }
}

export function drawTreeNode(tree: TreeNode): SVGGElement {
  const group = svg('g', {
    class: `viz-node${tree.highlight ? ' is-marked' : ''}${tree.dim ? ' is-dim' : ''}`,
    style: accentStyle(tree.accent)
  })

  if (tree.round) {
    group.appendChild(svg('circle', { class: 'viz-node__shape', cx: round(tree.cx), cy: round(tree.cy), r: RADIUS }))
  } else {
    group.appendChild(
      svg('rect', {
        class: 'viz-node__shape',
        x: round(tree.cx - tree.boxW / 2),
        y: round(tree.cy - tree.boxH / 2),
        width: round(tree.boxW),
        height: round(tree.boxH),
        rx: 6
      })
    )
  }

  const room = tree.boxW - 10
  if (tree.sub) {
    group.appendChild(label(ellipsize(tree.label, LABEL_SIZE, room), round(tree.cx), round(tree.cy - 6), 'viz-node__label', LABEL_SIZE))
    group.appendChild(label(ellipsize(tree.sub, SUB_SIZE, room), round(tree.cx), round(tree.cy + 10), 'viz-node__sub', SUB_SIZE))
  } else {
    group.appendChild(label(ellipsize(tree.label, LABEL_SIZE, room), round(tree.cx), round(tree.cy), 'viz-node__label', LABEL_SIZE))
  }

  if (tree.order !== undefined) {
    const bx = tree.cx + (tree.round ? RADIUS : tree.boxW / 2) - 3
    const by = tree.cy - (tree.round ? RADIUS : tree.boxH / 2) + 2
    group.appendChild(svg('circle', { class: 'viz-badge__disc', cx: round(bx), cy: round(by), r: 8 }))
    group.appendChild(label(String(tree.order), round(bx), round(by), 'viz-badge__text', 9))
  }

  return group
}

export interface Figure {
  root: SVGSVGElement
  /** Drawn above the figure as HTML, not inside the SVG — see `viz/index`. */
  title?: string
  caption?: string
}

/**
 * Where each level of the tree sits vertically.
 *
 * Taken from the nodes rather than from the depth arithmetic, so a level whose
 * nodes are taller than the rest — one carrying a sub-label — still has its
 * cost written down beside the middle of it.
 */
function levelRows(tree: TreeNode): number[] {
  const rows: number[][] = []
  const walk = (current: TreeNode, depth: number): void => {
    ;(rows[depth] ??= []).push(current.cy)
    for (const child of current.children) if (child) walk(child, depth + 1)
  }
  walk(tree, 0)
  return rows.map((row) => row.reduce((sum, one) => sum + one, 0) / row.length)
}

const COST_SIZE = 11
const COST_GAP = 22

/**
 * The column down the right-hand side: what each level costs, and the sum.
 *
 * A leader runs from the tree to each figure because the column is far enough
 * away to be a separate thing, and a number in the margin that the reader has
 * to guess the owner of is worse than no number. The rule above the total is
 * the one every worked solution draws, and it is doing real work: it says the
 * thing below is a sum of the things above, which is the entire argument.
 */
function costColumn(rows: number[], costs: string[], total: string | undefined): { group: SVGGElement; width: number; bottom: number } {
  const group = svg('g', { class: 'viz-cost' })
  const shown = Math.min(rows.length, costs.length)
  const widest = Math.max(
    ...costs.slice(0, shown).map((one) => textWidth(one, COST_SIZE)),
    total ? textWidth(total, COST_SIZE) : 0
  )

  for (let level = 0; level < shown; level++) {
    const y = rows[level]
    group.appendChild(
      svg('line', { class: 'viz-cost__leader', x1: 0, y1: round(y), x2: round(COST_GAP - 6), y2: round(y) })
    )
    group.appendChild(label(costs[level], COST_GAP, round(y), 'viz-cost__value', COST_SIZE, 'start'))
  }

  let bottom = rows[shown - 1] ?? 0
  if (total) {
    const rule = bottom + 20
    group.appendChild(
      svg('line', {
        class: 'viz-cost__rule',
        x1: COST_GAP,
        y1: round(rule),
        x2: round(COST_GAP + widest),
        y2: round(rule)
      })
    )
    group.appendChild(label(total, COST_GAP, round(rule + 14), 'viz-cost__total', COST_SIZE, 'start'))
    bottom = rule + 22
  }

  return { group, width: COST_GAP + widest, bottom }
}

// ------------------------------------------------------------------ rotation

function cloneTree(node: TreeNode): TreeNode {
  return { ...node, children: node.children.map((child) => (child ? cloneTree(child) : child)) }
}

/**
 * One rotation, about the node named.
 *
 * The operation every balanced tree is built out of, and the one that is
 * hardest to believe from a description: three pointers move, the in-order
 * sequence does not change, and the depth of one side falls by one. Written
 * down it is four lines of pointer surgery; drawn as a before and an after it
 * is obvious, which is why this is a directive rather than something to be
 * assembled out of two blocks that could drift apart.
 */
function rotate(node: TreeNode, direction: 'left' | 'right'): TreeNode {
  // A right rotation lifts the left child; a left rotation mirrors it.
  const up = direction === 'right' ? 0 : 1
  const down = 1 - up
  const pivot = node.children[up]
  if (!pivot) {
    throw new VizError(
      `\`${node.label}\` has no ${direction === 'right' ? 'left' : 'right'} child, so it cannot rotate ${direction}`
    )
  }
  node.children[up] = pivot.children[down] ?? null
  pivot.children[down] = node
  // Both ends of the moved edge are ringed, because the question a reader has
  // is which two nodes swapped places.
  node.highlight = true
  pivot.highlight = true
  return pivot
}

function rotateAt(node: TreeNode, name: string, direction: 'left' | 'right'): TreeNode {
  if (node.label === name) return rotate(node, direction)
  node.children = node.children.map((child) => (child ? rotateAt(child, name, direction) : child))
  return node
}

/** `rotate: right 5` — the tree, and the same tree after that rotation. */
function readRotation(written: string): { direction: 'left' | 'right'; name: string } {
  const parts = items(written)
  const direction = parts.find((one) => /^(left|right)$/i.test(one))?.toLowerCase()
  const name = parts.find((one) => !/^(left|right|about|at|on)$/i.test(one))
  if (!direction || !name) {
    throw new VizError('`rotate:` wants a direction and a node — `rotate: right 5`')
  }
  return { direction: direction as 'left' | 'right', name }
}

/**
 * The before and the after, side by side under one arrow.
 *
 * Laid out as two independent trees rather than as one figure with a gap: the
 * whole point is that the second is a different shape, and a shared layout
 * would hold columns in common that the rotation was supposed to move.
 */
function drawRotation(tree: TreeNode, written: string, title: string | undefined): Figure {
  const { direction, name } = readRotation(written)
  if (!has(tree, name)) throw new VizError(`there is no node called \`${name}\` in this tree`)

  const before = cloneTree(tree)
  // Ringed on the left as well as the right, so the eye starts in the same
  // place in both halves and the move is between two marked pairs.
  markPair(before, name, direction)
  const after = rotateAt(cloneTree(tree), name, direction)

  const GUTTER = 64
  const left = layoutTree(before)
  const right = layoutTree(after)

  const leftNodes = svg('g', { class: 'viz-nodes' })
  for (const one of left.nodes) leftNodes.appendChild(drawTreeNode(one))
  const rightNodes = svg('g', { class: 'viz-nodes' })
  for (const one of right.nodes) rightNodes.appendChild(drawTreeNode(one))

  const { defs, arrow } = arrowDefs()
  const shift = left.width + GUTTER
  const rightSide = svg('g', { transform: `translate(${round(shift)} 0)` }, [right.edges, rightNodes])

  const top = Math.min(left.top, right.top)
  const bottom = Math.max(left.bottom, right.bottom)
  const middle = (top + bottom) / 2
  const link = svg('path', {
    class: 'viz-edge',
    d: `M ${round(left.width + 14)} ${round(middle)} L ${round(left.width + GUTTER - 14)} ${round(middle)}`,
    'marker-end': arrow
  })
  const legend = label(
    `${direction} about ${name}`,
    round(left.width + GUTTER / 2),
    round(middle - 14),
    'viz-node__sub',
    SUB_SIZE
  )

  const width = shift + right.width
  const view = { x: -PAD, y: top - PAD - 12, w: width + PAD * 2, h: bottom - top + PAD * 2 + 12 }
  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`,
      width: round(view.w),
      height: round(view.h),
      role: 'img',
      'aria-label': `A ${direction} rotation about ${name}`
    },
    [defs, left.edges, leftNodes, rightSide, link, legend]
  )

  return { root, title, caption: undefined }
}

/** Whether a node with this label is anywhere in the tree. */
function has(node: TreeNode, name: string): boolean {
  if (node.label === name) return true
  return node.children.some((child) => (child ? has(child, name) : false))
}

/** Ring the node about to move, and the child that will take its place. */
function markPair(node: TreeNode, name: string, direction: 'left' | 'right'): void {
  if (node.label === name) {
    node.highlight = true
    const child = node.children[direction === 'right' ? 0 : 1]
    if (child) child.highlight = true
    return
  }
  for (const child of node.children) if (child) markPair(child, name, direction)
}

export function drawTree(source: string): Figure {
  const { directives, lines } = readSource(source, TREE_KEYS)

  const tree = buildTree(directives, lines)

  // A rotation is two trees, so it leaves before the single-figure path below
  // has laid anything out.
  const turn = directives.get('rotate')
  if (turn !== undefined) return drawRotation(tree, turn, directives.get('title'))

  const unrolled = recurrenceOf(directives)

  const order = directives.get('traverse')?.toLowerCase()
  let caption = directives.get('caption')
  if (order) {
    const walk = traversal(tree, order)
    walk.forEach((visited, index) => {
      visited.order = index + 1
    })
    caption = caption ?? `${order.replace(/order$/, '')}-order: ${walk.map((n) => n.label).join(' → ')}`
  }

  const { nodes: all, width, top, bottom, edges } = layoutTree(tree)
  const { defs } = arrowDefs()
  const shapes = svg('g', { class: 'viz-nodes' })
  for (const one of all) shapes.appendChild(drawTreeNode(one))

  // `cost:` written out wins over a solved recurrence, so a block can keep the
  // generated tree and say something the algebra could not — the levels of a
  // recurrence whose cost has a log in it, most often.
  const written = directives.get('cost')
  const costs = written !== undefined ? written.split(',').map((one) => one.trim()) : unrolled?.solved.costs
  const total = directives.get('total') ?? (written === undefined ? unrolled?.solved.total : undefined)
  const column = costs?.length ? costColumn(levelRows(tree), costs, total) : null
  if (column) shapes.appendChild(column.group)
  if (column) column.group.setAttribute('transform', `translate(${round(width + 8)} 0)`)
  if (unrolled && !caption) caption = unrolled.solved.reason

  const title = directives.get('title') ?? (unrolled ? `T(n) = ${unrolled.source.replace(/^\s*T\s*\(\s*n\s*\)\s*=\s*/i, '')}` : undefined)
  const view = {
    x: -PAD,
    y: top - PAD,
    w: width + (column ? column.width + 8 : 0) + PAD * 2,
    h: Math.max(bottom, column?.bottom ?? 0) - top + PAD * 2
  }

  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`,
      width: round(view.w),
      height: round(view.h),
      role: 'img',
      'aria-label': title ? `Tree: ${title}` : 'Tree diagram'
    },
    [defs, edges, shapes]
  )

  return { root, title, caption }
}

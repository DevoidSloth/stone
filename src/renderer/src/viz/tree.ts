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

export const TREE_KEYS = ['title', 'bst', 'heap', 'level', 'traverse', 'caption'] as const

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

function node(from: Annotated): TreeNode {
  const width = textWidth(from.label, LABEL_SIZE)
  const subWidth = from.sub ? textWidth(from.sub, SUB_SIZE) : 0
  // A short label gets a circle, which is what a tree of numbers is drawn with
  // everywhere; anything longer gets a box, because a circle wide enough for
  // `left_child` is a stadium and reads as a state machine.
  const isRound = from.label.length <= 3 && !from.sub
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

export function drawTree(source: string): Figure {
  const { directives, lines } = readSource(source, TREE_KEYS)

  const tree = buildTree(directives, lines)

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

  const title = directives.get('title')
  const view = { x: -PAD, y: top - PAD, w: width + PAD * 2, h: bottom - top + PAD * 2 }

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

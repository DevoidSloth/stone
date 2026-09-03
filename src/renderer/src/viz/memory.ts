/**
 * The `memory` fence: what the machine is actually holding.
 *
 * This is the picture that gets drawn on a whiteboard more than any other and
 * that no diagram language will draw for you — boxes with named fields, a stack
 * of frames on the left, objects on the heap on the right, and arrows for the
 * pointers between them. Reversing a linked list, a tree rotation, why two
 * variables changed together, what a shallow copy did: all of it is this
 * picture.
 *
 * Two choices do most of the work. Sections are `stack:` and `heap:` rather
 * than free-floating boxes, because the split between "lives until this
 * function returns" and "lives until someone frees it" is the thing being
 * taught. And the heap lays itself out by following its own pointers, so a
 * chain of nodes comes out as a chain across the page rather than a column with
 * arrows curling back on themselves — which means a linked list looks like a
 * linked list without anyone positioning anything.
 */

import { accentStyle, arrowDefs, elbow, ellipsize, label, round, svg, textWidth, underpass, wire } from './svg'
import { annotate, items, readSource, VizError } from './source'
import type { Figure } from './tree'

export const MEMORY_KEYS = ['title', 'caption', 'list', 'pairs', 'array'] as const

/**
 * The two dialects this module draws.
 *
 * `regions` is the memory diagram: a stack on the left, a heap on the right,
 * and the boundary between them drawn, because for C-shaped teaching that
 * boundary is the lesson.
 *
 * `objects` is the object diagram — what people mean by "box and pointer" about
 * a Java or Python program. There is no stack and no heap in it, every box is
 * titled with its *type*, and a list carries its length above its elements.
 * Nothing about where the memory lives; everything about what refers to what.
 */
export type Style = 'regions' | 'objects'

/** Where a pointer points: an object, one cell of an array, or nowhere. */
interface Target {
  id: string
  index?: number
  /** The source line, so a typo can be reported against it. */
  line: number
}

interface Field {
  name: string
  /** A scalar's text. Absent on a pointer and on an uninitialised slot. */
  value?: string
  pointer?: Target
  /** A pointer written as `null`, drawn as a struck-through slot. */
  nil?: boolean
  accent?: string
  highlight?: boolean
  dim?: boolean
  /** Filled in during layout. */
  y: number
}

/**
 * One slot of an array box.
 *
 * A slot holding a pointer is not a nicety: a hash table is an array of chain
 * heads and an adjacency list is an array of list heads, and neither can be
 * drawn at all if a cell can only hold text.
 */
interface Cell {
  text: string
  pointer?: Target
  nil?: boolean
}

interface Box {
  id: string
  /** `main()`, `n1`, `Globals`. */
  title: string
  /** A type name shown in grey beside the title: `Node`, `int[4]`. */
  type?: string
  region: 'stack' | 'heap' | 'globals'
  fields: Field[]
  /** An array box holds cells instead of fields. */
  cells?: Cell[]
  /**
   * Drawn as a column of element rows rather than a strip of slots.
   *
   * The two are the same data and a different picture. A strip says "these sit
   * next to each other in memory", which is what an array in a memory diagram
   * is for. A column says "this is a list of references", which is what an
   * object diagram wants — and it is the only shape that leaves room for a
   * pointer to leave every element.
   */
  list?: boolean
  /** A named slot with one pointer out of it: drawn small, name outside. */
  variable?: boolean
  /**
   * Whether the slots are numbered underneath.
   *
   * An array's indices are half of what the picture says. A pair's are noise:
   * nobody calls the `cdr` "slot 1", and two digits under every cons cell is
   * the difference between a diagram and a diagram with clutter on it.
   */
  indexed?: boolean
  accent?: string
  highlight?: boolean
  dim?: boolean
  line: number

  // Layout.
  x: number
  y: number
  w: number
  h: number
  col: number
  row: number
}

const NAME_SIZE = 11
const VALUE_SIZE = 11
const TITLE_SIZE = 11
const ROW_H = 22
const TITLE_H = 26
const CELL_W = 34
const CELL_H = 26
const INDEX_H = 14
const BOX_PAD = 10
const BOX_GAP = 16
const COL_GAP = 54
const GUTTER = 76
const REGION_LABEL_H = 22
const PAD = 16
const MIN_BOX_W = 92

// ------------------------------------------------------------------- parsing

/** `n2`, `arr[3]`, `null`. */
function parseTarget(raw: string, line: number): Target | null {
  const text = raw.trim()
  if (/^(null|nil|none|0|nullptr|undefined)$/i.test(text)) return null
  const cell = /^([A-Za-z_$][\w$]*)\s*\[\s*(\d+)\s*\]$/.exec(text)
  if (cell) return { id: cell[1], index: Number(cell[2]), line }
  const plain = /^([A-Za-z_$][\w$]*)$/.exec(text)
  if (!plain) throw new VizError(`\`${text}\` is not the name of a box`, line)
  return { id: plain[1], line }
}

/**
 * One field of one box.
 *
 * `->` is a pointer and `=` or `:` is a value, but a value that reads `null`
 * gets drawn as a null pointer too — a struck slot is the right picture for
 * `next = NULL` however the source spelled it, and insisting on the arrow form
 * would be a rule with nothing behind it.
 */
function parseField(text: string, line: number): Field {
  const arrow = text.indexOf('->')
  if (arrow >= 0) {
    const name = text.slice(0, arrow).trim()
    const rest = annotate(text.slice(arrow + 2))
    if (!name) throw new VizError('a pointer needs a name on its left', line)
    const target = parseTarget(rest.label, line)
    return {
      name,
      pointer: target ?? undefined,
      nil: target === null,
      accent: rest.accent,
      highlight: rest.highlight,
      dim: rest.dim,
      y: 0
    }
  }

  const split = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(text)
  if (!split) {
    // A bare name is a slot that exists and holds nothing yet, which is worth
    // being able to draw: it is the state a variable is in before assignment.
    const bare = annotate(text)
    return { name: bare.label, accent: bare.accent, highlight: bare.highlight, dim: bare.dim, y: 0 }
  }

  const value = annotate(split[2])
  const nil = /^(null|nil|none|nullptr|undefined)$/i.test(value.label)
  return {
    name: split[1].trim(),
    value: nil ? undefined : value.label,
    nil,
    accent: value.accent,
    highlight: value.highlight,
    dim: value.dim,
    y: 0
  }
}

/** `1`, `->n2`, `&n2`, or an empty slot written `.`. */
function parseCell(raw: string, line: number): Cell {
  const text = raw.trim()
  const arrow = /^(->|&)\s*(.*)$/.exec(text)
  if (arrow) {
    const target = parseTarget(arrow[2], line)
    return target ? { text: '', pointer: target } : { text: '', nil: true }
  }
  if (/^(null|nil|none|\.|_)$/i.test(text)) return { text: '', nil: true }
  return { text }
}

/** Everywhere a box points from, whether that is a field row or an array slot. */
function outgoing(box: Box): Target[] {
  const out: Target[] = []
  for (const field of box.fields) if (field.pointer) out.push(field.pointer)
  for (const cell of box.cells ?? []) if (cell.pointer) out.push(cell.pointer)
  return out
}

/** Field names that mean "the rest of the structure", in any of the dialects. */
const SPINE = new Set(['next', 'cdr', 'tail', 'rest', 'link', 'succ', 'after', 'down'])

/**
 * The same pointers, spine first.
 *
 * The layout gives its row to whichever pointer comes first, so which one that
 * is decides whether a structure reads along the page or down it. A field
 * called `next` or `cdr` is the spine by name. Failing that, the last slot of a
 * pair is — a cons cell is value-then-link, and the link is what carries on.
 * Everything else keeps declaration order, which leaves a tree's `left` and
 * `right` alone: neither is a spine and the first one is as good as either.
 */
function spineOrder(box: Box): Target[] {
  const all = outgoing(box)
  if (all.length < 2) return all

  const named = box.fields.find((field) => field.pointer && SPINE.has(field.name.toLowerCase()))
  // The last-slot rule is about cons cells, so it applies to a pair and not to
  // a list: the tenth element of an array is not the continuation of anything,
  // and giving it the row would put the first nine underneath it.
  const pair = box.cells?.length === 2 && !box.list
  const spine =
    named?.pointer ??
    (pair ? [...box.cells!].reverse().find((cell) => cell.pointer)?.pointer : undefined)
  if (!spine) return all
  return [spine, ...all.filter((target) => target !== spine)]
}

const SECTIONS: Record<string, Box['region']> = {
  stack: 'stack',
  frames: 'stack',
  heap: 'heap',
  objects: 'heap',
  globals: 'globals',
  static: 'globals',
  global: 'globals'
}

function newBox(id: string, title: string, region: Box['region'], line: number): Box {
  return {
    id,
    title,
    region,
    fields: [],
    line,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    col: 0,
    row: 0
  }
}

/**
 * Read the body into boxes.
 *
 * The grammar is small enough to read off the indentation: a section at the
 * left margin, a box inside it, fields inside that. A box may also write its
 * fields inline in braces, which is how a three-field node wants to be written;
 * an array writes its cells in brackets.
 */
function parseBoxes(
  lines: Array<{ text: string; indent: number; n: number }>,
  style: Style
): Box[] {
  const boxes: Box[] = []
  let region: Box['region'] = 'heap'
  let sectionIndent = -1
  let current: Box | null = null
  let boxIndent = Infinity

  for (const line of lines) {
    const section = /^([A-Za-z]+)\s*:$/.exec(line.text)
    if (style === 'objects' && section && SECTIONS[section[1].toLowerCase()]) {
      throw new VizError(
        `an object diagram has no ${section[1].toLowerCase()} — it says what refers to what, not where it lives. Use a \`memory\` block for that.`,
        line.n
      )
    }
    if (section && SECTIONS[section[1].toLowerCase()] && line.indent <= Math.max(0, sectionIndent)) {
      region = SECTIONS[section[1].toLowerCase()]
      sectionIndent = line.indent
      current = null
      boxIndent = Infinity
      // A `globals:` section is one box with its variables in it, not a set of
      // boxes — that is what a global actually is.
      if (region === 'globals') {
        current = newBox('__globals', 'Globals', 'globals', line.n)
        boxes.push(current)
        boxIndent = line.indent
      }
      continue
    }

    if (current && line.indent > boxIndent) {
      current.fields.push(parseField(line.text, line.n))
      continue
    }

    // In an object diagram a bare `name -> target` at the margin is a
    // variable: the little box off to one side that the whole picture hangs
    // from. Anywhere else it would be a field, so it is only read this way
    // when there is no box open to attach it to.
    if (style === 'objects' && !current && /^[A-Za-z_$][\w$]*\s*->/.test(line.text) && !/[{[(]/.test(line.text)) {
      const field = parseField(line.text, line.n)
      const box = newBox(field.name, field.name, 'stack', line.n)
      box.variable = true
      box.fields.push({ ...field, name: '' })
      boxes.push(box)
      current = null
      boxIndent = Infinity
      continue
    }

    // Anything else opens a box. In a stack section that is a frame; elsewhere
    // it is an object.
    const inline = /^(.*?)\s*\{(.*)\}\s*$/.exec(line.text)
    // Greedy up to the *last* bracket group, and no bracket inside it. A type
    // is very often `Int[]` or `Int[][]`, and a lazy match would take the
    // type's own brackets for the slot list and shred both.
    const cells = /^(.*)\s*\[([^[]*)\]\s*$/.exec(line.text)
    // `p1 ( 1, ->p2 )` is a pair: the same row of slots an array gets, without
    // the numbers under it. The space before the bracket is what keeps it apart
    // from a stack frame called `push(x)`, which is a name and not a box of
    // two slots.
    const pair = /^(\S.*)\s+\(([^(]*)\)\s*$/.exec(line.text)
    const head = annotate((inline?.[1] ?? cells?.[1] ?? pair?.[1] ?? line.text).replace(/:$/, '').trim())
    if (!head.label) throw new VizError('a box needs a name', line.n)

    // `n1 Node` — the last word is a type when there is more than one and it
    // looks like a type. `push(x)` stays whole: a frame is named by its call.
    let id = head.label
    let type: string | undefined
    const typed = /^(\S+)\s+(.+)$/.exec(head.label)
    if (typed && !head.label.includes('(')) {
      id = typed[1]
      type = typed[2]
    }

    const box = newBox(id, id, region === 'globals' ? 'heap' : region, line.n)
    box.type = type ?? head.sub
    box.accent = head.accent
    box.highlight = head.highlight
    box.dim = head.dim

    if (cells) {
      box.cells = items(cells[2]).map((cell) => parseCell(cell, line.n))
      // A list in an object diagram is a column with its length on top; in a
      // memory diagram it is a numbered strip of adjacent slots.
      if (style === 'objects') box.list = true
      else box.indexed = true
    } else if (pair) {
      box.cells = items(pair[2]).map((cell) => parseCell(cell, line.n))
    } else if (inline) {
      for (const part of splitFields(inline[2])) box.fields.push(parseField(part, line.n))
    }

    boxes.push(box)
    current = box
    boxIndent = line.indent
  }

  return boxes
}

/** Split `val: 1, next -> n2` on commas that are not inside brackets. */
function splitFields(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '[' || ch === '(' || ch === '{') depth++
    if (ch === ']' || ch === ')' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/**
 * `pairs: 1 2 3` — a cons list, one line.
 *
 * The same chain `list:` builds, in the other notation: two slots to a box, the
 * value on the left and the link on the right, the last one struck through.
 * Writing it out by hand is six lines and a set of ids to keep straight, which
 * is six lines and a set of ids more than the picture is worth.
 */
function pairBoxes(values: string[], line: number): Box[] {
  return values.map((value, index) => {
    const box = newBox(`p${index + 1}`, `p${index + 1}`, 'heap', line)
    const next = index + 1 < values.length ? `p${index + 2}` : null
    box.cells = [
      { text: value },
      next ? { text: '', pointer: { id: next, line } } : { text: '', nil: true }
    ]
    return box
  })
}

/** `list: 1 2 3` — the chain everybody draws, without writing it out. */
function listBoxes(values: string[], line: number): Box[] {
  return values.map((value, index) => {
    const box = newBox(`n${index + 1}`, `n${index + 1}`, 'heap', line)
    box.type = 'Node'
    box.fields.push({ name: 'val', value, y: 0 })
    const next = index + 1 < values.length ? `n${index + 2}` : null
    box.fields.push(
      next
        ? { name: 'next', pointer: { id: next, line }, y: 0 }
        : { name: 'next', nil: true, y: 0 }
    )
    return box
  })
}

// -------------------------------------------------------------------- layout

const VAR_W = 58
const VAR_H = 28

function sizeBox(box: Box, style: Style): void {
  // In an object diagram the type is the title, centred, and the id is only a
  // handle for wiring the arrows up — the picture never shows it, because in
  // the program there is no such name. The memory diagram shows the id, since
  // there the box *is* `n1`.
  const heading = style === 'objects' ? (box.type ?? box.title) : box.title
  const titleW =
    style === 'objects'
      ? textWidth(heading, TITLE_SIZE)
      : textWidth(box.title, TITLE_SIZE) + (box.type ? textWidth(` ${box.type}`, NAME_SIZE) : 0)

  if (box.variable) {
    box.w = VAR_W
    box.h = VAR_H
    return
  }

  if (box.list) {
    let widest = 0
    for (const cell of box.cells ?? []) widest = Math.max(widest, textWidth(cell.text, VALUE_SIZE) + 26)
    box.w = Math.max(MIN_BOX_W, titleW + BOX_PAD * 2, widest + BOX_PAD * 2)
    // Type, then length, then one row per element — the order the sketch of
    // one of these is always drawn in.
    box.h = TITLE_H + ROW_H + (box.cells?.length ?? 0) * ROW_H + 4
    return
  }

  if (box.cells) {
    box.w = Math.max(MIN_BOX_W, titleW + BOX_PAD * 2, box.cells.length * CELL_W + BOX_PAD * 2)
    box.h = TITLE_H + CELL_H + (box.indexed ? INDEX_H : 0) + BOX_PAD
    return
  }

  let widest = 0
  for (const field of box.fields) {
    const value = field.pointer ? '' : (field.value ?? '')
    widest = Math.max(widest, textWidth(field.name, NAME_SIZE) + textWidth(value, VALUE_SIZE) + 26)
  }
  box.w = Math.max(MIN_BOX_W, titleW + BOX_PAD * 2, widest + BOX_PAD * 2)
  box.h = TITLE_H + Math.max(1, box.fields.length) * ROW_H + 4
}

/** The y of each element row of a list, once the box has a position. */
function listRowY(box: Box, index: number): number {
  return box.y + TITLE_H + ROW_H + index * ROW_H + ROW_H / 2
}

/**
 * Lay the heap out along its own pointers.
 *
 * Objects that nothing else in the heap points at start a row; each object's
 * first onward pointer continues its row, and any further pointers start new
 * ones. That single rule turns a linked list into a row, a binary tree into a
 * fan, and a lone struct into a box — with no positions in the source.
 *
 * A cycle terminates because a box is only ever placed once.
 */
function layoutHeap(heap: Box[], byId: Map<string, Box>): { width: number; height: number } {
  const pointedAt = new Set<string>()
  for (const box of heap) {
    for (const target of outgoing(box)) {
      if (byId.get(target.id)?.region === 'heap') pointedAt.add(target.id)
    }
  }

  const placed = new Set<Box>()
  let nextRow = 0

  const walk = (box: Box, col: number, row: number): void => {
    if (placed.has(box)) return
    placed.add(box)
    box.col = col
    box.row = row
    let first = true
    for (const pointer of spineOrder(box)) {
      const target = byId.get(pointer.id)
      if (!target || target.region !== 'heap' || placed.has(target)) continue
      if (first) {
        walk(target, col + 1, row)
        first = false
      } else {
        walk(target, col + 1, ++nextRow)
      }
    }
  }

  for (const box of heap) {
    if (!pointedAt.has(box.id)) walk(box, 0, nextRow++)
  }
  // Anything left is inside a cycle with no entry point; give it its own row.
  for (const box of heap) if (!placed.has(box)) walk(box, 0, nextRow++)

  const colWidth: number[] = []
  const rowHeight: number[] = []
  for (const box of heap) {
    colWidth[box.col] = Math.max(colWidth[box.col] ?? 0, box.w)
    rowHeight[box.row] = Math.max(rowHeight[box.row] ?? 0, box.h)
  }

  const colX: number[] = []
  let x = 0
  colWidth.forEach((width, index) => {
    colX[index] = x
    x += (width ?? 0) + COL_GAP
  })

  const rowY: number[] = []
  let y = 0
  rowHeight.forEach((height, index) => {
    rowY[index] = y
    y += (height ?? 0) + BOX_GAP
  })

  for (const box of heap) {
    box.x = colX[box.col]
    // Centred in its row, so a two-field node beside a five-field one lines up
    // on its middle rather than hanging off the top.
    box.y = rowY[box.row] + ((rowHeight[box.row] ?? box.h) - box.h) / 2
  }

  return { width: Math.max(0, x - COL_GAP), height: Math.max(0, y - BOX_GAP) }
}

/** The y of each field row, once the box has a position. */
function placeFields(box: Box): void {
  box.fields.forEach((field, index) => {
    // A variable has no title row and exactly one slot, and that slot is the
    // whole box — so its wire leaves from the middle rather than from where a
    // first field row would have been, which is below the box entirely.
    field.y = box.variable ? box.y + box.h / 2 : box.y + TITLE_H + index * ROW_H + ROW_H / 2
  })
}

// ---------------------------------------------------------------------- draw

function drawBox(box: Box, style: Style): SVGGElement {
  const classes = ['viz-box', `viz-box--${box.region}`]
  if (box.highlight) classes.push('is-marked')
  if (box.dim) classes.push('is-dim')

  const group = svg('g', { class: classes.join(' '), style: accentStyle(box.accent) })
  group.appendChild(
    svg('rect', { class: 'viz-box__shape', x: round(box.x), y: round(box.y), width: round(box.w), height: round(box.h), rx: 7 })
  )

  // A variable is a box with nothing written in it and its name alongside —
  // the name is not stored in the box, it is what the box is called.
  if (box.variable) {
    group.appendChild(
      label(
        ellipsize(box.title, NAME_SIZE, 90),
        round(box.x - 9),
        round(box.y + box.h / 2),
        'viz-var__name',
        NAME_SIZE,
        'end'
      )
    )
    const field = box.fields[0]
    if (field?.pointer) {
      group.appendChild(svg('circle', { class: 'viz-row__stud', cx: round(box.x + box.w / 2), cy: round(box.y + box.h / 2), r: 3 }))
    } else if (field?.nil) {
      group.appendChild(
        svg('line', {
          class: 'viz-row__strike',
          x1: round(box.x + 10),
          y1: round(box.y + box.h - 8),
          x2: round(box.x + box.w - 10),
          y2: round(box.y + 8)
        })
      )
    }
    return group
  }

  const rule = (y: number): void => {
    group.appendChild(
      svg('line', { class: 'viz-box__rule', x1: round(box.x), y1: round(y), x2: round(box.x + box.w), y2: round(y) })
    )
  }
  rule(box.y + TITLE_H)

  const titleY = box.y + TITLE_H / 2
  if (style === 'objects') {
    // Type, centred. Everything below it is contents; the heading says what
    // kind of thing the contents belong to.
    group.appendChild(
      label(
        ellipsize(box.type ?? box.title, TITLE_SIZE, box.w - BOX_PAD * 2),
        round(box.x + box.w / 2),
        round(titleY),
        'viz-box__title',
        TITLE_SIZE
      )
    )
  } else {
    group.appendChild(
      label(ellipsize(box.title, TITLE_SIZE, box.w - BOX_PAD * 2), round(box.x + BOX_PAD), round(titleY), 'viz-box__title', TITLE_SIZE, 'start')
    )
    if (box.type) {
      group.appendChild(
        label(
          ellipsize(box.type, NAME_SIZE, box.w / 2),
          round(box.x + box.w - BOX_PAD),
          round(titleY),
          'viz-box__type',
          NAME_SIZE,
          'end'
        )
      )
    }
  }

  // A list: the count, then one row an element.
  if (box.list) {
    const cells = box.cells ?? []
    rule(box.y + TITLE_H + ROW_H)
    group.appendChild(
      label(String(cells.length), round(box.x + box.w / 2), round(box.y + TITLE_H + ROW_H / 2), 'viz-box__count', VALUE_SIZE)
    )
    cells.forEach((cell, index) => {
      const y = listRowY(box, index)
      if (index > 0) rule(y - ROW_H / 2)
      if (cell.nil) {
        const x2 = box.x + box.w - BOX_PAD
        group.appendChild(
          svg('line', { class: 'viz-row__strike', x1: round(x2 - 20), y1: round(y + 7), x2: round(x2), y2: round(y - 7) })
        )
      } else if (cell.pointer) {
        group.appendChild(svg('circle', { class: 'viz-row__stud', cx: round(box.x + box.w - BOX_PAD - 3), cy: round(y), r: 3 }))
      } else {
        group.appendChild(
          label(ellipsize(cell.text, VALUE_SIZE, box.w - BOX_PAD * 2), round(box.x + box.w / 2), round(y), 'viz-row__value', VALUE_SIZE)
        )
      }
    })
    return group
  }

  if (box.cells) {
    const width = box.cells.length * CELL_W
    const left = box.x + (box.w - width) / 2
    const top = box.y + TITLE_H + 2
    box.cells.forEach((cell, index) => {
      const cx = left + index * CELL_W
      group.appendChild(
        svg('rect', { class: 'viz-cell__shape', x: round(cx), y: round(top), width: CELL_W, height: CELL_H })
      )
      if (cell.nil) {
        group.appendChild(
          svg('line', {
            class: 'viz-row__strike',
            x1: round(cx + 6),
            y1: round(top + CELL_H - 6),
            x2: round(cx + CELL_W - 6),
            y2: round(top + 6)
          })
        )
      } else if (cell.pointer) {
        group.appendChild(svg('circle', { class: 'viz-row__stud', cx: round(cx + CELL_W / 2), cy: round(top + CELL_H / 2), r: 3 }))
      } else {
        group.appendChild(
          label(ellipsize(cell.text, VALUE_SIZE, CELL_W - 6), round(cx + CELL_W / 2), round(top + CELL_H / 2), 'viz-cell__value', VALUE_SIZE)
        )
      }
      if (box.indexed) {
        group.appendChild(
          label(String(index), round(cx + CELL_W / 2), round(top + CELL_H + INDEX_H / 2), 'viz-cell__index', 9)
        )
      }
    })
    return group
  }

  box.fields.forEach((field) => {
    const rowClasses = ['viz-row']
    if (field.highlight) rowClasses.push('is-marked')
    if (field.dim) rowClasses.push('is-dim')
    const row = svg('g', { class: rowClasses.join(' '), style: accentStyle(field.accent) })

    if (field.highlight) {
      row.appendChild(
        svg('rect', {
          class: 'viz-row__wash',
          x: round(box.x + 1),
          y: round(field.y - ROW_H / 2),
          width: round(box.w - 2),
          height: ROW_H
        })
      )
    }

    row.appendChild(
      label(ellipsize(field.name, NAME_SIZE, box.w * 0.62), round(box.x + BOX_PAD), round(field.y), 'viz-row__name', NAME_SIZE, 'start')
    )

    if (field.nil) {
      // A struck slot. `∅` alone is too easy to read as a character in the
      // value, so the slot itself is crossed.
      const x2 = box.x + box.w - BOX_PAD
      const x1 = x2 - 20
      row.appendChild(
        svg('rect', { class: 'viz-row__nil', x: round(x1), y: round(field.y - 7), width: 20, height: 14, rx: 2 })
      )
      row.appendChild(
        svg('line', { class: 'viz-row__strike', x1: round(x1), y1: round(field.y + 7), x2: round(x2), y2: round(field.y - 7) })
      )
    } else if (field.pointer) {
      row.appendChild(svg('circle', { class: 'viz-row__stud', cx: round(box.x + box.w - BOX_PAD - 3), cy: round(field.y), r: 3 }))
    } else if (field.value !== undefined) {
      row.appendChild(
        label(
          ellipsize(field.value, VALUE_SIZE, box.w * 0.62),
          round(box.x + box.w - BOX_PAD),
          round(field.y),
          'viz-row__value',
          VALUE_SIZE,
          'end'
        )
      )
    }

    group.appendChild(row)
  })

  return group
}

/** Where a pointer arrow starts: the stud on the right of its field row. */
function fieldExit(box: Box, field: Field): { x: number; y: number } {
  if (box.variable) return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  return { x: box.x + box.w - BOX_PAD - 3, y: field.y }
}

/** The same, for an array slot: out of the bottom of the cell it sits in. */
function cellExit(box: Box, index: number): { x: number; y: number } {
  const width = (box.cells?.length ?? 0) * CELL_W
  const left = box.x + (box.w - width) / 2
  return { x: left + index * CELL_W + CELL_W / 2, y: box.y + TITLE_H + 2 + CELL_H }
}

/**
 * Where a pointer arrow lands.
 *
 * Normally the left edge of the target's title row, which is where the eye
 * expects a reference to a whole object to attach. A pointer into an array cell
 * lands on the top of that cell instead, because "the third element" is a fact
 * about a position and the arrow has to show which one.
 */
function boxEntry(box: Box, target: Target, from: { x: number; y: number }): { x: number; y: number } {
  if (target.index !== undefined && box.list && box.cells) {
    const index = Math.min(target.index, box.cells.length - 1)
    return { x: box.x, y: listRowY(box, index) }
  }
  if (target.index !== undefined && box.cells) {
    const width = box.cells.length * CELL_W
    const left = box.x + (box.w - width) / 2
    const index = Math.min(target.index, box.cells.length - 1)
    return { x: left + index * CELL_W + CELL_W / 2, y: box.y + TITLE_H + 2 }
  }
  // Enter from whichever side the arrow is coming from, so a back pointer does
  // not have to cross the box it is pointing at.
  const y = box.y + TITLE_H / 2
  return from.x > box.x + box.w ? { x: box.x + box.w, y } : { x: box.x, y }
}

export function drawMemory(source: string, style: Style = 'regions'): Figure {
  const { directives, lines } = readSource(source, MEMORY_KEYS)

  const boxes = parseBoxes(lines, style)
  if (directives.has('list')) boxes.push(...listBoxes(items(directives.get('list') ?? ''), 0))
  if (directives.has('pairs')) boxes.push(...pairBoxes(items(directives.get('pairs') ?? ''), 0))
  if (directives.has('array')) {
    const raw = directives.get('array') ?? ''
    const split = /^([^=]+)=(.*)$/.exec(raw)
    const box = newBox((split?.[1] ?? 'arr').trim(), (split?.[1] ?? 'arr').trim(), 'heap', 0)
    box.cells = items(split?.[2] ?? raw).map((cell) => parseCell(cell, 0))
    box.indexed = true
    box.type = `[${box.cells.length}]`
    boxes.push(box)
  }

  if (boxes.length === 0) {
    throw new VizError(
      style === 'objects'
        ? 'nothing to draw. Try `b -> board` for a variable and `board CBoard:` with its fields indented under it.'
        : 'nothing to draw. Try `stack:` and `heap:` sections, `pairs: 1 2 3` for a cons list, or `list: 1 2 3` for a chain of nodes.'
    )
  }

  const byId = new Map<string, Box>()
  for (const box of boxes) {
    if (byId.has(box.id)) throw new VizError(`there are two boxes called \`${box.id}\``, box.line)
    byId.set(box.id, box)
  }

  // Every pointer must land somewhere. Reporting the typo is the whole value of
  // checking: a diagram with a silently missing arrow reads as a diagram where
  // the pointer is genuinely unset.
  for (const box of boxes) {
    for (const field of box.fields) {
      if (field.pointer && !byId.has(field.pointer.id)) {
        const where = field.name ? `${box.id}.${field.name}` : box.id
        throw new VizError(`\`${where}\` points at \`${field.pointer.id}\`, which is not a box here`, field.pointer.line)
      }
    }
    for (const cell of box.cells ?? []) {
      if (cell.pointer && !byId.has(cell.pointer.id)) {
        throw new VizError(`\`${box.id}\` points at \`${cell.pointer.id}\`, which is not a box here`, cell.pointer.line)
      }
    }
  }

  for (const box of boxes) sizeBox(box, style)

  const left = boxes.filter((box) => box.region === 'stack' || box.region === 'globals')
  const heap = boxes.filter((box) => box.region === 'heap')

  // A variable's name is drawn outside its box, so the whole figure is pushed
  // right far enough for the longest of them to fit rather than being clipped
  // by the viewBox.
  const nameGutter = Math.max(
    0,
    ...left.filter((box) => box.variable).map((box) => textWidth(box.title, NAME_SIZE) + 14)
  )

  const leftW = Math.max(0, ...left.map((box) => box.w))
  let leftY = left.length ? REGION_LABEL_H : 0
  for (const box of left) {
    box.x = nameGutter
    box.y = leftY
    // A variable keeps its own small size; a stack frame is squared off with
    // the others in its column so the column reads as one thing.
    if (!box.variable) box.w = leftW
    leftY += box.h + BOX_GAP
  }
  const leftH = Math.max(0, leftY - BOX_GAP)

  const heapOrigin = left.length ? nameGutter + leftW + GUTTER : 0
  const heapSize = layoutHeap(heap, byId)
  const heapTop = heap.length ? REGION_LABEL_H : 0
  for (const box of heap) {
    box.x += heapOrigin
    box.y += heapTop
  }

  for (const box of boxes) placeFields(box)

  const width = heapOrigin + heapSize.width
  const height = Math.max(leftH, heapTop + heapSize.height)

  // How far below the boxes anything reaches. A wire routed underneath is the
  // only thing that leaves the block the boxes occupy, and the viewBox has to
  // grow for it or it draws over whatever follows the figure in the note.
  let underhang = 0

  const { defs, arrow } = arrowDefs()
  const regions = svg('g', { class: 'viz-regions' })
  const wires = svg('g', { class: 'viz-wires' })
  const shapes = svg('g', { class: 'viz-boxes' })

  // The outline starts a little above the first box and ends the same distance
  // below the last, so the two regions read as a pair even when one is taller.
  const REGION_PAD = 10
  const regionTop = REGION_LABEL_H - REGION_PAD
  if (style === 'objects') {
    // Nothing: no stack, no heap, no boundary to draw.
  } else if (left.length) {
    regions.appendChild(
      svg('rect', {
        class: 'viz-region',
        x: -8,
        y: round(regionTop),
        width: round(leftW + 16),
        height: round(leftH - REGION_LABEL_H + REGION_PAD * 2),
        rx: 8
      })
    )
    regions.appendChild(
      label(left.some((b) => b.region === 'stack') ? 'Stack' : 'Static', 0, round(regionTop - 9), 'viz-region__label', 10, 'start')
    )
  }
  if (heap.length && style !== 'objects') {
    regions.appendChild(
      svg('rect', {
        class: 'viz-region',
        x: round(heapOrigin - 12),
        y: round(regionTop),
        width: round(heapSize.width + 24),
        height: round(heapSize.height + REGION_PAD * 2),
        rx: 8
      })
    )
    regions.appendChild(label('Heap', round(heapOrigin - 4), round(regionTop - 9), 'viz-region__label', 10, 'start'))
  }

  for (const box of boxes) {
    box.cells?.forEach((cell, index) => {
      if (!cell.pointer) return
      const target = byId.get(cell.pointer.id)!

      // A list element is a row, so it behaves like a field: out of the right
      // edge and across. Only a strip of adjacent slots has to drop out of the
      // bottom, because its neighbours are in the way.
      if (box.list) {
        const start = { x: box.x + box.w - BOX_PAD - 3, y: listRowY(box, index) }
        const land = boxEntry(target, cell.pointer, start)
        const bow = land.x < start.x ? Math.max(20, Math.abs(land.y - start.y) * 0.25) : 0
        wires.appendChild(svg('path', { class: 'viz-wire', d: wire(start, land, bow), 'marker-end': arrow }))
        wires.appendChild(svg('circle', { class: 'viz-wire__tail', cx: round(start.x), cy: round(start.y), r: 2.5 }))
        return
      }

      const from = cellExit(box, index)
      // Forward, it drops out of the cell and turns into the target's side.
      // Backward — a cycle, a `prev` — it goes under everything in between and
      // comes up into the target's underside instead of crossing the row.
      const back = cell.pointer.index === undefined && target.x + target.w < from.x
      const to = back
        ? { x: target.x + target.w / 2, y: target.y + target.h }
        : boxEntry(target, cell.pointer, from)
      if (back) underhang = Math.max(underhang, from.y + 40)
      wires.appendChild(
        svg('path', { class: 'viz-wire', d: back ? underpass(from, to) : elbow(from, to), 'marker-end': arrow })
      )
      wires.appendChild(svg('circle', { class: 'viz-wire__tail', cx: round(from.x), cy: round(from.y), r: 2.5 }))
    })

    for (const field of box.fields) {
      if (!field.pointer) continue
      const target = byId.get(field.pointer.id)!
      const from = fieldExit(box, field)
      const to = boxEntry(target, field.pointer, from)
      // A pointer that goes backwards or straight down bows clear of the boxes
      // between its ends rather than drawing a line through them.
      const bow = to.x < from.x ? Math.max(20, Math.abs(to.y - from.y) * 0.25) : 0
      wires.appendChild(
        svg('path', {
          class: `viz-wire${field.dim ? ' is-dim' : ''}${field.highlight ? ' is-marked' : ''}`,
          style: accentStyle(field.accent),
          d: wire(from, to, bow),
          'marker-end': arrow
        })
      )
      wires.appendChild(svg('circle', { class: 'viz-wire__tail', cx: round(from.x), cy: round(from.y), r: 2.5 }))
    }
  }

  for (const box of boxes) shapes.appendChild(drawBox(box, style))

  const title = directives.get('title')
  const view = {
    x: -PAD - 12,
    y: -PAD - 10,
    w: width + PAD * 2 + 40,
    h: Math.max(height, underhang) + PAD * 2 + 10
  }

  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${round(view.x)} ${round(view.y)} ${round(view.w)} ${round(view.h)}`,
      width: round(view.w),
      height: round(view.h),
      role: 'img',
      'aria-label': title ? `Memory diagram: ${title}` : 'Memory diagram'
    },
    [defs, regions, wires, shapes]
  )

  return { root, title, caption: directives.get('caption') }
}

/**
 * The `bitfield` fence: a word, cut into the bits each part of it owns.
 *
 * Every other figure here draws a shape a data structure can grow into — a
 * chain, a tree, a table. A bitfield is fixed the moment it is declared: 32
 * bits are 32 bits, and the picture is just where the dividers fall.
 *
 *     s:1 sign
 *     bexp:8 biased exponent
 *     m:23 significand
 *
 * One row a field: a short name for the box, how many bits it owns, and the
 * long name underneath it. Widths are drawn to scale — the same convention
 * every ISA manual and RFC diagram already uses, so a wide `m` reads as wide
 * before the number under it is even read.
 *
 * `_:7` is bits nothing uses — reserved, or padding — drawn hatched rather
 * than boxed, so a real one-letter field is never mistaken for a gap. A
 * `width:` directive caps how many bits fit on a row and wraps the rest onto
 * the next one, which is what a 32-bit-per-line protocol header needs and a
 * single register does not.
 */

import { accentStyle, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, readSource, VizError, type Annotated } from './source'
import type { Figure } from './tree'

export const BITFIELD_KEYS = ['title', 'caption', 'width'] as const

interface Field extends Annotated {
  id: string
  width: number
  reserved: boolean
}

const ROW = /^([A-Za-z_]\w*)\s*:\s*(\d+)\s*(.*)$/

function readFields(lines: Array<{ text: string; n: number }>): Field[] {
  return lines.map((line) => {
    const split = ROW.exec(line.text)
    if (!split) {
      throw new VizError(
        `\`${line.text}\` is not a field. Write a row as \`id:width name\` — \`s:1 sign\`, or \`_:7\` for bits nothing uses.`,
        line.n
      )
    }
    const width = Number(split[2])
    if (width <= 0) throw new VizError(`\`${split[1]}\` is 0 bits wide`, line.n)
    const id = split[1]
    const ann = annotate(split[3])
    return { ...ann, id, width, reserved: id === '_' }
  })
}

// --------------------------------------------------------------------- rows

/** Fields, split onto rows no wider than `rowWidth` bits — or one row, unbounded. */
function toRows(fields: Field[], rowWidth: number | undefined): Field[][] {
  if (rowWidth === undefined) return [fields]

  const rows: Field[][] = [[]]
  let used = 0
  for (const field of fields) {
    if (field.width > rowWidth) {
      throw new VizError(`\`${field.id}\` is ${field.width} bits — wider than a ${rowWidth}-bit row.`)
    }
    if (used + field.width > rowWidth) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1].push(field)
    used += field.width
  }
  return rows.filter((row) => row.length > 0)
}

// --------------------------------------------------------------------- layout

const FIELD_H = 34
const ID_SIZE = 13
const WIDTH_SIZE = 12
const NAME_SIZE = 11
const SUB_SIZE = 9
const WIDTH_LINE_H = 17
const NAME_LINE_H = 14
const SUB_LINE_H = 12
const GAP_BOX = 8
const ROW_GAP = 22
const PAD = 16
const UNIT = 18
const MAX_LINES = 3

/** The widest single word in `text` — a box narrower than this would truncate it mid-word. */
function longestWord(text: string, size: number): number {
  if (!text) return 0
  return Math.max(0, ...text.split(/\s+/).filter(Boolean).map((word) => textWidth(word, size)))
}

/**
 * A box is at least wide enough for its own id and for the longest word
 * under it, whatever its bit count says — a one-bit `sign` field still gets
 * room to write `sign`, the way the hand-drawn version always does.
 */
function fieldWidth(field: Field): number {
  const id = field.reserved ? 0 : textWidth(field.id, ID_SIZE) + 16
  const name = longestWord(field.label, NAME_SIZE) + 8
  const sub = field.sub ? longestWord(field.sub, SUB_SIZE) + 8 : 0
  return Math.max(20, id, name, sub, field.width * UNIT)
}

/** Greedy word wrap, arithmetic like everything else in `viz/` — no DOM measurement. */
function wrapLines(text: string, size: number, maxWidth: number, maxLines = MAX_LINES): string[] {
  if (!text) return []
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (current && textWidth(attempt, size) > maxWidth) {
      lines.push(current)
      current = word
      if (lines.length === maxLines) break
    } else {
      current = attempt
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  const last = lines.length - 1
  if (last >= 0 && textWidth(lines[last], size) > maxWidth) lines[last] = ellipsize(lines[last], size, maxWidth)
  return lines
}

interface Laid {
  field: Field
  x: number
  w: number
  nameLines: string[]
  subLines: string[]
  footer: number
}

interface Row {
  fields: Laid[]
  width: number
  footer: number
}

function layoutRow(fields: Field[]): Row {
  let x = 0
  let rowFooter = 0
  const laid = fields.map((field) => {
    const w = fieldWidth(field)
    const nameLines = wrapLines(field.label, NAME_SIZE, w - 8)
    const subLines = field.sub ? wrapLines(field.sub, SUB_SIZE, w - 8, 1) : []
    const footer =
      GAP_BOX + WIDTH_LINE_H + nameLines.length * NAME_LINE_H + subLines.length * SUB_LINE_H
    rowFooter = Math.max(rowFooter, footer)
    const out: Laid = { field, x, w, nameLines, subLines, footer }
    x += w
    return out
  })
  return { fields: laid, width: x, footer: rowFooter }
}

function drawField(laid: Laid, y: number): SVGGElement {
  const { field, x, w } = laid
  const group = svg('g', {
    class: `viz-cell viz-bitfield__field${field.reserved ? ' is-reserved' : ''}${field.highlight ? ' is-marked' : ''}${field.dim ? ' is-dim' : ''}`,
    style: accentStyle(field.accent)
  })
  group.appendChild(
    svg('rect', { class: 'viz-cell__shape', x: round(x), y: round(y), width: round(w), height: FIELD_H, rx: 2 })
  )
  if (!field.reserved) {
    group.appendChild(label(field.id, round(x + w / 2), round(y + FIELD_H / 2), 'viz-cell__value', ID_SIZE))
  }

  let ty = y + FIELD_H + GAP_BOX
  group.appendChild(
    label(String(field.width), round(x + w / 2), round(ty + WIDTH_LINE_H / 2), 'viz-bitfield__width', WIDTH_SIZE)
  )
  ty += WIDTH_LINE_H

  for (const line of laid.nameLines) {
    group.appendChild(label(line, round(x + w / 2), round(ty + NAME_LINE_H / 2), 'viz-bitfield__name', NAME_SIZE))
    ty += NAME_LINE_H
  }

  for (const line of laid.subLines) {
    group.appendChild(label(line, round(x + w / 2), round(ty + SUB_LINE_H / 2), 'viz-cell__index', SUB_SIZE))
    ty += SUB_LINE_H
  }

  return group
}

function draw(rows: Row[], title: string | undefined): SVGSVGElement {
  const width = Math.max(0, ...rows.map((row) => row.width))
  let y = 0
  const cells = svg('g', { class: 'viz-cells' })
  for (const row of rows) {
    for (const laid of row.fields) cells.appendChild(drawField(laid, y))
    y += FIELD_H + row.footer + ROW_GAP
  }
  const height = Math.max(0, y - ROW_GAP)

  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `${-PAD} ${-PAD} ${round(width + PAD * 2)} ${round(height + PAD * 2)}`,
    width: round(width + PAD * 2),
    height: round(height + PAD * 2),
    role: 'img',
    'aria-label': title ? `Bit field: ${title}` : 'Bit field'
  })
  root.appendChild(cells)
  return root
}

export function drawBitfield(source: string): Figure {
  const { directives, lines } = readSource(source, BITFIELD_KEYS)
  if (lines.length === 0) {
    throw new VizError('nothing to draw. Write a row as `id:width name`, one per line — `s:1 sign`.')
  }

  const fields = readFields(lines)

  let rowWidth: number | undefined
  const rowWidthRaw = directives.get('width')
  if (rowWidthRaw !== undefined) {
    const asked = Number(rowWidthRaw)
    if (!Number.isInteger(asked) || asked <= 0) {
      throw new VizError(`\`${rowWidthRaw}\` is not a row width. Give it a whole number of bits, like \`width: 32\`.`)
    }
    rowWidth = asked
  }

  const rows = toRows(fields, rowWidth).map(layoutRow)
  const total = fields.reduce((sum, field) => sum + field.width, 0)

  const title = directives.get('title')
  const root = draw(rows, title)

  return {
    root,
    title,
    caption: directives.get('caption') ?? (rows.length > 1 ? `${total} bits over ${rows.length} rows` : undefined)
  }
}

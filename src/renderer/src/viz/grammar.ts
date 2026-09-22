/**
 * `grammar` — EBNF, drawn as railroad.
 *
 * A grammar is the one piece of notation in a course that is *already* a
 * picture and is nevertheless always written as text. `expr ::= term { "+"
 * term }` is a diagram in one line: a track through `term`, and a loop back
 * over `"+" term`. Read as text it has to be simulated in the head; drawn, the
 * loop is a loop and the alternation is a fork, and the question a reader
 * actually has — "can it be empty", "how many of these may there be" — is
 * answered by the shape without parsing anything.
 *
 * Which is why railroad rather than a prettier BNF. The two facts a syntax
 * diagram makes free are the two facts that cost the most to extract from the
 * text: a bypass line means optional, and a return line means repeated.
 *
 * The layout is the standard one. Every piece knows three numbers — how wide it
 * is, and how far it reaches above and below the rail it enters and leaves on —
 * and every combinator is arithmetic over those three. Nothing here measures
 * anything in the document, for the reason every other figure here does not:
 * see `viz/svg`.
 */

import { arrowDefs, label, round, svg, textWidth } from './svg'
import { readSource, VizError, type SourceLine } from './source'
import type { Figure } from './tree'

export const GRAMMAR_KEYS = ['title', 'caption'] as const

// ------------------------------------------------------------------- the AST

type Item =
  /** A literal: what appears in the input. */
  | { kind: 'terminal'; text: string }
  /** A rule name: something defined elsewhere. */
  | { kind: 'rule'; text: string }
  | { kind: 'seq'; items: Item[] }
  | { kind: 'choice'; items: Item[] }
  /** Zero or one — a bypass over the top. */
  | { kind: 'optional'; item: Item }
  /** One or more — a return line underneath. `zero` adds the bypass as well. */
  | { kind: 'repeat'; item: Item; zero: boolean }
  /** The empty string: a straight line, and the reason a bypass reads as one. */
  | { kind: 'skip' }

interface Rule {
  name: string
  body: Item
  line: number
}

// ---------------------------------------------------------------- the reader

/** `::=`, `=`, `->` or `:` — every spelling a course has ever used. */
const DEFINE_RE = /^([A-Za-z_][\w'-]*)\s*(?:::=|:==|-->|->|:=|=|:)\s*(.*)$/

interface Token {
  kind: 'terminal' | 'rule' | 'punct'
  text: string
}

/**
 * Split a right-hand side into tokens.
 *
 * Quotes are the only thing that makes a terminal a terminal, which is EBNF's
 * own rule and worth keeping even though it means `"("` must be quoted to mean
 * a literal bracket. The alternative — guessing from whether a name has a rule
 * — makes a grammar change shape when an unrelated rule is renamed.
 */
function lex(text: string, line: number): Token[] {
  const out: Token[] = []
  let at = 0

  while (at < text.length) {
    const ch = text[at]
    if (ch === ' ' || ch === '\t') {
      at++
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, at + 1)
      if (end === -1) throw new VizError(`a quote is opened and never closed`, line)
      out.push({ kind: 'terminal', text: text.slice(at + 1, end) })
      at = end + 1
      continue
    }
    if ('()[]{}|?*+'.includes(ch)) {
      out.push({ kind: 'punct', text: ch })
      at++
      continue
    }
    const word = /^[^\s()[\]{}|?*+"']+/.exec(text.slice(at))
    if (!word) throw new VizError(`\`${ch}\` means nothing in a grammar`, line)
    out.push({ kind: 'rule', text: word[0] })
    at += word[0].length
  }
  return out
}

const EMPTY = new Set(['ε', 'epsilon', 'empty', 'nothing', 'λ'])

/**
 * Tokens to a tree, by the usual descent: alternation, then sequence, then a
 * piece with its postfix operators.
 */
function parseRhs(tokens: Token[], line: number): Item {
  let at = 0

  const peek = (): Token | undefined => tokens[at]
  const eat = (text: string): boolean => {
    if (tokens[at]?.kind === 'punct' && tokens[at].text === text) {
      at++
      return true
    }
    return false
  }

  const alternation = (): Item => {
    const branches: Item[] = [sequence()]
    while (eat('|')) branches.push(sequence())
    return branches.length === 1 ? branches[0] : { kind: 'choice', items: branches }
  }

  const sequence = (): Item => {
    const parts: Item[] = []
    for (;;) {
      const token = peek()
      if (!token) break
      if (token.kind === 'punct' && ('|)]}'.includes(token.text))) break
      parts.push(piece())
    }
    if (parts.length === 0) return { kind: 'skip' }
    return parts.length === 1 ? parts[0] : { kind: 'seq', items: parts }
  }

  const piece = (): Item => {
    let item: Item
    const token = tokens[at]

    if (token.kind === 'punct' && token.text === '(') {
      at++
      item = alternation()
      if (!eat(')')) throw new VizError('a `(` is opened and never closed', line)
    } else if (token.kind === 'punct' && token.text === '[') {
      at++
      item = { kind: 'optional', item: alternation() }
      if (!eat(']')) throw new VizError('a `[` is opened and never closed', line)
    } else if (token.kind === 'punct' && token.text === '{') {
      at++
      item = { kind: 'repeat', item: alternation(), zero: true }
      if (!eat('}')) throw new VizError('a `{` is opened and never closed', line)
    } else if (token.kind === 'punct') {
      throw new VizError(`\`${token.text}\` has nothing in front of it`, line)
    } else {
      at++
      item =
        token.kind === 'rule' && EMPTY.has(token.text.toLowerCase())
          ? { kind: 'skip' }
          : { kind: token.kind, text: token.text }
    }

    // The postfix forms, which may stack: `x+?` is legal and means `x*`.
    for (;;) {
      if (eat('?')) item = { kind: 'optional', item }
      else if (eat('*')) item = { kind: 'repeat', item, zero: true }
      else if (eat('+')) item = { kind: 'repeat', item, zero: false }
      else break
    }
    return item
  }

  const parsed = alternation()
  if (at < tokens.length) throw new VizError(`\`${tokens[at].text}\` has nothing to attach to`, line)
  return parsed
}

/**
 * The rules, from the body of a fence.
 *
 * A line beginning with `|` continues the rule above it, which is how a grammar
 * with six alternatives is written everywhere it is written by hand.
 */
function readRules(lines: SourceLine[]): Rule[] {
  const rules: Rule[] = []
  const text: string[] = []

  for (const line of lines) {
    if (line.text.startsWith('|') && rules.length > 0) {
      text[text.length - 1] += ` ${line.text}`
      continue
    }
    const defined = DEFINE_RE.exec(line.text)
    if (!defined) {
      throw new VizError(
        `\`${line.text}\` is not a rule. Write one as \`expr ::= term "+" expr\`.`,
        line.n
      )
    }
    rules.push({ name: defined[1], body: { kind: 'skip' }, line: line.n })
    text.push(defined[2])
  }

  rules.forEach((rule, at) => {
    rule.body = parseRhs(lex(text[at], rule.line), rule.line)
  })
  return rules
}

// -------------------------------------------------------------------- layout

const BOX_H = 26
const HALF = BOX_H / 2
const RUN = 12
/** How far a fork reaches sideways before it has finished going down. */
const ARC = 14
/** The gap between two branches of a choice, or a loop and what it loops over. */
const VGAP = 12
const TEXT = 11
const NAME = 12
const RULE_GAP = 26
const PAD = 12

interface Size {
  w: number
  /** How far above the entry rail this reaches. */
  up: number
  /** How far below it. */
  down: number
}

function measure(item: Item): Size {
  switch (item.kind) {
    case 'skip':
      return { w: RUN * 2, up: 2, down: 2 }
    case 'terminal':
    case 'rule':
      return { w: Math.ceil(textWidth(item.text, TEXT)) + (item.kind === 'terminal' ? 20 : 18), up: HALF, down: HALF }
    case 'seq': {
      const parts = item.items.map(measure)
      return {
        w: parts.reduce((sum, one) => sum + one.w, 0) + RUN * (parts.length - 1),
        up: Math.max(...parts.map((one) => one.up)),
        down: Math.max(...parts.map((one) => one.down))
      }
    }
    case 'choice': {
      const parts = item.items.map(measure)
      const inner = Math.max(...parts.map((one) => one.w))
      // Every branch after the first hangs below the one before it. The first
      // sits on the rail, so the whole fork reaches no further up than it does.
      let down = parts[0].down
      for (let i = 1; i < parts.length; i++) down += VGAP + parts[i].up + parts[i].down
      return { w: inner + ARC * 2, up: parts[0].up, down }
    }
    case 'optional': {
      const inner = measure(item.item)
      // The bypass is the rail itself; the content drops below it.
      return { w: inner.w + ARC * 2, up: 2, down: VGAP + inner.up + inner.down }
    }
    case 'repeat': {
      const inner = measure(item.item)
      const loop = { w: inner.w + ARC * 2, up: inner.up, down: inner.down + VGAP + 8 }
      if (!item.zero) return loop
      return { w: loop.w + ARC * 2, up: 2, down: VGAP + loop.up + loop.down }
    }
  }
}

/** An S-curve from one rail height to another over a horizontal span. */
function bend(x: number, y: number, dx: number, dy: number): SVGPathElement {
  return svg('path', {
    class: 'viz-rail',
    d: `M ${round(x)} ${round(y)} C ${round(x + dx * 0.62)} ${round(y)}, ${round(x + dx * 0.38)} ${round(y + dy)}, ${round(x + dx)} ${round(y + dy)}`
  })
}

function rail(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  return svg('line', { class: 'viz-rail', x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) })
}

/**
 * Draw one piece, entering at `(x, y)` on the rail and leaving at the same
 * height `size.w` further along. Everything is placed relative to that rail,
 * which is what lets a combinator lay its children out without knowing what
 * they are.
 */
function place(item: Item, x: number, y: number, into: SVGGElement, back: string): void {
  const size = measure(item)

  switch (item.kind) {
    case 'skip':
      into.appendChild(rail(x, y, x + size.w, y))
      return

    case 'terminal':
    case 'rule': {
      into.appendChild(
        svg('rect', {
          class: item.kind === 'terminal' ? 'viz-grammar__terminal' : 'viz-grammar__rule',
          x: round(x),
          y: round(y - HALF),
          width: round(size.w),
          height: BOX_H,
          // A terminal is a stadium and a rule is a rectangle: the shape says
          // which of the two a reader has to go and look up.
          rx: item.kind === 'terminal' ? HALF : 4
        })
      )
      into.appendChild(
        label(item.text, round(x + size.w / 2), round(y), item.kind === 'terminal' ? 'viz-grammar__literal' : 'viz-grammar__name', TEXT)
      )
      return
    }

    case 'seq': {
      let at = x
      item.items.forEach((part, i) => {
        if (i > 0) {
          into.appendChild(rail(at, y, at + RUN, y))
          at += RUN
        }
        place(part, at, y, into, back)
        at += measure(part).w
      })
      return
    }

    case 'choice': {
      const parts = item.items.map(measure)
      const inner = Math.max(...parts.map((one) => one.w))
      let drop = 0

      item.items.forEach((branch, i) => {
        const part = parts[i]
        if (i > 0) drop += VGAP + part.up + (i === 1 ? parts[0].down : parts[i - 1].down)
        const at = y + drop

        if (i === 0) {
          into.appendChild(rail(x, y, x + ARC, y))
          into.appendChild(rail(x + ARC + inner, y, x + size.w, y))
        } else {
          into.appendChild(bend(x, y, ARC, drop))
          into.appendChild(bend(x + size.w, y, -ARC, drop))
        }
        // A branch narrower than the widest one is padded with rail, centred,
        // so a fork of three reads as three parallel tracks rather than as a
        // ragged left edge.
        const slack = (inner - part.w) / 2
        if (slack > 0) {
          into.appendChild(rail(x + ARC, at, x + ARC + slack, at))
          into.appendChild(rail(x + ARC + slack + part.w, at, x + ARC + inner, at))
        }
        place(branch, x + ARC + slack, at, into, back)
      })
      return
    }

    case 'optional': {
      const inner = measure(item.item)
      const at = y + VGAP + inner.up
      into.appendChild(rail(x, y, x + size.w, y))
      into.appendChild(bend(x, y, ARC, at - y))
      into.appendChild(bend(x + size.w, y, -ARC, at - y))
      place(item.item, x + ARC, at, into, back)
      return
    }

    case 'repeat': {
      const inner = measure(item.item)
      if (item.zero) {
        // Zero or more is one or more with a bypass over the top, which is
        // exactly how it is defined and exactly how it should be drawn.
        const loop: Item = { ...item, zero: false }
        const loopSize = measure(loop)
        const at = y + VGAP + loopSize.up
        into.appendChild(rail(x, y, x + size.w, y))
        into.appendChild(bend(x, y, ARC, at - y))
        into.appendChild(bend(x + size.w, y, -ARC, at - y))
        place(loop, x + ARC, at, into, back)
        return
      }

      const returnY = y + inner.down + VGAP + 6
      into.appendChild(rail(x, y, x + ARC, y))
      into.appendChild(rail(x + ARC + inner.w, y, x + size.w, y))
      place(item.item, x + ARC, y, into, back)
      // The return line runs right to left, and carries the arrowhead: without
      // it a loop reads as a second parallel track rather than as a way back.
      into.appendChild(bend(x + size.w, y, -ARC, returnY - y))
      into.appendChild(bend(x, y, ARC, returnY - y))
      const line = rail(x + size.w - ARC, returnY, x + ARC, returnY)
      line.setAttribute('marker-end', back)
      into.appendChild(line)
      return
    }
  }
}

// -------------------------------------------------------------------- figure

export function drawGrammar(source: string): Figure {
  const { directives, lines } = readSource(source, GRAMMAR_KEYS)
  const rules = readRules(lines)
  if (rules.length === 0) {
    throw new VizError('no rules. Write one as `expr ::= term { "+" term }`.')
  }

  const { defs, arrow } = arrowDefs()
  const board = svg('g', {})
  const nameW = Math.max(...rules.map((rule) => textWidth(rule.name, NAME))) + 16
  let y = 0
  let widest = 0

  for (const rule of rules) {
    const size = measure(rule.body)
    y += size.up + 4

    board.appendChild(label(rule.name, 0, round(y), 'viz-grammar__label', NAME, 'start'))
    // The stub either side is where the eye starts and stops: a diagram that
    // began flush against its own first box would read as a fragment.
    const left = nameW
    board.appendChild(svg('line', { class: 'viz-rail viz-rail--end', x1: round(left), y1: round(y - 7), x2: round(left), y2: round(y + 7) }))
    board.appendChild(rail(left, y, left + RUN, y))
    place(rule.body, left + RUN, y, board, arrow)
    const right = left + RUN * 2 + size.w
    board.appendChild(rail(right - RUN, y, right, y))
    board.appendChild(svg('line', { class: 'viz-rail viz-rail--end', x1: round(right), y1: round(y - 7), x2: round(right), y2: round(y + 7) }))

    widest = Math.max(widest, right)
    y += size.down + RULE_GAP
  }

  const height = Math.max(0, y - RULE_GAP)
  const root = svg(
    'svg',
    {
      class: 'viz__svg',
      viewBox: `${-PAD} ${-PAD} ${round(widest + PAD * 2)} ${round(height + PAD * 2)}`,
      width: round(widest + PAD * 2),
      height: round(height + PAD * 2),
      role: 'img'
    },
    [defs, board]
  )

  return { root, title: directives.get('title'), caption: directives.get('caption') }
}

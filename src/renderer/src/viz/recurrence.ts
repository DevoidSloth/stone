/**
 * A recurrence, turned into the tree you would draw to solve it.
 *
 * `T(n) = 2T(n/2) + n` is four levels of arithmetic that every student does by
 * hand once and then gets wrong forever after, and the reason they get it wrong
 * is that the picture is doing two things at once. The tree on the left is the
 * *shape* of the recursion — how many calls, on how small a problem. The column
 * on the right is the *cost* — what one level adds up to. The insight is that
 * the second column is often constant down the page, and that is why the answer
 * has a `log n` in it. A figure that draws only the tree throws that away.
 *
 * So this module does the algebra rather than the drawing. It reads the
 * recurrence, works out what each level costs as a closed-form term in `n`, and
 * hands `tree` a list of labels to put down the side. The sum at the bottom is
 * the master theorem, applied and stated — not because the reader could not
 * apply it, but because a figure whose numbers disagreed with the answer under
 * it would be worse than no figure.
 *
 * The cost term is deliberately restricted to `c·n^p`. That covers every
 * recurrence anyone draws a tree for, and the alternative — a general symbolic
 * algebra over `log`s and sums — would be a computer algebra system living
 * inside a notes app, which is not a trade worth making. A cost this cannot
 * simplify is refused by name, with `cost:` offered as the way to write the
 * levels out yourself.
 */

import { VizError } from './source'

/** A rational, kept exact so that `3/4 n²` never arrives as `0.7500000001 n²`. */
interface Ratio {
  num: number
  den: number
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const held = y
    y = x % y
    x = held
  }
  return x || 1
}

function ratio(num: number, den = 1): Ratio {
  const divisor = gcd(num, den)
  const sign = den < 0 ? -1 : 1
  return { num: (num / divisor) * sign, den: Math.abs(den / divisor) }
}

/** `c · n^power`. */
interface Term {
  coefficient: Ratio
  power: number
}

export interface Recurrence {
  /** How many subproblems one call makes. */
  branch: number
  /** `n/b`, or `n-k` when the problem shrinks by subtraction. */
  shrink: { kind: 'divide'; by: number } | { kind: 'subtract'; by: number }
  cost: Term
  /** The recurrence as it was written, for the title. */
  source: string
}

// -------------------------------------------------------------------- reading

const SUPERSCRIPTS: Record<string, string> = { '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶' }

/** `n^2` as `n²` where a single character exists for it, and as written where not. */
function power(base: string, exponent: number): string {
  if (exponent === 0) return ''
  if (exponent === 1) return base
  const glyph = SUPERSCRIPTS[String(exponent)]
  return glyph ? `${base}${glyph}` : `${base}^${exponent}`
}

/**
 * A term as a person would write it.
 *
 * The division goes on the outside — `3n²/4`, not `(3/4)n²` — because that is
 * how it is written on a board and because the parenthesised form reads as a
 * function call in a figure that is otherwise full of them.
 */
function show(term: Term, variable = 'n'): string {
  const { num, den } = term.coefficient
  const body = power(variable, term.power)

  if (!body) return den === 1 ? String(num) : `${num}/${den}`
  const head = num === 1 ? body : num === -1 ? `-${body}` : `${num}${body}`
  return den === 1 ? head : `${head}/${den}`
}

/**
 * Read `2T(n/2) + n`.
 *
 * Everything about the shape is in the `T(...)`: what multiplies it is the
 * branching factor, and what is inside it is how fast the problem shrinks.
 * What follows the `+` is the work one call does on top of its recursion, which
 * is the part that has to be a term this can raise to a power.
 */
export function readRecurrence(text: string): Recurrence {
  const body = text.replace(/^\s*T\s*\(\s*n\s*\)\s*=\s*/i, '').trim()

  const call = /(\d*)\s*T\s*\(\s*n\s*(?:([/-])\s*(\d+))?\s*\)/i.exec(body)
  if (!call) {
    throw new VizError(
      `\`${text}\` has no recursive call in it. Write the right-hand side, as in \`2T(n/2) + n\`.`
    )
  }

  const branch = call[1] ? Number(call[1]) : 1
  if (branch < 1 || branch > 8) throw new VizError(`${branch} subproblems is more than a tree can show`)

  const by = call[3] ? Number(call[3]) : 1
  const shrink: Recurrence['shrink'] =
    call[2] === '-' ? { kind: 'subtract', by } : { kind: 'divide', by: call[2] ? by : 1 }

  if (shrink.kind === 'divide' && shrink.by < 2) {
    throw new VizError('`T(n/1)` never gets smaller — the recursion would not stop')
  }

  // Whatever is left once the call is taken out is the work done per call.
  const rest = (body.slice(0, call.index) + body.slice(call.index + call[0].length))
    .replace(/^\s*\+\s*/, '')
    .replace(/\s*\+\s*$/, '')
    .trim()

  return { branch, shrink, cost: readTerm(rest || '0', text), source: text }
}

/** `n`, `n^2`, `3n`, `n/2`, `1`, `c` — and nothing else, loudly. */
function readTerm(text: string, whole: string): Term {
  const clean = text.replace(/\s+/g, '')
  if (clean === '' || clean === '0') return { coefficient: ratio(0), power: 0 }

  const match = /^(\d+)?(?:\*?)(n(?:\^(\d+))?)?(?:\/(\d+))?$/i.exec(clean)
  if (!match) {
    throw new VizError(
      `\`${text}\` is not a cost this can add up. It handles \`1\`, \`n\`, \`n^2\` and multiples of them; for anything else, write the levels out with \`cost:\`.`
    )
  }
  if (/log/i.test(whole) && !match[2]) {
    throw new VizError('a cost with a `log` in it needs its levels written out with `cost:`')
  }

  const numerator = match[1] ? Number(match[1]) : 1
  const denominator = match[4] ? Number(match[4]) : 1
  return {
    coefficient: ratio(numerator, denominator),
    power: match[2] ? (match[3] ? Number(match[3]) : 1) : 0
  }
}

// --------------------------------------------------------------------- levels

export interface Solved {
  /** The label on a node at each level: `n`, `n/2`, `n/4`, … */
  sizes: string[]
  /** What the whole of each level costs, already simplified. */
  costs: string[]
  /** How many nodes each level has. */
  counts: number[]
  /** The sum, as a Θ. */
  total: string
  /** The line under the tree that says why. */
  reason: string
}

/**
 * Every level's size and cost, plus the sum.
 *
 * The cost of a level is `a^i · f(n/b^i)`, and with `f(n) = c·n^p` that is
 * `c · (a/b^p)^i · n^p` — a geometric series in `i`, which is precisely why the
 * three cases of the master theorem are the three ways a geometric series can
 * behave. Computing it as an exact ratio rather than a float is what lets the
 * column read `n`, `n`, `n`, `n` for mergesort instead of four ways of spelling
 * 0.9999999.
 */
export function solve(rec: Recurrence, depth: number): Solved {
  const sizes: string[] = []
  const costs: string[] = []
  const counts: number[] = []

  for (let level = 0; level <= depth; level++) {
    const nodes = Math.pow(rec.branch, level)
    counts.push(nodes)

    if (rec.shrink.kind === 'divide') {
      const divisor = Math.pow(rec.shrink.by, level)
      sizes.push(level === 0 ? 'n' : `n/${divisor}`)
      // c · a^i / b^(i·p) · n^p
      const scaled = ratio(
        rec.cost.coefficient.num * nodes,
        rec.cost.coefficient.den * Math.pow(rec.shrink.by, level * rec.cost.power)
      )
      costs.push(show({ coefficient: scaled, power: rec.cost.power }))
    } else {
      const gone = rec.shrink.by * level
      const size = level === 0 ? 'n' : `n−${gone}`
      sizes.push(size)
      // `(n−2)²` cannot be expanded into anything shorter, so the level's cost
      // is left standing as the product it is — bracketed only where the
      // brackets do something, which for a bare `n−2` they do not.
      const naked = level === 0 || (rec.cost.power <= 1 && rec.cost.coefficient.num === 1 && rec.cost.coefficient.den === 1)
      const per = show(rec.cost, level === 0 ? 'n' : naked ? size : `(${size})`)
      costs.push(nodes === 1 ? per : `${nodes}·${per}`)
    }
  }

  return { sizes, costs, counts, ...sum(rec) }
}

/** The master theorem, or the two shapes of subtractive recurrence. */
function sum(rec: Recurrence): { total: string; reason: string } {
  const p = rec.cost.power

  if (rec.shrink.kind === 'subtract') {
    if (rec.branch === 1) {
      return {
        total: `Θ(${power('n', p + 1)})`,
        reason: `${rec.shrink.by === 1 ? 'n' : `n/${rec.shrink.by}`} levels, each costing about ${show(rec.cost)}`
      }
    }
    return {
      total: `Θ(${rec.branch}^n)`,
      reason: 'the tree doubles at every level and is n levels deep — the leaves are everything'
    }
  }

  const a = rec.branch
  const b = rec.shrink.by
  const critical = Math.log(a) / Math.log(b)

  // The exponent is written as a log unless it lands on a whole number, which
  // is the difference between `n^1.58` — a number nobody can check — and
  // `n^log₂3`, which is the answer as it is written down everywhere.
  const nearest = Math.round(critical)
  const exponent =
    Math.abs(critical - nearest) < 1e-9 ? power('n', nearest) : `n^log${sub(b)}${a} ≈ n^${critical.toFixed(2)}`

  if (Math.abs(p - critical) < 1e-9) {
    return {
      total: `Θ(${power('n', p)} log n)`,
      reason: `every level costs the same ${show(rec.cost)}, and there are log${sub(b)} n of them`
    }
  }
  if (p < critical) {
    return { total: `Θ(${exponent})`, reason: 'the levels grow downwards — the leaves dominate' }
  }
  return { total: `Θ(${show({ coefficient: ratio(1), power: p })})`, reason: 'the levels shrink downwards — the root dominates' }
}

const SUBSCRIPTS: Record<string, string> = { '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }

function sub(value: number): string {
  return String(value)
    .split('')
    .map((ch) => SUBSCRIPTS[ch] ?? ch)
    .join('')
}

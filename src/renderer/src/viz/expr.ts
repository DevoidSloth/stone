/**
 * Arithmetic in `n`, for the fences that plot a function rather than a value.
 *
 * The reason this exists rather than a call to `Function()` is not really
 * safety — a note is the user's own file — it is that `n log n` has to work.
 * Nobody writing about algorithms writes `n * Math.log2(n)`; they write what
 * they would write on a board, and a fence that made them translate it would be
 * used once. So juxtaposition is multiplication here, the way it is in
 * mathematics and in every complexity class anyone has ever written down:
 * `2n`, `n log n`, `3n^2 log n` all parse as themselves.
 *
 * `log` is base two, with no way to change it. That is a deliberate,
 * opinionated choice for an app whose figures are about algorithms: in this
 * subject an unqualified log has been base two for fifty years, and a plot that
 * quietly drew the natural log would be wrong by a constant factor in a picture
 * whose whole subject is constant factors. `ln`, `log2` and `log10` are all
 * there for saying so explicitly.
 */

import { VizError } from './source'

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }

const FUNCTIONS: Record<string, (value: number) => number> = {
  log: Math.log2,
  lg: Math.log2,
  log2: Math.log2,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  exp: Math.exp,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil
}

const CONSTANTS: Record<string, number> = {
  e: Math.E,
  pi: Math.PI
}

function tokenize(text: string, line?: number): Token[] {
  const tokens: Token[] = []
  let at = 0

  while (at < text.length) {
    const ch = text[at]
    if (ch === ' ' || ch === '\t') {
      at++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const start = at
      while (at < text.length && /[0-9.]/.test(text[at])) at++
      const value = Number(text.slice(start, at))
      if (!Number.isFinite(value)) throw new VizError(`\`${text.slice(start, at)}\` is not a number`, line)
      tokens.push({ kind: 'num', value })
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = at
      while (at < text.length && /[A-Za-z0-9_]/.test(text[at])) at++
      tokens.push({ kind: 'name', value: text.slice(start, at).toLowerCase() })
      continue
    }
    if ('+-*/^()'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch })
      at++
      continue
    }
    // `·` and `×` cost nothing to accept and are what a person pastes out of a
    // document that was typeset rather than typed.
    if (ch === '·' || ch === '×') {
      tokens.push({ kind: 'op', value: '*' })
      at++
      continue
    }
    throw new VizError(`\`${ch}\` is not something this can work out`, line)
  }

  return tokens
}

/**
 * Compile an expression to a function of `n`.
 *
 * Recursive descent, with one wrinkle: a term goes on multiplying for as long
 * as the next token could begin a value, which is what turns `n log n` into a
 * product without a `*` in it. The wrinkle is contained to one line in
 * `term`, and everything else is the grammar anyone would write.
 */
export function compile(text: string, line?: number): (n: number) => number {
  const tokens = tokenize(text, line)
  let at = 0

  const peek = (): Token | undefined => tokens[at]
  const isOp = (value: string): boolean => {
    const token = peek()
    return token?.kind === 'op' && token.value === value
  }

  /** Whether the next token could start a value, and so be an implicit product. */
  const startsValue = (): boolean => {
    const token = peek()
    if (!token) return false
    return token.kind === 'num' || token.kind === 'name' || (token.kind === 'op' && token.value === '(')
  }

  const expr = (): ((n: number) => number) => {
    let left = term()
    for (;;) {
      if (isOp('+')) {
        at++
        const right = term()
        const held = left
        left = (n) => held(n) + right(n)
      } else if (isOp('-')) {
        at++
        const right = term()
        const held = left
        left = (n) => held(n) - right(n)
      } else break
    }
    return left
  }

  const term = (): ((n: number) => number) => {
    let left = unary()
    for (;;) {
      if (isOp('*')) {
        at++
        const right = unary()
        const held = left
        left = (n) => held(n) * right(n)
      } else if (isOp('/')) {
        at++
        const right = unary()
        const held = left
        left = (n) => held(n) / right(n)
      } else if (startsValue()) {
        const right = unary()
        const held = left
        left = (n) => held(n) * right(n)
      } else break
    }
    return left
  }

  const unary = (): ((n: number) => number) => {
    if (isOp('-')) {
      at++
      const inner = unary()
      return (n) => -inner(n)
    }
    if (isOp('+')) {
      at++
      return unary()
    }
    return power()
  }

  const power = (): ((n: number) => number) => {
    const base = atom()
    if (isOp('^')) {
      at++
      // Right-associative, and the exponent is a `unary` so `2^-n` works.
      const exponent = unary()
      return (n) => Math.pow(base(n), exponent(n))
    }
    return base
  }

  const atom = (): ((n: number) => number) => {
    const token = peek()
    if (!token) throw new VizError('the expression stops in the middle', line)

    if (token.kind === 'num') {
      at++
      return () => token.value
    }

    if (token.kind === 'op' && token.value === '(') {
      at++
      const inner = expr()
      if (!isOp(')')) throw new VizError('a bracket is left open', line)
      at++
      return inner
    }

    if (token.kind === 'name') {
      at++
      const name = token.value
      const fn = FUNCTIONS[name]
      if (fn) {
        // The argument is a `power`, not a whole term, so `log n^2` is the log
        // of a square and `n log n` does not swallow its own left-hand side.
        const argument = power()
        return (n) => fn(argument(n))
      }
      if (name in CONSTANTS) return () => CONSTANTS[name]
      if (name === 'n' || name === 'x') return (n) => n
      throw new VizError(
        `\`${name}\` is not a name this knows. The variable is \`n\`; the functions are log, ln, log10, sqrt, exp, abs, floor and ceil.`,
        line
      )
    }

    throw new VizError(`\`${token.value}\` cannot start a value`, line)
  }

  const compiled = expr()
  if (at < tokens.length) {
    const left = tokens[at]
    throw new VizError(`\`${left.kind === 'num' ? left.value : left.value}\` is left over at the end`, line)
  }
  return compiled
}

/**
 * The `chart` fence: growth, measured or predicted.
 *
 * Two figures in a course on algorithms are charts and nothing else can stand
 * in for them. The first is the definition of big-O drawn out — `f(n)` under
 * `c·g(n)` from some `n₀` onwards — where the whole content is the crossing,
 * and a table of numbers hides exactly the thing being defined. The second is
 * the one at the other end of the subject: the times you actually measured,
 * plotted against `n`, which is how you find out that your `O(n log n)` sort
 * has an `O(n²)` line in it.
 *
 * So a series here is either an expression or a row of numbers, and they draw
 * the same way on the same axes:
 *
 *     x: 1..64
 *     n log n
 *     n^2 / 4
 *     measured: 2 9 21 48 96 210
 *
 * Curves are labelled at their right-hand end rather than in a legend. A legend
 * makes the reader look away from the picture, match a colour, and look back,
 * and with four lines that is four round trips; a name at the end of the line
 * is read where the line is. Bars keep a legend, because bars have no end to
 * label.
 *
 * `log:` switches either axis to a logarithmic scale, which is not a
 * decoration: on log-log axes a polynomial is a straight line whose slope is
 * its exponent, and "is this quadratic or is it n log n" stops being a matter
 * of opinion about the shape of a curve.
 */

import { accentValue, ellipsize, label, round, svg, textWidth } from './svg'
import { items, flag, readSource, VizError } from './source'
import { compile } from './expr'
import type { Figure } from './tree'

export const CHART_KEYS = [
  'title',
  'caption',
  'x',
  'y',
  'xlabel',
  'ylabel',
  'log',
  'bars',
  'mark',
  'points',
  'width',
  'height'
] as const

/** The colours series take, in order. Named, so both themes get their own. */
const CYCLE = ['blue', 'red', 'green', 'purple', 'yellow', 'gray']

interface Series {
  name: string
  accent: string
  /** Sampled or given, in domain order. A non-finite `y` is a gap. */
  points: Array<{ x: number; y: number }>
  /** Whether it came from data rather than an expression — data gets dots. */
  measured: boolean
}

interface Scale {
  /** Domain to pixels. */
  to: (value: number) => number
  lo: number
  hi: number
  log: boolean
}

// --------------------------------------------------------------------- ticks

/**
 * Round numbers to put on an axis.
 *
 * The 1-2-5 ladder, which is what every axis anyone finds readable is built on:
 * a tick lands on a number a person can say out loud, and the gaps between the
 * numbers stay even.
 */
function niceTicks(lo: number, hi: number, wanted: number): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / Math.max(1, wanted)
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const scaled = raw / magnitude
  const step = (scaled >= 5 ? 10 : scaled >= 2 ? 5 : scaled >= 1 ? 2 : 1) * magnitude

  const out: number[] = []
  for (let at = Math.ceil(lo / step) * step; at <= hi + step * 1e-9; at += step) {
    // The multiply-and-round keeps 0.30000000000000004 off the axis.
    out.push(Math.round(at / step) * step)
  }
  return out
}

/** Decade ticks, with the halves filled in when a plot spans only one or two. */
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = []
  const from = Math.floor(Math.log10(lo))
  const to = Math.ceil(Math.log10(hi))
  const sparse = to - from > 4
  for (let power = from; power <= to; power++) {
    for (const step of sparse ? [1] : [1, 2, 5]) {
      const value = step * Math.pow(10, power)
      if (value >= lo * 0.999 && value <= hi * 1.001) out.push(value)
    }
  }
  return out
}

/**
 * A number, as short as it can be said.
 *
 * An `n²` plot reaches six figures by the middle of its axis, and six figures
 * repeated down a margin is a wall rather than a scale.
 */
function short(value: number): string {
  const size = Math.abs(value)
  if (size === 0) return '0'
  if (size >= 1e9) return `${trim(value / 1e9)}B`
  if (size >= 1e6) return `${trim(value / 1e6)}M`
  if (size >= 1e4) return `${trim(value / 1e3)}k`
  if (size >= 1) return trim(value)
  if (size >= 0.001) return trim(value)
  return value.toExponential(0)
}

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

// -------------------------------------------------------------------- reading

/** `1..64`, `1 2 4 8 16`, or nothing. */
function readDomain(raw: string | undefined): { lo: number; hi: number } | number[] | null {
  if (!raw) return null
  const span = /^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/.exec(raw.trim())
  if (span) {
    const lo = Number(span[1])
    const hi = Number(span[2])
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      throw new VizError(`\`${raw}\` is not a range. Write it as \`1..64\`.`)
    }
    return { lo, hi }
  }
  const list = items(raw).map(Number)
  if (list.length === 0 || list.some((one) => !Number.isFinite(one))) {
    throw new VizError(`\`${raw}\` is neither a range like \`1..64\` nor a list of numbers`)
  }
  return list
}

interface Read {
  name: string
  /** Present for a data series. */
  values?: number[]
  /** Present for a function series. */
  fn?: (n: number) => number
}

/**
 * One body line: a row of measurements, or a function of `n`.
 *
 * The `name: 1 2 3` form is checked first and only counts when everything after
 * the colon is a number — otherwise `time: n log n` would be read as a series
 * called `time` with no numbers in it rather than a named curve. A line with no
 * colon at all is an expression that labels itself, which is what you want for
 * `n^2`: naming it would only mean writing it twice.
 */
function readSeries(text: string, line: number): Read {
  // `bars` and `points` are settings, and a setting needs its colon. Written
  // bare they land here as an expression and fail on the variable name, which
  // is a true but useless thing to say about them.
  if ((CHART_KEYS as readonly string[]).includes(text.trim().toLowerCase())) {
    throw new VizError(`\`${text.trim()}\` is a setting rather than a series — write it as \`${text.trim()}:\``, line)
  }

  const named = /^([^=:]+?)\s*=\s*(.+)$/.exec(text)
  if (named) return { name: named[1].trim(), fn: compile(named[2], line) }

  const row = /^([^:]+?)\s*:\s*(.+)$/.exec(text)
  if (row) {
    const numbers = items(row[2]).map(Number)
    if (numbers.length && numbers.every((one) => Number.isFinite(one))) {
      return { name: row[1].trim(), values: numbers }
    }
    return { name: row[1].trim(), fn: compile(row[2], line) }
  }

  return { name: text.trim(), fn: compile(text, line) }
}

// --------------------------------------------------------------------- layout

const LEFT = 52
const RIGHT = 96
const TOP = 12
const BOTTOM = 40
const TICK_SIZE = 9
const NAME_SIZE = 10

export function drawChart(source: string): Figure {
  const { directives, lines } = readSource(source, CHART_KEYS)
  if (lines.length === 0) {
    throw new VizError('nothing to plot. Write one series a line: `n log n`, or `measured: 2 9 21 48`.')
  }

  const read = lines.map((line) => readSeries(line.text, line.n))
  const bars = flag(directives, 'bars')

  // `log: x`, `log: y`, `log: xy`, or a bare `log:` for both — which is what a
  // log-log plot is, and the only one anyone writes without thinking.
  const logAxes = (directives.get('log') ?? '').toLowerCase().trim()
  const bothAxes = directives.has('log') && ['', 'both', 'true', 'yes', 'on'].includes(logAxes)
  const logX = bothAxes || logAxes.includes('x')
  const logY = bothAxes || logAxes.includes('y')

  // The domain. An explicit list wins; failing that, the longest row of data
  // decides how many points there are; failing that, a plot of pure functions
  // gets a default wide enough for the shapes to separate.
  const asked = readDomain(directives.get('x'))
  const longest = Math.max(0, ...read.map((one) => one.values?.length ?? 0))
  const explicit = Array.isArray(asked) ? asked : null
  const span = asked && !Array.isArray(asked) ? asked : null

  let xs: number[]
  if (explicit) {
    xs = explicit
  } else if (span && longest === 0) {
    xs = []
  } else if (span) {
    xs = Array.from({ length: longest }, (_, at) =>
      longest === 1 ? span.lo : span.lo + ((span.hi - span.lo) * at) / (longest - 1)
    )
  } else {
    xs = Array.from({ length: longest }, (_, at) => at + 1)
  }

  const domain = span ?? {
    lo: xs.length ? Math.min(...xs) : 1,
    hi: xs.length ? Math.max(...xs) : 32
  }
  if (logX && domain.lo <= 0) {
    throw new VizError('a logarithmic x axis cannot start at or below zero — give it `x: 1..64`')
  }

  // A curve is sampled finely enough that it reads as a curve; on a log axis
  // the samples are spaced geometrically, or the left-hand decade would be one
  // pixel wide and the right-hand one would hold every sample.
  const SAMPLES = 160
  const sampleAt = (at: number): number => {
    const t = at / (SAMPLES - 1)
    return logX
      ? domain.lo * Math.pow(domain.hi / domain.lo, t)
      : domain.lo + (domain.hi - domain.lo) * t
  }

  const series: Series[] = read.map((one, index) => {
    const accent = CYCLE[index % CYCLE.length]
    if (one.values) {
      if (xs.length < one.values.length) {
        throw new VizError(
          `\`${one.name}\` has ${one.values.length} values but the x axis only names ${xs.length}. Give it \`x: 1..${one.values.length}\` or a longer \`x:\` list.`
        )
      }
      return {
        name: one.name,
        accent,
        measured: true,
        points: one.values.map((y, at) => ({ x: xs[at], y }))
      }
    }
    const fn = one.fn!
    return {
      name: one.name,
      accent,
      measured: false,
      points: Array.from({ length: SAMPLES }, (_, at) => {
        const x = sampleAt(at)
        return { x, y: fn(x) }
      })
    }
  })

  const finite = series.flatMap((one) => one.points.filter((p) => Number.isFinite(p.y)).map((p) => p.y))
  if (finite.length === 0) throw new VizError('every value came out as nothing to plot — check the expressions')

  const positive = finite.filter((one) => one > 0)
  if (logY && positive.length === 0) {
    throw new VizError('a logarithmic y axis needs something above zero to plot')
  }

  const askedY = readDomain(directives.get('y'))
  const yRange = Array.isArray(askedY)
    ? { lo: Math.min(...askedY), hi: Math.max(...askedY) }
    : (askedY ?? {
        // A linear plot is anchored at zero, because a growth curve that does
        // not show its own origin exaggerates whatever it is doing; a log one
        // cannot be, and starts at the smallest thing it has.
        lo: logY ? Math.min(...positive) : Math.min(0, ...finite),
        hi: Math.max(...finite)
      })
  if (yRange.hi <= yRange.lo) yRange.hi = yRange.lo + 1
  if (logY && yRange.lo <= 0) yRange.lo = Math.min(...positive)

  const plotW = Math.max(200, Math.min(900, Number(directives.get('width')) || 440))
  const plotH = Math.max(120, Math.min(600, Number(directives.get('height')) || 240))

  const scaleFor = (lo: number, hi: number, from: number, to: number, log: boolean): Scale => {
    const project = log
      ? (value: number) =>
          from + ((Math.log10(value) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (to - from)
      : (value: number) => from + ((value - lo) / (hi - lo)) * (to - from)
    return { to: project, lo, hi, log }
  }

  const x = scaleFor(domain.lo, domain.hi, LEFT, LEFT + plotW, logX)
  const y = scaleFor(yRange.lo, yRange.hi, TOP + plotH, TOP, logY)

  const width = LEFT + plotW + RIGHT
  const height = TOP + plotH + BOTTOM + (bars ? 22 : 0)

  const title = directives.get('title')
  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `0 0 ${round(width)} ${round(height)}`,
    width: round(width),
    height: round(height),
    role: 'img',
    'aria-label': title ? `Chart: ${title}` : 'Chart'
  })

  const grid = svg('g', { class: 'viz-chart__grid' })
  const axes = svg('g', { class: 'viz-chart__axes' })
  const plot = svg('g', { class: 'viz-chart__plot' })
  const marks = svg('g', { class: 'viz-chart__marks' })
  root.append(grid, axes, plot, marks)

  // ------------------------------------------------------------------- axes

  const yTicks = logY ? logTicks(yRange.lo, yRange.hi) : niceTicks(yRange.lo, yRange.hi, 5)
  for (const value of yTicks) {
    const at = y.to(value)
    if (!Number.isFinite(at)) continue
    grid.appendChild(
      svg('line', { class: 'viz-chart__gridline', x1: LEFT, y1: round(at), x2: round(LEFT + plotW), y2: round(at) })
    )
    axes.appendChild(label(short(value), LEFT - 8, round(at), 'viz-chart__tick', TICK_SIZE, 'end'))
  }

  // Bars stand in slots rather than at points, so the axis under them counts
  // categories: a tick beside a bar it does not belong to is a chart that lies
  // about which reading is which.
  const categories = xs.length ? xs : (logX ? logTicks(domain.lo, domain.hi) : niceTicks(domain.lo, domain.hi, 6))
  const groupW = plotW / Math.max(1, categories.length)
  const centre = (slot: number): number => LEFT + slot * groupW + groupW / 2

  if (bars) {
    categories.forEach((value, slot) => {
      axes.appendChild(
        label(short(value), round(centre(slot)), round(TOP + plotH + 13), 'viz-chart__tick', TICK_SIZE)
      )
    })
  } else {
    const xTicks = logX ? logTicks(domain.lo, domain.hi) : niceTicks(domain.lo, domain.hi, 6)
    for (const value of xTicks) {
      const at = x.to(value)
      if (!Number.isFinite(at)) continue
      grid.appendChild(
        svg('line', { class: 'viz-chart__gridline', x1: round(at), y1: TOP, x2: round(at), y2: round(TOP + plotH) })
      )
      axes.appendChild(label(short(value), round(at), round(TOP + plotH + 13), 'viz-chart__tick', TICK_SIZE))
    }
  }

  axes.appendChild(
    svg('path', {
      class: 'viz-chart__axis',
      d: `M ${LEFT} ${TOP} L ${LEFT} ${round(TOP + plotH)} L ${round(LEFT + plotW)} ${round(TOP + plotH)}`
    })
  )

  const xLabel = directives.get('xlabel') ?? 'n'
  axes.appendChild(
    label(xLabel, round(LEFT + plotW / 2), round(TOP + plotH + 30), 'viz-chart__axis-label', NAME_SIZE)
  )
  const yLabel = directives.get('ylabel')
  if (yLabel) {
    const spun = label(yLabel, 0, 0, 'viz-chart__axis-label', NAME_SIZE)
    spun.setAttribute('transform', `translate(12 ${round(TOP + plotH / 2)}) rotate(-90)`)
    axes.appendChild(spun)
  }

  // ----------------------------------------------------------------- series

  if (bars) {
    const spread = groupW * 0.72
    const barW = Math.max(2, spread / Math.max(1, series.length))
    series.forEach((one, index) => {
      const colour = accentValue(one.accent)
      one.points.forEach((point) => {
        if (!Number.isFinite(point.y)) return
        const slot = categories.indexOf(point.x)
        if (slot < 0) return
        // Centred on the category rather than started at its left edge, so a
        // group of two and a group of five both sit under their own tick.
        const left = centre(slot) - spread / 2 + index * barW
        const top = y.to(point.y)
        const base = y.to(logY ? yRange.lo : Math.max(yRange.lo, 0))
        const bar = svg('rect', {
          class: 'viz-chart__bar',
          x: round(left),
          y: round(Math.min(top, base)),
          width: round(barW),
          height: round(Math.abs(base - top)),
          rx: 1.5
        })
        if (colour) bar.style.setProperty('--viz-accent', colour)
        plot.appendChild(bar)
      })
    })

    // Bars have no right-hand end to write a name beside, so this is the one
    // case that keeps a legend, laid along the bottom where it is out of the way.
    let cursor = LEFT
    series.forEach((one) => {
      const colour = accentValue(one.accent)
      const key = svg('g', { class: 'viz-chart__key' })
      const swatch = svg('rect', {
        class: 'viz-chart__bar',
        x: round(cursor),
        y: round(TOP + plotH + BOTTOM - 4),
        width: 9,
        height: 9,
        rx: 1.5
      })
      if (colour) swatch.style.setProperty('--viz-accent', colour)
      key.append(
        swatch,
        label(one.name, round(cursor + 14), round(TOP + plotH + BOTTOM + 1), 'viz-chart__name', NAME_SIZE, 'start')
      )
      if (colour) key.style.setProperty('--viz-accent', colour)
      plot.appendChild(key)
      cursor += 14 + textWidth(one.name, NAME_SIZE) + 18
    })
  } else {
    const dots = flag(directives, 'points')
    for (const one of series) {
      const colour = accentValue(one.accent)
      const group = svg('g', { class: `viz-chart__series${one.measured ? ' is-measured' : ''}` })
      if (colour) group.style.setProperty('--viz-accent', colour)

      // A gap in the data is a break in the line, not a jump across it: a
      // value that was infinite or undefined is a place the function has
      // nothing to say, and joining across it would draw a claim.
      let path = ''
      let drawing = false
      let last: { x: number; y: number } | null = null
      for (const point of one.points) {
        const inside = Number.isFinite(point.y) && (!logY || point.y > 0)
        if (!inside) {
          drawing = false
          continue
        }
        const px = x.to(point.x)
        const py = y.to(point.y)
        // Clipped rather than clamped: a curve that leaves the top of the plot
        // should stop at the top, not run along it.
        if (py < TOP - 2 || py > TOP + plotH + 2) {
          if (drawing) {
            path += ` L ${round(px)} ${round(Math.max(TOP - 2, Math.min(TOP + plotH + 2, py)))}`
            drawing = false
          }
          continue
        }
        path += `${drawing ? ' L' : ' M'} ${round(px)} ${round(py)}`
        drawing = true
        last = { x: px, y: py }
        if (dots || one.measured) {
          group.appendChild(svg('circle', { class: 'viz-chart__dot', cx: round(px), cy: round(py), r: 2.6 }))
        }
      }

      if (path) group.insertBefore(svg('path', { class: 'viz-chart__line', d: path.trim() }), group.firstChild)

      if (last) {
        group.appendChild(
          label(
            ellipsize(one.name, NAME_SIZE, RIGHT - 10),
            round(Math.min(last.x + 6, LEFT + plotW + 6)),
            round(last.y),
            'viz-chart__name',
            NAME_SIZE,
            'start'
          )
        )
      }
      plot.appendChild(group)
    }
  }

  // ------------------------------------------------------------------ marks

  // `mark: 8 n₀` — the vertical rule that turns a pair of curves into the
  // definition of big-O. Several are allowed, comma-separated, because the
  // sandwich figure needs one at each end.
  for (const one of (directives.get('mark') ?? '').split(',')) {
    const text = one.trim()
    if (!text) continue
    const parts = text.split(/\s+/)
    const value = Number(parts[0])
    if (!Number.isFinite(value)) throw new VizError(`\`${text}\` is not a place to mark — start it with a number on the x axis`)
    const at = x.to(value)
    marks.appendChild(
      svg('line', { class: 'viz-chart__mark', x1: round(at), y1: TOP, x2: round(at), y2: round(TOP + plotH) })
    )
    const name = parts.slice(1).join(' ')
    if (name) {
      marks.appendChild(label(name, round(at), round(TOP - 2), 'viz-chart__mark-label', NAME_SIZE))
    }
  }

  return { root, title, caption: directives.get('caption') }
}

/**
 * `threads` — an interleaving, drawn.
 *
 * The one thing about concurrency that cannot be explained in prose: that the
 * bug is not in either thread. Both threads here are correct. What is wrong is
 * the *order*, and an order is a picture — one column per thread, time down the
 * page, and the reader's eye doing the interleaving that a paragraph would have
 * to describe step by step and would still not make felt.
 *
 * It is a still figure rather than an animation on purpose. A race is not
 * something that happens over time to be watched; it is one particular schedule
 * out of the many the machine was allowed to pick, and the argument is about
 * comparing it with another one. Two `threads` blocks side by side is that
 * argument. An animation would show one schedule beautifully and make the
 * comparison impossible.
 *
 * A lock is drawn as a bar down the side of the column that holds it, which is
 * the only notation here that is not simply a box in a column: mutual exclusion
 * is a claim about a *span* of time, and a span has to be drawn as one or the
 * reader is back to counting rows.
 */

import { accentStyle, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, readSource, VizError, type Annotated } from './source'
import type { Figure } from './tree'

export const THREADS_KEYS = ['title', 'caption', 'threads'] as const

interface Action extends Annotated {
  /** Which column it belongs to. */
  lane: number
  /** Which row — one per step, in the order written. */
  row: number
  /** A lock this action takes, releases, or is stuck waiting for. */
  monitor?: { name: string; kind: 'lock' | 'unlock' | 'wait' }
}

interface Held {
  lane: number
  name: string
  from: number
  to: number
}

const LANE_W = 168
const LANE_GAP = 26
const ROW_H = 40
const BOX_H = 28
const HEAD_H = 26
const GUTTER = 30
const NOTE_GAP = 18
const PAD = 14
const TEXT = 11
const SUB = 9

/**
 * `T1 read x | 0` — a thread, then whatever it did.
 *
 * The thread name is the first word and nothing else, which is the one rule
 * that makes the rest of the line free-form: an action is a fragment of code
 * and must be allowed to contain any character a fragment of code contains.
 */
const STEP_RE = /^(\S+)\s+(.+)$/
const LOCK_RE = /^(lock|unlock|acquire|release|wait|blocked)\s+(\S+)$/i

export function drawThreads(source: string): Figure {
  const { directives, lines } = readSource(source, THREADS_KEYS)

  const lanes: string[] = []
  for (const name of (directives.get('threads') ?? '').split(/[\s,]+/).filter(Boolean)) lanes.push(name)

  const laneOf = (name: string): number => {
    const at = lanes.indexOf(name)
    if (at >= 0) return at
    // Declaring `threads:` is optional: a thread comes into existence the first
    // time it does something, in the order the schedule first mentions it.
    lanes.push(name)
    return lanes.length - 1
  }

  const actions: Action[] = []
  const notes: Array<{ row: number; text: string }> = []
  let row = 0

  for (const line of lines) {
    const step = STEP_RE.exec(line.text)
    if (!step) {
      throw new VizError(
        `\`${line.text}\` is not a step. Write one as \`T1 read x\`, or \`note …\` for a remark.`,
        line.n
      )
    }

    const [, who, rest] = step
    if (who.toLowerCase() === 'note') {
      // A note hangs off the row above it, which is the one it is about.
      notes.push({ row: Math.max(0, row - 1), text: rest.trim() })
      continue
    }

    const lane = laneOf(who)
    const read = annotate(rest)
    const lock = LOCK_RE.exec(read.label)
    actions.push({
      ...read,
      lane,
      row,
      monitor: lock
        ? {
            name: lock[2],
            kind: /^(lock|acquire)$/i.test(lock[1]) ? 'lock' : /^(unlock|release)$/i.test(lock[1]) ? 'unlock' : 'wait'
          }
        : undefined
    })
    row++
  }

  if (actions.length === 0) {
    throw new VizError('nothing to schedule. Write one step a line, as `T1 read x` and `T2 read x`.')
  }

  // ---- the held spans, from the lock and unlock steps.
  const held: Held[] = []
  const open = new Map<string, Held>()
  for (const action of actions) {
    const monitor = action.monitor
    if (!monitor) continue
    const key = `${action.lane}:${monitor.name}`
    if (monitor.kind === 'lock') {
      const span: Held = { lane: action.lane, name: monitor.name, from: action.row, to: action.row }
      open.set(key, span)
      held.push(span)
    } else if (monitor.kind === 'unlock') {
      const span = open.get(key)
      if (!span) {
        throw new VizError(`\`${lanes[action.lane]}\` releases \`${monitor.name}\` without having taken it`)
      }
      span.to = action.row
      open.delete(key)
    }
  }
  // A lock still held at the end of the schedule is held to the end of the
  // figure — which is usually the point being made.
  for (const span of open.values()) span.to = row - 1

  // ---- geometry
  const rows = row
  const noteWidth = notes.length
    ? Math.min(240, Math.max(...notes.map((one) => textWidth(one.text, SUB) + 10)))
    : 0
  const boardW = lanes.length * LANE_W + (lanes.length - 1) * LANE_GAP
  const width = GUTTER + boardW + (noteWidth ? NOTE_GAP + noteWidth : 0)
  const height = HEAD_H + rows * ROW_H

  const laneX = (lane: number): number => GUTTER + lane * (LANE_W + LANE_GAP)
  const rowY = (at: number): number => HEAD_H + at * ROW_H + ROW_H / 2

  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `${-PAD} ${-PAD} ${round(width + PAD * 2)} ${round(height + PAD * 2)}`,
    width: round(width + PAD * 2),
    height: round(height + PAD * 2),
    role: 'img'
  })

  // ---- the lanes: a heading, and a line down the middle of each column.
  for (let lane = 0; lane < lanes.length; lane++) {
    const x = laneX(lane)
    root.appendChild(label(ellipsize(lanes[lane], TEXT, LANE_W), round(x + LANE_W / 2), 8, 'viz-thread__name', TEXT))
    root.appendChild(
      svg('line', {
        class: 'viz-thread__spine',
        x1: round(x + LANE_W / 2),
        y1: HEAD_H - 4,
        x2: round(x + LANE_W / 2),
        y2: round(height)
      })
    )
  }

  // ---- time, down the left edge.
  for (let at = 0; at < rows; at++) {
    root.appendChild(label(String(at + 1), GUTTER - 12, round(rowY(at)), 'viz-thread__tick', SUB, 'end'))
  }

  // ---- the held spans, under everything: a bar down the side of the column.
  for (const span of held) {
    const x = laneX(span.lane) + 5
    root.appendChild(
      svg('rect', {
        class: 'viz-thread__held',
        x: round(x),
        y: round(rowY(span.from) - BOX_H / 2),
        width: 4,
        height: round(rowY(span.to) - rowY(span.from) + BOX_H),
        rx: 2
      })
    )
    root.appendChild(
      svg(
        'text',
        {
          class: 'viz-thread__monitor',
          x: round(x - 3),
          y: round((rowY(span.from) + rowY(span.to)) / 2),
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-size': SUB,
          // Set down the bar rather than beside it: a column is only so wide,
          // and the name of the monitor must not push the code out of the box.
          transform: `rotate(-90 ${round(x - 3)} ${round((rowY(span.from) + rowY(span.to)) / 2)})`
        },
        [span.name]
      )
    )
  }

  // ---- the actions.
  for (const action of actions) {
    const x = laneX(action.lane) + 12
    const w = LANE_W - 24
    const y = rowY(action.row)
    const waiting = action.monitor?.kind === 'wait'
    const group = svg('g', {
      class: `viz-thread__step${action.highlight ? ' is-marked' : ''}${action.dim || waiting ? ' is-dim' : ''}`,
      style: accentStyle(action.accent)
    })

    group.appendChild(
      svg('rect', {
        // A thread that is blocked is drawn dashed and faded: it is in the
        // schedule — that is the whole point of showing it — but nothing
        // happened, and a solid box would say something did.
        class: `viz-cell__shape${waiting ? ' viz-thread__blocked' : ''}`,
        x: round(x),
        y: round(y - BOX_H / 2),
        width: round(w),
        height: BOX_H,
        rx: 5
      })
    )
    group.appendChild(
      label(ellipsize(action.label, TEXT, w - 12), round(x + w / 2), round(y - (action.sub ? 5 : 0)), 'viz-cell__value', TEXT)
    )
    if (action.sub) {
      group.appendChild(label(ellipsize(action.sub, SUB, w - 12), round(x + w / 2), round(y + 8), 'viz-node__sub', SUB))
    }
    root.appendChild(group)
  }

  // ---- the remarks, in the right-hand margin.
  for (const note of notes) {
    const y = rowY(Math.min(note.row, rows - 1))
    const x = GUTTER + boardW + NOTE_GAP
    root.appendChild(
      svg('line', { class: 'viz-thread__leader', x1: round(x - NOTE_GAP + 4), y1: round(y), x2: round(x - 4), y2: round(y) })
    )
    root.appendChild(label(ellipsize(note.text, SUB, noteWidth), round(x), round(y), 'viz-thread__note', SUB, 'start'))
  }

  return { root, title: directives.get('title'), caption: directives.get('caption') }
}

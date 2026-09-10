/**
 * The `hash` fence: a hash table, with the collisions in it.
 *
 * Every other figure in this folder draws something the reader can already
 * point at in the source — an object, a node, a type. A hash table is the one
 * data structure whose picture is *computed*: which bucket a key lands in is
 * the answer to an arithmetic question, and the entire lesson is that the
 * answer is not the one you would have guessed. So this fence does the
 * arithmetic. You give it the keys and the table size, and it hashes them,
 * places them, resolves the collisions and draws what came out.
 *
 * That is also why it refuses to let you write the table out by hand *and* give
 * it keys. A figure that says `44` is in bucket 2 because the author typed it
 * there is worth nothing when the point of drawing it was to find out where 44
 * goes. Either the fence computes the whole table, or you are drawing a table
 * from a book and it draws exactly what you wrote.
 *
 *     buckets: 7
 *     keys: 12 44 13 88 23 94 11
 *
 * Seven keys, seven buckets, and the chains fall where the modulus puts them.
 * Switch `probe:` to `linear` and the same keys lay themselves out in the
 * array instead, each one carrying the number of probes it cost to get there —
 * which is the number the chaining picture cannot show and the reason open
 * addressing is taught at all.
 */

import { accentStyle, arrowDefs, ellipsize, label, round, svg, textWidth } from './svg'
import { annotate, items, readSource, VizError, type Annotated } from './source'
import type { Figure } from './tree'

export const HASH_KEYS = [
  'title',
  'caption',
  'buckets',
  'keys',
  'hash',
  'probe',
  'load',
  'remove',
  'show'
] as const

/** How a collision is dealt with, which decides the whole shape of the figure. */
type Probe = 'chain' | 'linear' | 'quadratic' | 'double'

const PROBES: Record<string, Probe> = {
  chain: 'chain',
  chaining: 'chain',
  separate: 'chain',
  linear: 'linear',
  quadratic: 'quadratic',
  double: 'double',
  rehash: 'double'
}

/**
 * The hash functions a key can be put through.
 *
 * `mod` is the identity — the key *is* its hash, and the bucket is `k % m`,
 * which is what every worked example with numbers in it does. `java` is
 * `String.hashCode`, spelled exactly as the JDK spells it, because a figure of
 * a `HashMap` that used some other string hash would put the keys in the wrong
 * buckets and be a lie about the class it claims to be drawing. The other two
 * are the deliberately-bad hashes a lecture uses to show what a bad hash does.
 */
type Hasher = 'mod' | 'java' | 'length' | 'first' | 'sum'

const HASHERS = new Set<string>(['mod', 'java', 'length', 'first', 'sum'])

/** Java's `String.hashCode`: `s[0]*31^(n-1) + s[1]*31^(n-2) + …`, wrapping at 32 bits. */
function javaHash(text: string): number {
  let h = 0
  for (let at = 0; at < text.length; at++) h = (Math.imul(31, h) + text.charCodeAt(at)) | 0
  return h
}

function hashOf(key: string, how: Hasher): number {
  switch (how) {
    case 'mod':
      return Number(key)
    case 'java':
      return javaHash(key)
    case 'length':
      return key.length
    case 'first':
      return key.charCodeAt(0) - 97
    case 'sum': {
      let total = 0
      for (let at = 0; at < key.length; at++) total += key.charCodeAt(at)
      return total
    }
  }
}

/** Java's `Math.floorMod`: a bucket index is never negative, whatever the hash was. */
function floorMod(value: number, m: number): number {
  return ((value % m) + m) % m
}

// ------------------------------------------------------------------ the table

interface Entry extends Annotated {
  /** The raw hash, before it was folded into the table. */
  hash: number
  /** The bucket the hash asked for. */
  home: number
  /** Where it actually ended up — the same as `home` unless it was probed on. */
  at: number
  /** How many slots were tried. 1 means it landed first time. */
  probes: number
  /** An open-addressing slot whose key was removed, and which a probe must run past. */
  tombstone?: boolean
}

interface Table {
  buckets: number
  /** For chaining: the chain in each bucket, in insertion order. */
  chains: Entry[][]
  /** For open addressing: the entry in each slot, or null. */
  slots: Array<Entry | null>
  probe: Probe
  hasher: Hasher
  /** How many times the table doubled while the keys were going in. */
  grew: number
  count: number
}

function emptyTable(buckets: number, probe: Probe, hasher: Hasher): Table {
  return {
    buckets,
    chains: Array.from({ length: buckets }, () => []),
    slots: Array.from({ length: buckets }, () => null),
    probe,
    hasher,
    grew: 0,
    count: 0
  }
}

/**
 * Where a key goes, and what it cost to get there.
 *
 * The probe sequences are the textbook three. Double hashing's second hash is
 * `1 + (h mod (m - 1))`, which is the standard choice for the same reason it is
 * always the standard choice: it is never zero, so the walk cannot stand still,
 * and for a prime `m` it is coprime with the table, so the walk reaches every
 * slot before it repeats.
 */
function place(table: Table, entry: Entry): void {
  const m = table.buckets

  if (table.probe === 'chain') {
    table.chains[entry.home].push(entry)
    entry.at = entry.home
    entry.probes = table.chains[entry.home].length
    return
  }

  const second = 1 + floorMod(entry.hash, Math.max(1, m - 1))
  for (let i = 0; i < m; i++) {
    const at =
      table.probe === 'linear'
        ? floorMod(entry.home + i, m)
        : table.probe === 'quadratic'
          ? floorMod(entry.home + i * i, m)
          : floorMod(entry.home + i * second, m)
    const sitting = table.slots[at]
    if (!sitting || sitting.tombstone) {
      entry.at = at
      entry.probes = i + 1
      table.slots[at] = entry
      return
    }
  }

  throw new VizError(
    `the table is full — ${m} slots and nowhere left for \`${entry.label}\`. Give it more \`buckets:\`, or a \`load:\` to grow at.`
  )
}

function insert(table: Table, raw: Annotated, hasher: Hasher): void {
  const hash = hashOf(raw.label, hasher)
  if (!Number.isFinite(hash)) {
    throw new VizError(
      `\`${raw.label}\` is not a number, so \`hash: mod\` has nothing to divide. Use \`hash: java\` for keys that are words.`
    )
  }
  place(table, { ...raw, hash, home: floorMod(hash, table.buckets), at: 0, probes: 0 })
  table.count++
}

/** Everything in the table, in the order it went in. */
function entries(table: Table): Entry[] {
  return table.probe === 'chain'
    ? table.chains.flat()
    : table.slots.filter((one): one is Entry => one !== null && !one.tombstone)
}

/**
 * Double the table and put every key through the new modulus.
 *
 * This is the operation the picture exists for. A reader who has followed the
 * insertions knows where every key is; a rehash moves nearly all of them, and
 * seeing the same seven keys land in a different arrangement is the only way
 * the cost of growing a table stops being an abstract sentence.
 */
function grow(table: Table): Table {
  const held = entries(table)
  const next = emptyTable(table.buckets * 2, table.probe, table.hasher)
  next.grew = table.grew + 1
  for (const entry of held) insert(next, entry, table.hasher)
  return next
}

// -------------------------------------------------------------------- reading

/** A body row: `3: apple banana`, the table written out rather than computed. */
function readRows(
  lines: Array<{ text: string; n: number }>,
  buckets: number
): Array<{ index: number; keys: Annotated[] }> {
  return lines.map((line) => {
    const split = /^(-?\d+)\s*:\s*(.*)$/.exec(line.text)
    if (!split) {
      throw new VizError(
        `\`${line.text}\` is not a bucket. Write a row as \`3: apple banana\`, or give \`keys:\` and let the fence hash them.`,
        line.n
      )
    }
    const index = Number(split[1])
    if (index < 0 || index >= buckets) {
      throw new VizError(`bucket ${index} is outside a table of ${buckets}`, line.n)
    }
    const keys = items(split[2])
      .filter((one) => one !== '-' && one !== '.')
      .map((one) => annotate(one))
    return { index, keys }
  })
}

// --------------------------------------------------------------------- layout

const INDEX_W = 26
const SLOT_H = 28
const ROW_GAP = 5
const MIN_SLOT_W = 42
const CHAIN_GAP = 30
const PROBE_W = 22
const PAD = 16
const KEY_SIZE = 12
const SUB_SIZE = 9

function keyWidth(text: string): number {
  return Math.max(MIN_SLOT_W, textWidth(text, KEY_SIZE) + 18)
}

function drawKeyBox(entry: Entry, x: number, y: number, w: number, sub: string | undefined): SVGGElement {
  const group = svg('g', {
    class: `viz-cell viz-hash__key${entry.highlight ? ' is-marked' : ''}${entry.dim ? ' is-dim' : ''}`,
    style: accentStyle(entry.accent)
  })
  group.appendChild(
    svg('rect', { class: 'viz-cell__shape', x: round(x), y: round(y), width: round(w), height: SLOT_H, rx: 5 })
  )
  if (sub) {
    group.appendChild(
      label(ellipsize(entry.label, KEY_SIZE, w - 8), round(x + w / 2), round(y + SLOT_H / 2 - 5), 'viz-cell__value', KEY_SIZE)
    )
    group.appendChild(
      label(ellipsize(sub, SUB_SIZE, w - 8), round(x + w / 2), round(y + SLOT_H / 2 + 8), 'viz-cell__index', SUB_SIZE)
    )
  } else {
    group.appendChild(
      label(ellipsize(entry.label, KEY_SIZE, w - 8), round(x + w / 2), round(y + SLOT_H / 2), 'viz-cell__value', KEY_SIZE)
    )
  }
  return group
}

/**
 * The figure.
 *
 * Both dialects are the same column of numbered slots down the left; what
 * changes is what hangs off them. Chaining puts a stud in the slot and runs the
 * chain out to the right, so a long chain is visibly long — the one thing the
 * reader is meant to take away. Open addressing puts the key *in* the slot and
 * draws an arc from the bucket it wanted to the one it settled for, because a
 * key sitting in slot 5 with no explanation of why is the whole confusion the
 * figure is there to remove.
 */
/**
 * The second line inside a key's box.
 *
 * For an open-addressed key it is how far it had to walk, which is the number
 * the whole picture is about and which has nowhere else to go: written beside
 * the arc instead it lands in the index column, and a figure whose annotations
 * collide with its own axis is worse than one without them.
 */
function subLine(entry: Entry, showHash: boolean, chained: boolean): string | undefined {
  if (entry.sub) return entry.sub
  if (showHash) return String(entry.hash)
  return !chained && entry.probes > 1 ? `+${entry.probes - 1}` : undefined
}

function draw(table: Table, showHash: boolean, title: string | undefined): SVGSVGElement {
  const m = table.buckets
  const all = table.probe === 'chain' ? table.chains.flat() : entries(table)
  const widest = Math.max(MIN_SLOT_W, ...all.map((one) => keyWidth(one.label)))
  const chained = table.probe === 'chain'

  const slotW = chained ? 30 : widest
  const slotX = INDEX_W + (chained ? 0 : PROBE_W)
  const longest = chained ? Math.max(0, ...table.chains.map((chain) => chain.length)) : 0
  const width = slotX + slotW + (chained ? longest * (widest + CHAIN_GAP) : 8)
  const height = m * (SLOT_H + ROW_GAP) - ROW_GAP

  const { defs, arrow, dot } = arrowDefs()
  const root = svg('svg', {
    class: 'viz__svg',
    viewBox: `${-PAD} ${-PAD} ${round(width + PAD * 2)} ${round(height + PAD * 2)}`,
    width: round(width + PAD * 2),
    height: round(height + PAD * 2),
    role: 'img',
    'aria-label': title ? `Hash table: ${title}` : 'Hash table'
  })
  root.appendChild(defs)

  const wires = svg('g', { class: 'viz-links' })
  const cells = svg('g', { class: 'viz-cells' })
  const probes = svg('g', { class: 'viz-hash__probes' })
  root.append(wires, cells, probes)

  const rowY = (index: number): number => index * (SLOT_H + ROW_GAP)

  for (let index = 0; index < m; index++) {
    const y = rowY(index)
    cells.appendChild(label(String(index), round(INDEX_W - 8), round(y + SLOT_H / 2), 'viz-cell__index', 10, 'end'))

    const sitting = chained ? null : table.slots[index]
    const empty = chained ? table.chains[index].length === 0 : !sitting || sitting.tombstone

    if (!chained && sitting && !sitting.tombstone) {
      cells.appendChild(drawKeyBox(sitting, slotX, y, slotW, subLine(sitting, showHash, false)))
    } else {
      cells.appendChild(
        svg('rect', {
          class: `viz-cell__shape${empty ? ' viz-hash__slot--empty' : ''}`,
          x: round(slotX),
          y: round(y),
          width: round(slotW),
          height: SLOT_H,
          rx: 5
        })
      )
      // A tombstone is not an empty slot and must not look like one: a probe
      // walks past it, and a figure that drew it blank would make the next
      // lookup in the sequence inexplicable.
      if (!chained && sitting?.tombstone) {
        cells.appendChild(
          label('×', round(slotX + slotW / 2), round(y + SLOT_H / 2), 'viz-hash__tombstone', KEY_SIZE)
        )
      }
    }

    if (chained) {
      const chain = table.chains[index]
      if (chain.length === 0) {
        cells.appendChild(label('∅', round(slotX + slotW / 2), round(y + SLOT_H / 2), 'viz-row__nil', 11))
        continue
      }
      cells.appendChild(
        svg('circle', { class: 'viz-row__stud', cx: round(slotX + slotW / 2), cy: round(y + SLOT_H / 2), r: 3.2 })
      )
      let x = slotX + slotW
      for (const entry of chain) {
        const w = widest
        wires.appendChild(
          svg('line', {
            class: 'viz-link',
            x1: round(x === slotX + slotW ? slotX + slotW / 2 : x),
            y1: round(y + SLOT_H / 2),
            x2: round(x + CHAIN_GAP - 4),
            y2: round(y + SLOT_H / 2),
            'marker-end': arrow,
            'marker-start': x === slotX + slotW ? undefined : dot
          })
        )
        x += CHAIN_GAP
        cells.appendChild(drawKeyBox(entry, x, y, w, subLine(entry, showHash, true)))
        x += w
      }
    }
  }

  // The probe arcs, drawn last so they sit over the slots they run past. Only
  // the keys that actually had to move get one — an arc from a slot to itself
  // would be noise on every row that behaved.
  if (!chained) {
    for (const entry of entries(table)) {
      if (entry.probes <= 1) continue
      const from = rowY(entry.home) + SLOT_H / 2
      const to = rowY(entry.at) + SLOT_H / 2
      const bulge = Math.min(PROBE_W - 6, 8 + Math.abs(to - from) * 0.12)
      const x = slotX - 4
      probes.appendChild(
        svg('path', {
          class: 'viz-hash__probe',
          d: `M ${round(x)} ${round(from)} C ${round(x - bulge)} ${round(from)}, ${round(x - bulge)} ${round(to)}, ${round(x)} ${round(to)}`,
          'marker-end': arrow
        })
      )
    }
  }

  return root
}

/**
 * What the table turned out to be like, in one line.
 *
 * Written automatically because these are the numbers a reader asks for the
 * moment they have understood the picture, and because they are the numbers
 * that make two figures comparable — the same keys in 8 buckets and in 16 are
 * only worth putting side by side if the load factor is under each one.
 */
function summarise(table: Table): string {
  const parts: string[] = []
  const load = table.count / table.buckets
  parts.push(`${table.count} ${table.count === 1 ? 'key' : 'keys'} in ${table.buckets} buckets, load ${load.toFixed(2)}`)

  if (table.probe === 'chain') {
    const longest = Math.max(0, ...table.chains.map((chain) => chain.length))
    const used = table.chains.filter((chain) => chain.length > 0).length
    parts.push(`longest chain ${longest}`, `${table.buckets - used} empty`)
  } else {
    const all = entries(table)
    const total = all.reduce((sum, one) => sum + one.probes, 0)
    parts.push(`${(total / Math.max(1, all.length)).toFixed(2)} probes on average`)
    const worst = Math.max(0, ...all.map((one) => one.probes))
    if (worst > 1) parts.push(`worst ${worst}`)
  }

  if (table.grew) parts.push(`grew ${table.grew}×`)
  return parts.join(' · ')
}

export function drawHash(source: string): Figure {
  const { directives, lines } = readSource(source, HASH_KEYS)

  const probeName = (directives.get('probe') ?? 'chain').toLowerCase()
  const probe = PROBES[probeName]
  if (!probe) {
    throw new VizError(`\`${probeName}\` is not a way of resolving collisions. Try chain, linear, quadratic or double.`)
  }

  const keys = items(directives.get('keys') ?? '').map((raw) => annotate(raw))
  const written = lines.length > 0

  if (written && keys.length) {
    throw new VizError(
      'give it `keys:` or write the buckets out, not both — a computed table and a typed one would disagree, and the computed one is the point.'
    )
  }
  if (!written && keys.length === 0) {
    throw new VizError('nothing to put in it. Give it `buckets: 7` and `keys: 12 44 13 88`.')
  }

  const askedFor = Number(directives.get('buckets'))
  const buckets = Number.isInteger(askedFor) && askedFor > 0 ? askedFor : 8
  if (buckets > 64) throw new VizError(`${buckets} buckets is more than a figure can show; keep it under 64`)

  // The hash follows the keys unless it was named: numbers go through the
  // modulus, words through Java's. Guessing is right here because the wrong
  // guess is loud — `hash: mod` on a word raises rather than drawing something
  // plausible and wrong.
  const named = directives.get('hash')?.toLowerCase()
  if (named && !HASHERS.has(named)) {
    throw new VizError(`\`${named}\` is not a hash here. Try mod, java, length, first or sum.`)
  }
  const numeric = keys.every((one) => Number.isFinite(Number(one.label)))
  const hasher = (named as Hasher) ?? (numeric ? 'mod' : 'java')

  let table = emptyTable(buckets, probe, hasher)

  if (written) {
    if (probe !== 'chain') {
      throw new VizError('a table written out by hand is drawn as chains; `probe:` only applies to keys the fence hashes')
    }
    for (const row of readRows(lines, buckets)) {
      for (const key of row.keys) {
        table.chains[row.index].push({ ...key, hash: NaN, home: row.index, at: row.index, probes: 1 })
        table.count++
      }
    }
  } else {
    const at = Number(directives.get('load'))
    const ceiling = Number.isFinite(at) && at > 0 ? at : Infinity
    for (const key of keys) {
      insert(table, key, hasher)
      // Grown *after* the insertion that broke the ceiling, which is when a
      // real table grows: the load factor is checked on the way out.
      if (table.count / table.buckets > ceiling) table = grow(table)
    }

    for (const gone of items(directives.get('remove') ?? '')) {
      const found = entries(table).find((one) => one.label === gone)
      if (!found) throw new VizError(`\`${gone}\` was never put in, so it cannot be removed`)
      table.count--
      if (probe === 'chain') {
        table.chains[found.at] = table.chains[found.at].filter((one) => one !== found)
      } else {
        // Emptied, not cleared. A probe that stopped here would never reach the
        // keys that were pushed past this slot on their way in.
        found.tombstone = true
      }
    }
  }

  const showHash = (directives.get('show') ?? '').toLowerCase() === 'hash'
  const title = directives.get('title')
  const root = draw(table, showHash && !written, title)

  return {
    root,
    title,
    caption: directives.get('caption') ?? (written ? undefined : summarise(table))
  }
}

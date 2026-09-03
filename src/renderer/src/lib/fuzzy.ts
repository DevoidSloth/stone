/**
 * Subsequence matching for the go-to-file picker.
 *
 * The rule people actually have in their heads when they type `csnot` at a
 * picker is "these letters, in this order, and I probably typed the starts of
 * words". So: a greedy leftmost subsequence, then bonuses for the two things
 * that make one match better than another — letters that ran together, and
 * letters that began a word. Short names win ties, because a tight match on a
 * short name is what the typist meant.
 */

export interface FuzzyMatch {
  score: number
  /** Half-open [start, end) spans of `text` that matched, for highlighting. */
  ranges: [number, number][]
}

const BOUNDARY = /[\s/\\._-]/

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  if (!q) return { score: 0, ranges: [] }

  const t = text.toLowerCase()
  const ranges: [number, number][] = []
  let score = 0
  let from = 0
  let run = 0

  for (let i = 0; i < q.length; i++) {
    const at = t.indexOf(q[i], from)
    if (at === -1) return null

    score += 1
    // A letter adjacent to the last one continues a run, and each further
    // letter of that run is worth more than the one before it.
    if (i > 0 && at === from) score += 3 + ++run
    else run = 0
    if (at === 0 || BOUNDARY.test(t[at - 1])) score += 6
    if (text[at] === query[i]) score += 1

    const last = ranges[ranges.length - 1]
    if (last && last[1] === at) last[1] = at + 1
    else ranges.push([at, at + 1])
    from = at + 1
  }

  score -= Math.min(text.length - q.length, 40) * 0.15
  return { score, ranges }
}

/** Split `text` into alternating unmatched/matched chunks, for rendering. */
export function highlight(text: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: text.slice(at, start), hit: false })
    out.push({ text: text.slice(start, end), hit: true })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

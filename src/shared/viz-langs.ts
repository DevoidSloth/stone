/**
 * Which fence languages draw a program figure.
 *
 * The drawing itself is renderer-only — it needs a DOM to build SVG in — but
 * the markdown-to-HTML pass runs in main as well, and it has to know that a
 * ```memory block is a figure rather than a code block so it can hand the
 * source on instead of printing it. That one fact is small enough to live here,
 * where both sides can see it, and keeps the two from drifting apart.
 */

export type VizKind = 'memory' | 'boxes' | 'tree' | 'algo' | 'types' | 'hash' | 'chart'

/*
 * These names, and deliberately no aliases. `stack`, `heap`, `trace` and `uml`
 * all read as obvious synonyms and all of them are things people paste under a
 * fence for other reasons — a stack trace most of all, and PlantUML under
 * `uml` — and claiming a fence that was never meant for us turns someone's
 * pasted output into an error box. `plot`, `graph` and `table` are missing for
 * the same reason: `graph` is Mermaid's own first word, and a `table` fence
 * would swallow every pasted grid in the vault.
 */
const LANGS: Record<string, VizKind> = {
  memory: 'memory',
  boxes: 'boxes',
  tree: 'tree',
  algo: 'algo',
  types: 'types',
  hash: 'hash',
  chart: 'chart'
}

/** The figure a fence language draws, or null if it draws none. */
export function vizKind(lang: string): VizKind | null {
  return LANGS[lang.toLowerCase()] ?? null
}

/**
 * Which fence languages draw a program figure.
 *
 * The drawing itself is renderer-only — it needs a DOM to build SVG in — but
 * the markdown-to-HTML pass runs in main as well, and it has to know that a
 * ```memory block is a figure rather than a code block so it can hand the
 * source on instead of printing it. That one fact is small enough to live here,
 * where both sides can see it, and keeps the two from drifting apart.
 */

export type VizKind =
  | 'memory'
  | 'boxes'
  | 'list'
  | 'tree'
  | 'graph'
  | 'algo'
  | 'types'
  | 'hash'
  | 'chart'
  | 'threads'
  | 'grammar'

/*
 * These names, and deliberately no aliases. `stack`, `heap`, `trace` and `uml`
 * all read as obvious synonyms and all of them are things people paste under a
 * fence for other reasons — a stack trace most of all, and PlantUML under
 * `uml` — and claiming a fence that was never meant for us turns someone's
 * pasted output into an error box. `plot` and `table` are missing for the same
 * reason: a `table` fence would swallow every pasted grid in the vault.
 *
 * `list` is claimed, on the other side of that same test: nothing prints under
 * it and no highlighter answers to it, so a fence tagged `list` in a vault was
 * always someone drawing a linked list by hand.
 *
 * `graph` is claimed on that same reading, and it is the one name here worth
 * arguing about, because `graph` is also Mermaid's own first word. But
 * Mermaid's *info string* is `mermaid`; its `graph` is a line inside the block,
 * where nothing here ever looks. Nothing pastes a fence tagged `graph`, and the
 * word is the one everybody reaches for. `threads` and `grammar` are unclaimed
 * by every highlighter and by every tool that prints — a fence tagged
 * `grammar` in a vault was somebody writing a grammar.
 */
const LANGS: Record<string, VizKind> = {
  memory: 'memory',
  boxes: 'boxes',
  list: 'list',
  tree: 'tree',
  graph: 'graph',
  algo: 'algo',
  types: 'types',
  hash: 'hash',
  chart: 'chart',
  threads: 'threads',
  grammar: 'grammar'
}

/** The figure a fence language draws, or null if it draws none. */
export function vizKind(lang: string): VizKind | null {
  return LANGS[lang.toLowerCase()] ?? null
}

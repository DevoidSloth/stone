import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import MiniSearch from 'minisearch'
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  Mention,
  Note,
  NoteMeta,
  PropertyDef,
  SearchHit,
  SearchMatch,
  SearchOptions,
  Snapshot,
  Task,
  TrashEntry,
  VaultEvent,
  VaultStats
} from '@shared/types'
import { inferProperties } from '@shared/properties'
import { parseNote, countWords, type ParsedNote } from './parse'
import {
  appendLine,
  assertInsideVault,
  emptyTrash,
  ensureDir,
  exists,
  hashContent,
  isIgnored,
  listFolders,
  listSnapshots,
  listTrash,
  movePath,
  readNote,
  readSnapshot,
  removeFolder,
  restoreFromTrash,
  sanitizeFilename,
  saveAttachment,
  toAbsPath,
  toRelPath,
  trashNote,
  uniquePath,
  walkMarkdown,
  writeNoteAtomic,
  writeSnapshot
} from './fs'

interface IndexedDoc {
  id: string
  title: string
  body: string
  tags: string
}

/**
 * The in-memory model of a vault: note metadata, extracted tasks, the link
 * graph, and a full-text index. Files on disk stay the source of truth — this
 * is a cache that a watcher keeps honest.
 */
export class Vault extends EventEmitter {
  vaultPath: string | null = null

  private notes = new Map<string, NoteMeta>()
  private tasks = new Map<string, Task[]>()
  private words = new Map<string, number>()
  private hashes = new Map<string, string>()
  private backlinkMap = new Map<string, Set<string>>()
  private watcher: FSWatcher | null = null
  private pending = new Map<string, NodeJS.Timeout>()
  /** Lowercased name → relPath, covering full paths, basenames, and aliases. */
  private linkIndex = new Map<string, string>()
  /** Every folder in the vault, including empty ones the note walk misses. */
  private folderCache: string[] = []
  /** Keeps a copy of every save under `.stone/snapshots` when enabled. */
  snapshotsEnabled = true

  private search_ = new MiniSearch<IndexedDoc>({
    fields: ['title', 'body', 'tags'],
    storeFields: ['title'],
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2 }
  })

  async open(vaultPath: string): Promise<void> {
    await this.close()
    this.vaultPath = vaultPath
    await ensureDir(vaultPath)
    await this.reindex()
    // An empty vault renders an empty app, which is the worst possible first
    // impression. Seed enough real content to show what Stone actually does.
    if (this.notes.size === 0) await this.seed()
    await this.refreshFolders()
    this.startWatching()
  }

  private async seed(): Promise<void> {
    if (!this.vaultPath) return
    const today = new Date()
    const iso = (offset: number): string => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    const files: { rel: string; body: string }[] = [
      {
        rel: 'Start here.md',
        body: `---
icon: 📘
cover: sand
---

Everything in Stone is a markdown file in this folder. Open it in any other
editor and it reads exactly the same — there is no database and no lock-in.

> [!tip] Give any page an icon and a cover
> Hover just above the title and the buttons appear. Both are stored as plain
> \`icon:\` and \`cover:\` lines in the note's frontmatter.

## Three things worth knowing

Tasks are checkboxes. Write one anywhere in any note and it appears in **Tasks**
and on the **Calendar**:

- [ ] Try editing this line @${iso(0)} !high +30m #stone
- [ ] Anything with a date shows up on the day it is due @${iso(2)}
- [x] Finished things fall away

The tokens are plain text on purpose. \`@date\` sets when it is due, \`!high\`
sets priority, \`+30m\` estimates the work, and \`#tag\` files it.

Notes link with double brackets. This one points at [[Reading list]], and that
note will show a backlink pointing straight back here.

Any note becomes a calendar event once you give it a date **and a time** in its
frontmatter — [[Weekly review]] does exactly that. A date on its own just files
the note under that day.

## Getting around

| Key | Does |
| --- | --- |
| \`Ctrl/Cmd K\` | Search everything, or run a command |
| \`Ctrl/Cmd J\` | Add a task without leaving what you are doing |
| \`Ctrl/Cmd T\` | Jump to today |
| \`Ctrl/Cmd 1-4\` | Today, Notes, Calendar, Tasks |

The narrow strip down the left edge is the year, one band per day, shaded by how
much you wrote and finished. Click any band to travel there.

#stone
`
      },
      {
        rel: 'Notes/Reading list.md',
        body: `---
icon: 📚
cover: moss
---

- [ ] Structure and Interpretation of Computer Programs @${iso(9)} +6h #reading
- [ ] The Design of Everyday Things @${iso(21)} !low #reading
- [x] Thinking, Fast and Slow

Linked from [[Start here]].

#reading
`
      },
      {
        rel: 'Projects/Weekly review.md',
        body: `---
icon: 🗓️
date: ${iso(3)}
start: "17:00"
end: "17:30"
location: Anywhere quiet
---

Because this note has \`date\`, \`start\`, and \`end\` in its frontmatter, Stone
treats it as an event and places it on the calendar. Delete those lines and it
goes back to being an ordinary note.

- [ ] Clear the inbox @${iso(3)} #review
- [ ] Pick three things that matter next week @${iso(3)} !high #review
`
      }
    ]

    for (const file of files) {
      const absPath = toAbsPath(this.vaultPath, file.rel)
      try {
        await writeNoteAtomic(absPath, file.body)
      } catch {
        // A seed file failing to write is not worth blocking the vault over.
      }
    }
    await this.reindex()
  }

  async close(): Promise<void> {
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    await this.watcher?.close()
    this.watcher = null
    this.notes.clear()
    this.tasks.clear()
    this.words.clear()
    this.hashes.clear()
    this.backlinkMap.clear()
    this.search_.removeAll()
  }

  private emitEvent(event: VaultEvent): void {
    this.emit('vault-event', event)
  }

  // ---------------------------------------------------------------- indexing

  async reindex(): Promise<void> {
    if (!this.vaultPath) return
    const files = await walkMarkdown(this.vaultPath)

    this.notes.clear()
    this.tasks.clear()
    this.words.clear()
    this.hashes.clear()
    this.search_.removeAll()

    const docs: IndexedDoc[] = []
    for (const file of files) {
      try {
        const raw = await readNote(file.absPath)
        const parsed = parseNote(file.relPath, file.absPath, raw, {
          mtimeMs: file.mtimeMs,
          birthtimeMs: file.birthtimeMs,
          size: file.size
        })
        this.absorb(parsed, raw)
        docs.push(this.toDoc(parsed, raw))
      } catch {
        // Unreadable file (permissions, eviction). Leave it out of the index.
      }
    }

    this.search_.addAll(docs)
    this.rebuildBacklinks()
    this.emitEvent({ type: 'reindexed', count: this.notes.size })
  }

  private toDoc(parsed: ParsedNote, raw: string): IndexedDoc {
    return {
      id: parsed.meta.relPath,
      title: parsed.meta.title,
      body: raw,
      tags: parsed.meta.tags.join(' ')
    }
  }

  private absorb(parsed: ParsedNote, raw: string): void {
    this.notes.set(parsed.meta.relPath, parsed.meta)
    this.tasks.set(parsed.meta.relPath, parsed.tasks)
    this.words.set(parsed.meta.relPath, countWords(raw))
    this.hashes.set(parsed.meta.relPath, hashContent(raw))
  }

  private forget(relPath: string): void {
    this.notes.delete(relPath)
    this.tasks.delete(relPath)
    this.words.delete(relPath)
    this.hashes.delete(relPath)
    if (this.search_.has(relPath)) this.search_.discard(relPath)
  }

  /**
   * One lookup table for every way a note can be named: its full relative path,
   * its basename, its title, and any `aliases:` it declares. Rebuilt whenever
   * the note set changes, so resolution is a map hit rather than a scan.
   *
   * Full paths are registered last and win outright — `[[Projects/Review]]`
   * must never be captured by an unrelated note that happens to be called
   * "Review".
   */
  private rebuildLinkIndex(): void {
    this.linkIndex.clear()
    const claim = (name: string, relPath: string, overwrite = false): void => {
      const key = name.trim().toLowerCase()
      if (!key) return
      if (overwrite || !this.linkIndex.has(key)) this.linkIndex.set(key, relPath)
    }

    for (const [relPath, meta] of this.notes) {
      for (const alias of meta.aliases) claim(alias, relPath)
      claim(meta.title, relPath)
    }
    for (const relPath of this.notes.keys()) {
      claim(path.basename(relPath, '.md'), relPath)
    }
    for (const relPath of this.notes.keys()) {
      claim(relPath.replace(/\.md$/i, ''), relPath, true)
    }
  }

  /**
   * Resolve a link target to a note. Any `#heading` or `^block` suffix is
   * stripped first — those address a position inside the note, not a different
   * note, and treating them as part of the name is what made `[[Note#Section]]`
   * miss and silently create a junk file.
   */
  resolveLink(target: string): string | null {
    const bare = target.split(/[#^]/)[0].replace(/\.md$/i, '').trim().toLowerCase()
    if (!bare) return null
    return this.linkIndex.get(bare) ?? null
  }

  /** Split a raw link into its note part and its in-note anchor. */
  static splitTarget(target: string): { name: string; heading: string | null; block: string | null } {
    const block = /\^([A-Za-z0-9-]+)\s*$/.exec(target)
    const withoutBlock = block ? target.slice(0, block.index) : target
    const hash = withoutBlock.indexOf('#')
    return {
      name: (hash === -1 ? withoutBlock : withoutBlock.slice(0, hash)).trim(),
      heading: hash === -1 ? null : withoutBlock.slice(hash + 1).trim() || null,
      block: block ? block[1] : null
    }
  }

  /** The line a `[[Note#Heading]]` or `[[Note^block]]` should scroll to. */
  anchorLine(relPath: string, heading: string | null, block: string | null): number | null {
    const meta = this.notes.get(relPath)
    if (!meta) return null
    if (block) {
      const hit = meta.blocks.find((b) => b.id === block)
      if (hit) return hit.line
    }
    if (heading) {
      const needle = heading.toLowerCase()
      const hit = meta.headings.find((h) => h.text.toLowerCase() === needle)
      if (hit) return hit.line
    }
    return null
  }

  private rebuildBacklinks(): void {
    this.rebuildLinkIndex()
    this.backlinkMap.clear()
    for (const [relPath, meta] of this.notes) {
      // Embeds count as backlinks: a note that transcludes another is every
      // bit as much a reference to it as one that merely points at it.
      for (const link of [...meta.links, ...meta.embeds]) {
        const target = this.resolveLink(link)
        if (!target || target === relPath) continue
        if (!this.backlinkMap.has(target)) this.backlinkMap.set(target, new Set())
        this.backlinkMap.get(target)!.add(relPath)
      }
    }
  }

  private async reloadFile(absPath: string): Promise<void> {
    if (!this.vaultPath) return
    const relPath = toRelPath(this.vaultPath, absPath)
    try {
      const st = await fs.stat(absPath)
      const raw = await readNote(absPath)
      const parsed = parseNote(relPath, absPath, raw, {
        mtimeMs: st.mtimeMs,
        birthtimeMs: st.birthtimeMs,
        size: st.size
      })
      this.absorb(parsed, raw)

      const doc = this.toDoc(parsed, raw)
      if (this.search_.has(relPath)) this.search_.replace(doc)
      else this.search_.add(doc)

      this.rebuildBacklinks()
      this.emitEvent({ type: 'note-changed', note: parsed.meta })
    } catch {
      this.forget(relPath)
      this.emitEvent({ type: 'note-removed', relPath })
    }
  }

  /**
   * Sync engines rewrite files in bursts, so every path is debounced. The
   * watcher is what keeps Stone correct when Drive or iCloud lands a change
   * from another machine.
   */
  private startWatching(): void {
    if (!this.vaultPath) return

    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: (p: string) => p.split(/[\\/]/).some(isIgnored),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 60 },
      depth: 12
    })

    const schedule = (absPath: string, remove = false): void => {
      if (!absPath.toLowerCase().endsWith('.md')) return
      const existing = this.pending.get(absPath)
      if (existing) clearTimeout(existing)
      this.pending.set(
        absPath,
        setTimeout(() => {
          this.pending.delete(absPath)
          if (remove) {
            const relPath = toRelPath(this.vaultPath!, absPath)
            this.forget(relPath)
            this.rebuildBacklinks()
            this.emitEvent({ type: 'note-removed', relPath })
          } else {
            void this.reloadFile(absPath)
          }
        }, 150)
      )
    }

    this.watcher
      .on('add', (p) => schedule(p))
      .on('change', (p) => schedule(p))
      .on('unlink', (p) => schedule(p, true))
  }

  // ------------------------------------------------------------------ reads

  listNotes(): NoteMeta[] {
    return [...this.notes.values()].sort((a, b) => b.mtime - a.mtime)
  }

  getMeta(relPath: string): NoteMeta | null {
    return this.notes.get(relPath) ?? null
  }

  async getNote(relPath: string): Promise<Note | null> {
    if (!this.vaultPath) return null
    const meta = this.notes.get(relPath)
    if (!meta) return null
    try {
      const content = await readNote(meta.path)
      this.hashes.set(relPath, hashContent(content))
      return { ...meta, content }
    } catch {
      return null
    }
  }

  /** The hash the renderer must echo back on save for conflict detection. */
  getHash(relPath: string): string | null {
    return this.hashes.get(relPath) ?? null
  }

  allTasks(): Task[] {
    return [...this.tasks.values()].flat()
  }

  tasksFor(relPath: string): Task[] {
    return this.tasks.get(relPath) ?? []
  }

  backlinks(relPath: string): NoteMeta[] {
    const set = this.backlinkMap.get(relPath)
    if (!set) return []
    return [...set].map((p) => this.notes.get(p)).filter((n): n is NoteMeta => Boolean(n))
  }

  /** Every tag in the vault with its usage count, most-used first. */
  tagCounts(): { tag: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const meta of this.notes.values()) {
      for (const tag of meta.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  /**
   * The link graph, resolved. `linkIndex` makes each lookup a map hit, so this
   * stays near-linear in the number of links rather than the O(notes x links) a
   * scan per link would cost on a large vault.
   */
  graph(): GraphData {
    const nodes: GraphNode[] = []
    const position = new Map<string, number>()
    for (const [relPath, meta] of this.notes) {
      position.set(relPath, nodes.length)
      nodes.push({ relPath, title: meta.title, degree: 0, tags: meta.tags })
    }

    const edges: GraphEdge[] = []
    const seen = new Set<string>()
    for (const [relPath, meta] of this.notes) {
      for (const link of [...meta.links, ...meta.embeds]) {
        const target = this.resolveLink(link)
        if (!target || target === relPath) continue

        const key = `${relPath} ${target}`
        if (seen.has(key)) continue
        seen.add(key)

        edges.push({ source: relPath, target })
        nodes[position.get(relPath)!].degree++
        nodes[position.get(target)!].degree++
      }
    }

    return { nodes, edges }
  }

  /**
   * The graph around one note, out to `depth` hops. Links are followed in both
   * directions — a note's neighbourhood is what it points at *and* what points
   * at it, and a one-way walk would leave most notes looking isolated.
   */
  localGraph(relPath: string, depth = 1): GraphData {
    const full = this.graph()
    const adjacency = new Map<string, Set<string>>()
    const link = (a: string, b: string): void => {
      if (!adjacency.has(a)) adjacency.set(a, new Set())
      adjacency.get(a)!.add(b)
    }
    for (const edge of full.edges) {
      link(edge.source, edge.target)
      link(edge.target, edge.source)
    }

    const keep = new Set<string>([relPath])
    let frontier = [relPath]
    for (let step = 0; step < Math.max(1, depth); step++) {
      const next: string[] = []
      for (const node of frontier) {
        for (const neighbour of adjacency.get(node) ?? []) {
          if (keep.has(neighbour)) continue
          keep.add(neighbour)
          next.push(neighbour)
        }
      }
      frontier = next
    }

    return {
      nodes: full.nodes.filter((n) => keep.has(n.relPath)),
      edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    }
  }

  /**
   * Notes that name this one in plain text without linking to it. Obsidian
   * calls these unlinked mentions; they are how a vault's implicit structure
   * gets found and turned into real links.
   */
  async unlinkedMentions(relPath: string, limit = 40): Promise<Mention[]> {
    const meta = this.notes.get(relPath)
    if (!meta) return []

    const names = [path.basename(relPath, '.md'), meta.title, ...meta.aliases]
      .map((n) => n.trim())
      .filter((n) => n.length >= 3)
    if (names.length === 0) return []

    const linked = this.backlinkMap.get(relPath) ?? new Set<string>()
    const pattern = new RegExp(`(?<![\\w[])(${names.map(escapeRegex).join('|')})(?![\\w\\]])`, 'i')

    const out: Mention[] = []
    for (const [candidate, candidateMeta] of this.notes) {
      if (candidate === relPath || linked.has(candidate)) continue
      if (out.length >= limit) break
      let raw: string
      try {
        raw = await readNote(candidateMeta.path)
      } catch {
        continue
      }
      const lines = raw.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!pattern.test(lines[i])) continue
        // A line that already carries the wikilink is a link, not a mention.
        if (names.some((n) => lines[i].includes(`[[${n}`))) continue
        out.push({
          relPath: candidate,
          title: candidateMeta.title,
          line: i,
          text: lines[i].trim().slice(0, 200)
        })
        break
      }
    }
    return out
  }

  /**
   * Full-text search.
   *
   * Two engines, chosen by the query: a regex or an operator-only query is run
   * line by line so it can return exact match offsets, while a plain query goes
   * through MiniSearch for ranking and fuzziness. Either way the caller gets
   * matching lines back — a result list without context is only useful when you
   * already know what you were looking for.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const limit = options.limit ?? 40
    const trimmed = query.trim()
    if (!trimmed) return []

    const scope = extractOperators(trimmed)
    const inScope = (meta: NoteMeta): boolean => {
      if (scope.path && !meta.relPath.toLowerCase().includes(scope.path)) return false
      if (scope.file && !path.basename(meta.relPath, '.md').toLowerCase().includes(scope.file)) {
        return false
      }
      if (scope.tag && !meta.tags.some((t) => t.toLowerCase() === scope.tag)) return false
      return true
    }

    if (options.regex || !scope.text) {
      const matcher = scope.text ? buildMatcher(scope.text, options) : null
      if (scope.text && !matcher) return []
      const hits: SearchHit[] = []
      for (const meta of this.notes.values()) {
        if (!inScope(meta)) continue
        const matches = matcher ? await this.matchesIn(meta, matcher) : []
        if (matcher && matches.length === 0) continue
        hits.push({
          relPath: meta.relPath,
          title: meta.title,
          score: matches.length,
          excerpt: meta.excerpt,
          matchedTerms: [],
          matches: matches.slice(0, 6)
        })
        if (hits.length >= limit) break
      }
      return hits
    }

    const matcher = buildMatcher(scope.text, options)
    const hits: SearchHit[] = []
    for (const result of this.search_.search(scope.text)) {
      const meta = this.notes.get(result.id as string)
      if (!meta || !inScope(meta)) continue
      hits.push({
        relPath: meta.relPath,
        title: meta.title,
        score: result.score,
        excerpt: meta.excerpt,
        matchedTerms: result.terms,
        matches: matcher ? (await this.matchesIn(meta, matcher)).slice(0, 4) : []
      })
      if (hits.length >= limit) break
    }
    return hits
  }

  private async matchesIn(meta: NoteMeta, matcher: RegExp): Promise<SearchMatch[]> {
    let raw: string
    try {
      raw = await readNote(meta.path)
    } catch {
      return []
    }
    const out: SearchMatch[] = []
    const lines = raw.split('\n')
    for (let i = 0; i < lines.length && out.length < 12; i++) {
      matcher.lastIndex = 0
      const m = matcher.exec(lines[i])
      if (!m) continue
      out.push({
        line: i,
        text: lines[i].trim().slice(0, 240),
        from: m.index,
        to: m.index + m[0].length
      })
    }
    return out
  }

  /** Replace every match of a query across the vault. Returns what it touched. */
  async replaceAll(
    query: string,
    replacement: string,
    options: SearchOptions = {}
  ): Promise<{ notes: number; replacements: number }> {
    const scope = extractOperators(query.trim())
    const matcher = buildMatcher(scope.text, options, true)
    if (!matcher) return { notes: 0, replacements: 0 }

    let notesTouched = 0
    let replacements = 0
    for (const meta of [...this.notes.values()]) {
      if (scope.path && !meta.relPath.toLowerCase().includes(scope.path)) continue
      if (scope.tag && !meta.tags.some((t) => t.toLowerCase() === scope.tag)) continue
      let raw: string
      try {
        raw = await readNote(meta.path)
      } catch {
        continue
      }
      matcher.lastIndex = 0
      const count = (raw.match(matcher) ?? []).length
      if (count === 0) continue
      matcher.lastIndex = 0
      const next = raw.replace(matcher, replacement)
      if (next === raw) continue
      await writeNoteAtomic(meta.path, next)
      await this.reloadFile(meta.path)
      notesTouched++
      replacements += count
    }
    return { notes: notesTouched, replacements }
  }

  /** The vault's inferred property schema, for the properties panel and views. */
  properties(): PropertyDef[] {
    return inferProperties([...this.notes.values()].map((n) => n.frontmatter))
  }

  stats(): VaultStats {
    const tasks = this.allTasks()
    return {
      notes: this.notes.size,
      tasks: tasks.length,
      openTasks: tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length,
      words: [...this.words.values()].reduce((a, b) => a + b, 0),
      tags: this.tagCounts().length
    }
  }

  /**
   * Per-day activity used by the Strata Rail: notes anchored to the day, notes
   * touched that day, and tasks completed with that due date.
   */
  activityByDay(): Record<string, number> {
    const out: Record<string, number> = {}
    const bump = (day: string, amount: number): void => {
      out[day] = (out[day] ?? 0) + amount
    }

    for (const meta of this.notes.values()) {
      if (meta.date) bump(meta.date, 2)
      const touched = new Date(meta.mtime)
      const day = `${touched.getFullYear()}-${String(touched.getMonth() + 1).padStart(2, '0')}-${String(touched.getDate()).padStart(2, '0')}`
      bump(day, 1)
    }
    for (const task of this.allTasks()) {
      if (task.due) bump(task.due.slice(0, 10), task.status === 'done' ? 2 : 1)
    }
    return out
  }

  // ----------------------------------------------------------------- writes

  async saveNote(relPath: string, content: string, expectedHash?: string): Promise<
    { ok: true; hash: string } | { ok: false; error: string }
  > {
    if (!this.vaultPath) return { ok: false, error: 'No vault is open.' }
    const absPath = toAbsPath(this.vaultPath, relPath)
    assertInsideVault(this.vaultPath, absPath)

    try {
      // Snapshot the version being replaced, not the one being written — the
      // point of recovery is to get back what you had before the save.
      if (this.snapshotsEnabled) {
        const previous = await readNote(absPath).catch(() => null)
        if (previous !== null && previous !== content) {
          await writeSnapshot(this.vaultPath, relPath, previous).catch(() => {})
        }
      }

      const result = await writeNoteAtomic(absPath, content, expectedHash)
      const hash = hashContent(content)
      this.hashes.set(relPath, hash)
      if (result.conflictBackup) {
        this.emitEvent({
          type: 'conflict',
          relPath,
          backupPath: toRelPath(this.vaultPath, result.conflictBackup)
        })
      }
      await this.reloadFile(absPath)
      return { ok: true, hash }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async createNote(
    folder: string,
    title: string,
    content?: string
  ): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const dir = path.join(this.vaultPath, ...folder.split('/').filter(Boolean))
    assertInsideVault(this.vaultPath, dir)
    await ensureDir(dir)

    const absPath = await uniquePath(dir, sanitizeFilename(title))
    const body = content ?? `# ${title}\n\n`
    await writeNoteAtomic(absPath, body)
    await this.reloadFile(absPath)
    return { relPath: toRelPath(this.vaultPath, absPath) }
  }

  async deleteNote(relPath: string): Promise<{ ok: boolean }> {
    if (!this.vaultPath) return { ok: false }
    const absPath = toAbsPath(this.vaultPath, relPath)
    assertInsideVault(this.vaultPath, absPath)
    await trashNote(this.vaultPath, absPath)
    this.forget(relPath)
    this.rebuildBacklinks()
    this.emitEvent({ type: 'note-removed', relPath })
    return { ok: true }
  }

  /** Rename a note and repoint every `[[wikilink]]` that referenced it. */
  async renameNote(
    relPath: string,
    nextTitle: string
  ): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const meta = this.notes.get(relPath)
    if (!meta) return { error: 'Note not found.' }

    const dir = path.dirname(meta.path)
    const nextPath = await uniquePath(dir, sanitizeFilename(nextTitle))
    assertInsideVault(this.vaultPath, nextPath)
    await fs.rename(meta.path, nextPath)

    const oldName = path.basename(relPath, '.md')
    const newName = path.basename(nextPath, '.md')
    for (const source of this.backlinks(relPath)) {
      try {
        const raw = await readNote(source.path)
        const updated = raw.replace(
          new RegExp(`\\[\\[${escapeRegex(oldName)}((?:#|\\|)[^\\]]*)?\\]\\]`, 'g'),
          `[[${newName}$1]]`
        )
        if (updated !== raw) {
          await writeNoteAtomic(source.path, updated)
          await this.reloadFile(source.path)
        }
      } catch {
        // A backlink we cannot rewrite is not a reason to abort the rename.
      }
    }

    this.forget(relPath)
    await this.reloadFile(nextPath)
    this.emitEvent({ type: 'note-removed', relPath })
    return { relPath: toRelPath(this.vaultPath, nextPath) }
  }

  /** Rewrite a single line in place — how task toggles are persisted. */
  async replaceLine(
    relPath: string,
    line: number,
    nextText: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.vaultPath) return { ok: false, error: 'No vault is open.' }
    const absPath = toAbsPath(this.vaultPath, relPath)
    assertInsideVault(this.vaultPath, absPath)
    try {
      const raw = await readNote(absPath)
      const lines = raw.split('\n')
      if (line < 0 || line >= lines.length) return { ok: false, error: 'Line is out of range.' }
      lines[line] = nextText
      await writeNoteAtomic(absPath, lines.join('\n'))
      await this.reloadFile(absPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Get or create the daily note for `YYYY-MM-DD`. */
  async dailyNote(
    date: string,
    folder: string,
    template?: string
  ): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const dir = path.join(this.vaultPath, ...folder.split('/').filter(Boolean))
    await ensureDir(dir)
    const absPath = path.join(dir, `${date}.md`)
    const relPath = toRelPath(this.vaultPath, absPath)

    if (this.notes.has(relPath)) return { relPath }

    // No H1: the page title already shows the date, and Stone's Today view
    // supplies the schedule and task sections above this note. The icon and
    // cover rotate with the day so consecutive journal pages are instantly
    // distinguishable in the sidebar rather than an undifferentiated run.
    const body = template
      ? Vault.fillTemplate(template, { title: date, date })
      : `---\n${dressingFor(date)}date: ${date}\n---\n\n${DAY_TEMPLATE}`
    await writeNoteAtomic(absPath, body)
    await this.reloadFile(absPath)
    return { relPath }
  }

  /** Append a task to the day's note — the quick-add path. */
  async addTaskToDaily(
    date: string,
    folder: string,
    taskLine: string
  ): Promise<{ relPath: string } | { error: string }> {
    const daily = await this.dailyNote(date, folder)
    if ('error' in daily) return daily
    const absPath = toAbsPath(this.vaultPath!, daily.relPath)
    await appendLine(absPath, taskLine)
    await this.reloadFile(absPath)
    return { relPath: daily.relPath }
  }

  // ------------------------------------------------------- periodic notes

  /**
   * Get or create the note for an ISO week or a month. The same contract as
   * `dailyNote`: naming is derived from the date so the note is found again
   * rather than duplicated.
   */
  async periodicNote(
    kind: 'week' | 'month',
    date: string,
    folder: string,
    template?: string
  ): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const name = kind === 'week' ? isoWeekName(date) : date.slice(0, 7)
    const dir = path.join(this.vaultPath, ...folder.split('/').filter(Boolean))
    assertInsideVault(this.vaultPath, dir)
    await ensureDir(dir)

    const absPath = path.join(dir, `${name}.md`)
    const relPath = toRelPath(this.vaultPath, absPath)
    if (this.notes.has(relPath)) return { relPath }

    const heading = kind === 'week' ? '## Highlights\n\n## Review\n\n' : '## Themes\n\n## Review\n\n'
    const body = template ?? `---\ndate: ${date}\n---\n\n${heading}`
    await writeNoteAtomic(absPath, body)
    await this.reloadFile(absPath)
    return { relPath }
  }

  // ------------------------------------------------------------- templates

  /** Notes living in the template folder, which are offered when creating. */
  templates(folder: string): NoteMeta[] {
    const prefix = `${folder.replace(/\/+$/, '')}/`
    return [...this.notes.values()]
      .filter((n) => n.relPath.startsWith(prefix))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  /**
   * Expand a template's placeholders. Kept to the handful Templater users reach
   * for first; anything more would be a scripting language living in a note.
   */
  static fillTemplate(body: string, context: { title: string; date: string }): string {
    const d = new Date(`${context.date}T00:00:00`)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const values: Record<string, string> = {
      title: context.title,
      date: context.date,
      time: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`,
      year: String(d.getFullYear()),
      month: pad(d.getMonth() + 1),
      day: pad(d.getDate()),
      weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
      yesterday: shiftDay(context.date, -1),
      tomorrow: shiftDay(context.date, 1)
    }
    return body.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (whole, key: string) => {
      const value = values[key.toLowerCase()]
      return value ?? whole
    })
  }

  async createFromTemplate(
    folder: string,
    title: string,
    templateRelPath: string
  ): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const template = this.notes.get(templateRelPath)
    if (!template) return { error: 'That template is no longer in the vault.' }
    let body: string
    try {
      body = await readNote(template.path)
    } catch {
      return { error: 'That template could not be read.' }
    }
    const filled = Vault.fillTemplate(body, {
      title,
      date: toISODateLocal(new Date())
    })
    return this.createNote(folder, title, filled)
  }

  // --------------------------------------------------------------- folders

  folders(): string[] {
    if (!this.vaultPath) return []
    return this.folderCache
  }

  async refreshFolders(): Promise<string[]> {
    if (!this.vaultPath) return []
    this.folderCache = await listFolders(this.vaultPath)
    return this.folderCache
  }

  async createFolder(relPath: string): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    const dir = toAbsPath(this.vaultPath, relPath)
    assertInsideVault(this.vaultPath, dir)
    if (await exists(dir)) return { error: 'A folder with that name already exists.' }
    await ensureDir(dir)
    await this.refreshFolders()
    return { relPath }
  }

  /**
   * Move a note or folder. Wikilinks are left alone deliberately: they resolve
   * by name rather than by path, so relocating a note keeps every link working
   * without rewriting a single other file.
   */
  async movePath(fromRel: string, toRel: string): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    try {
      const moved = await movePath(this.vaultPath, fromRel, toRel)
      await this.reindex()
      await this.refreshFolders()
      return { relPath: moved }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }

  async renameFolder(relPath: string, name: string): Promise<{ relPath: string } | { error: string }> {
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    const clean = sanitizeFilename(name)
    return this.movePath(relPath, parent ? `${parent}/${clean}` : clean)
  }

  async deleteFolder(relPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.vaultPath) return { ok: false, error: 'No vault is open.' }
    try {
      await removeFolder(this.vaultPath, relPath)
      await this.reindex()
      await this.refreshFolders()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Move a note into a different folder, keeping its filename. */
  async moveNote(relPath: string, folder: string): Promise<{ relPath: string } | { error: string }> {
    const base = path.basename(relPath)
    const target = folder ? `${folder.replace(/\/+$/, '')}/${base}` : base
    if (target === relPath) return { relPath }
    return this.movePath(relPath, target)
  }

  // ----------------------------------------------------------------- trash

  async trash(): Promise<TrashEntry[]> {
    if (!this.vaultPath) return []
    return listTrash(this.vaultPath)
  }

  async restore(trashRelPath: string, fallbackFolder: string): Promise<{ relPath: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    try {
      const relPath = await restoreFromTrash(this.vaultPath, trashRelPath, fallbackFolder)
      await this.reloadFile(toAbsPath(this.vaultPath, relPath))
      return { relPath }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }

  async emptyTrash(): Promise<number> {
    if (!this.vaultPath) return 0
    return emptyTrash(this.vaultPath)
  }

  // ------------------------------------------------------------- snapshots

  async snapshots(relPath: string): Promise<Snapshot[]> {
    if (!this.vaultPath) return []
    return listSnapshots(this.vaultPath, relPath)
  }

  async snapshot(relPath: string, id: string): Promise<string | null> {
    if (!this.vaultPath) return null
    return readSnapshot(this.vaultPath, relPath, id)
  }

  // ----------------------------------------------------------- attachments

  /** Store a pasted or dropped file and hand back the markdown to insert. */
  async saveAttachment(
    folder: string,
    data: Uint8Array,
    name: string
  ): Promise<{ relPath: string; markdown: string } | { error: string }> {
    if (!this.vaultPath) return { error: 'No vault is open.' }
    try {
      const relPath = await saveAttachment(this.vaultPath, folder, data, name)
      const isImage = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(relPath)
      const encoded = relPath.split('/').map(encodeURIComponent).join('/')
      return {
        relPath,
        markdown: isImage ? `![${path.basename(name)}](/${encoded})` : `[${path.basename(name)}](/${encoded})`
      }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }

  // ------------------------------------------------------------------ tags

  /**
   * Rename a tag everywhere it appears, in both inline `#tag` form and in
   * frontmatter lists. Nested children come along: renaming `#work` also moves
   * `#work/admin`, which is the only behaviour that does not silently orphan
   * half the hierarchy.
   */
  async renameTag(from: string, to: string): Promise<{ notes: number }> {
    const clean = to.replace(/^#/, '').trim()
    if (!clean || !from) return { notes: 0 }

    const inline = new RegExp(`(^|\\s)#${escapeRegex(from)}(?=$|[\\s,;.!?)\\]]|/)`, 'g')
    const nested = new RegExp(`(^|\\s)#${escapeRegex(from)}/`, 'g')
    let touched = 0

    for (const meta of [...this.notes.values()]) {
      if (!meta.tags.some((t) => t === from || t.startsWith(`${from}/`))) continue
      let raw: string
      try {
        raw = await readNote(meta.path)
      } catch {
        continue
      }

      let next = raw.replace(nested, `$1#${clean}/`).replace(inline, `$1#${clean}`)

      // Frontmatter `tags:` entries carry no `#`, so they need their own pass.
      next = next.replace(/^(---[\s\S]*?^---)/m, (block) =>
        block.replace(
          new RegExp(`(^|[\\s,\\[])${escapeRegex(from)}(?=$|[\\s,\\]]|/)`, 'gm'),
          `$1${clean}`
        )
      )

      if (next === raw) continue
      await writeNoteAtomic(meta.path, next)
      await this.reloadFile(meta.path)
      touched++
    }
    return { notes: touched }
  }
}

/** ISO week label, e.g. `2026-W32`. */
function isoWeekName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1, d))
  // Thursday of the current week determines the year the week belongs to.
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return toISODateLocal(next)
}

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Pull `path:`, `file:` and `tag:` operators out of a query, leaving the free
 * text behind. Anything the parser does not recognise stays part of the text,
 * so a stray colon never silently swallows half the search.
 */
function extractOperators(query: string): {
  text: string
  path: string | null
  file: string | null
  tag: string | null
} {
  let text = query
  const take = (name: string): string | null => {
    const re = new RegExp(`(?:^|\\s)${name}:("[^"]+"|\\S+)`, 'i')
    const m = re.exec(text)
    if (!m) return null
    text = text.replace(m[0], ' ')
    return m[1].replace(/^"|"$/g, '').toLowerCase()
  }
  const pathScope = take('path')
  const fileScope = take('file')
  const tagScope = take('tag')
  return {
    text: text.replace(/\s{2,}/g, ' ').trim(),
    path: pathScope,
    file: fileScope,
    tag: tagScope ? tagScope.replace(/^#/, '') : null
  }
}

/** Compile a query into a line matcher, honouring the regex and case flags. */
function buildMatcher(
  text: string,
  options: SearchOptions,
  global = false
): RegExp | null {
  if (!text) return null
  let source = options.regex ? text : escapeRegex(text)
  if (options.wholeWord) source = `\\b${source}\\b`
  try {
    return new RegExp(source, `${global ? 'g' : ''}${options.caseSensitive ? '' : 'i'}`)
  } catch {
    // An unfinished regex is normal while typing; treat it as no match.
    return null
  }
}

/**
 * The default look for a day page: an icon and cover chosen from the date, so
 * the choice is stable (reopening a day never changes it) but the journal does
 * not read as a hundred identical rows.
 */
const DAY_ICONS = ['🌤️', '🌱', '🪵', '🕯️', '🌊', '🍃', '🌙']
const DAY_COVERS = ['sand', 'moss', 'sky', 'clay', 'sea', 'slate', 'dusk']

const DAY_TEMPLATE = `## Notes

## Log

`

function dressingFor(date: string): string {
  // Day-of-week index, computed from the date string so it needs no Date parse.
  const [y, m, d] = date.split('-').map(Number)
  const index = Math.abs(new Date(y, m - 1, d).getDay()) % DAY_ICONS.length
  return `icon: ${DAY_ICONS[index]}\ncover: ${DAY_COVERS[index]}\n`
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

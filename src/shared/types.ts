/**
 * Types shared across main, preload, and renderer.
 * Everything crossing the IPC boundary must be structured-clone safe:
 * dates travel as ISO strings, never as Date instances.
 */

export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled'
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

/** A checkbox line inside a note. Tasks have no storage of their own. */
export interface Task {
  /** Stable within a session: `${relPath}:${line}`. */
  id: string
  relPath: string
  /** Zero-indexed line within the note. */
  line: number
  /** Display text, with metadata tokens stripped out. */
  text: string
  /** The full original line including list marker and checkbox. */
  raw: string
  status: TaskStatus
  priority: Priority
  /** ISO date `YYYY-MM-DD`, or full ISO datetime when a time was given. */
  due: string | null
  /** When you plan to work on it, as opposed to when it is owed. */
  scheduled: string | null
  tags: string[]
  /** Estimated minutes, from `+90m` / `+2h`. */
  estimate: number | null
  /** Indent depth in the source list. */
  depth: number
  /** Repeat rule, e.g. `weekly` or `every 3 days`, from `&weekly` or `🔁`. */
  recurrence: string | null
}

export interface Heading {
  level: number
  text: string
  line: number
}

/** A `^block-id` anchor, so `[[Note^id]]` can point at one paragraph. */
export interface BlockAnchor {
  id: string
  line: number
  text: string
}

export interface NoteMeta {
  /** Absolute path on disk. */
  path: string
  /** Vault-relative POSIX path, e.g. `notes/algorithms.md`. Primary key. */
  relPath: string
  title: string
  /** Epoch ms. */
  mtime: number
  ctime: number
  size: number
  frontmatter: Record<string, unknown>
  tags: string[]
  /** Wikilink targets, unresolved. */
  links: string[]
  /** Embedded targets from `![[…]]`, unresolved. */
  embeds: string[]
  headings: Heading[]
  blocks: BlockAnchor[]
  /** Alternate names this note answers to, from `aliases:` frontmatter. */
  aliases: string[]
  taskCount: number
  doneCount: number
  /** First ~200 chars of body text, for list previews. */
  excerpt: string
  /** `YYYY-MM-DD` when this note is anchored to a day (daily note or frontmatter date). */
  date: string | null
  /** Emoji page icon from frontmatter `icon:`. */
  icon: string | null
  /** Named gradient, or a vault-relative image path, from frontmatter `cover:`. */
  cover: string | null
  words: number
}

export interface Note extends NoteMeta {
  content: string
}

export type CalendarSource = 'stone' | 'macos' | 'graph' | 'ics'

export interface CalendarAccount {
  id: string
  source: CalendarSource
  name: string
  color: string
  writable: boolean
  enabled: boolean
}

export interface CalEvent {
  id: string
  accountId: string
  source: CalendarSource
  title: string
  /** ISO datetime, or `YYYY-MM-DD` when allDay. */
  start: string
  end: string
  allDay: boolean
  location: string | null
  notes: string | null
  /** Set when the event originated from a note in the vault. */
  relPath: string | null
  readOnly: boolean
  color: string | null
}

export interface CloudTarget {
  kind: 'icloud' | 'gdrive' | 'dropbox' | 'onedrive' | 'local'
  label: string
  path: string
  exists: boolean
}

// ------------------------------------------------------------------ properties

/** The types a frontmatter key can be presented and edited as. */
export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'relation'

export interface PropertyDef {
  key: string
  type: PropertyType
  /** Known values, for select and multi-select. Learned from the vault. */
  options: string[]
  /** How many notes carry this key — drives ordering in the picker. */
  count: number
}

/**
 * A resolved link written in frontmatter, rather than in the body.
 *
 * The property key is what makes it a relation and not just a backlink: it says
 * what the connection *is*, which is what a rollup then aggregates over.
 */
export interface RelationEdge {
  from: string
  property: string
  to: string
}

// ------------------------------------------------------------ database views

export type ViewKind = 'table' | 'board' | 'gallery' | 'timeline' | 'list'
export type ViewSource = 'notes' | 'tasks'

export type FilterOp =
  | 'is'
  | 'is-not'
  | 'contains'
  | 'not-contains'
  | 'before'
  | 'after'
  | 'empty'
  | 'not-empty'

export interface ViewFilter {
  /** A frontmatter key, or one of `title`, `folder`, `tag`, `text`. */
  property: string
  op: FilterOp
  value: string
}

export interface ViewSort {
  property: string
  direction: 'asc' | 'desc'
}

export type RollupFn = 'count' | 'sum' | 'average' | 'min' | 'max' | 'earliest' | 'latest' | 'list'

/**
 * A column computed from the notes a relation points at.
 *
 * `relation` names the frontmatter key to follow; `direction` decides whether
 * to follow it outward (the notes this one links to) or back (the notes that
 * link here), which is what makes "Project → its Tasks" expressible without
 * anyone having to maintain both halves of the link by hand.
 */
export interface ViewRollup {
  id: string
  name: string
  relation: string
  direction: 'outgoing' | 'incoming'
  fn: RollupFn
  /** Property aggregated on the far side. Ignored by `count`. */
  target: string
}

/** A named, saved query over the vault — Notion's database, over files. */
export interface SavedView {
  id: string
  name: string
  icon: string
  kind: ViewKind
  source: ViewSource
  /** Limit to notes under this folder. Empty means the whole vault. */
  folder: string
  filters: ViewFilter[]
  sorts: ViewSort[]
  /** Property to group rows by — the board's columns come from this. */
  groupBy: string | null
  /** Property keys shown as columns in table view. */
  columns: string[]
  /** Computed columns that follow a relation and aggregate the far side. */
  rollups?: ViewRollup[]
}

// ----------------------------------------------------------------- library

/**
 * A folder of documents Stone watches.
 *
 * `index` leaves the files where they are — the iCloud folder GoodNotes already
 * writes to, a Downloads folder — and only reads them. `copy` imports anything
 * new into the vault's attachments folder, so the vault stays self-contained.
 * Both are legitimate: one keeps a single copy, the other keeps the vault
 * portable, and which matters is not something the app can decide.
 */
export interface LibraryFolder {
  id: string
  path: string
  label: string
  mode: 'index' | 'copy'
}

export type DocumentKind = 'pdf' | 'goodnotes' | 'epub' | 'other'

export interface LibraryDoc {
  /** Absolute path for an indexed file; vault-relative for a copied one. */
  id: string
  path: string
  name: string
  kind: DocumentKind
  folderId: string
  /** Set when the file lives inside the vault and can use `stone-file://`. */
  relPath: string | null
  size: number
  mtime: number
  pageCount: number | null
  /** True for an iCloud placeholder whose contents are not on this machine. */
  evicted: boolean
  /** Extraction problems worth telling the user about, rather than hiding. */
  warning: string | null
  /** Notes that link to this document. */
  hasText: boolean
}

// ------------------------------------------------------------------ canvas

/**
 * JSON Canvas — the open format Obsidian's canvases use (jsoncanvas.org).
 *
 * Stone stores canvases in exactly that shape rather than inventing one, for
 * the same reason notes are markdown: a `.canvas` file written here opens in
 * Obsidian, and one written there opens here. The premise of the app is that
 * you own the files, and a proprietary board format would quietly break it.
 */
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

interface CanvasNodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** A preset index `"1"`–`"6"`, or a hex colour. */
  color?: string
}

export type CanvasNode =
  | (CanvasNodeBase & { type: 'text'; text: string })
  | (CanvasNodeBase & { type: 'file'; file: string; subpath?: string })
  | (CanvasNodeBase & { type: 'link'; url: string })
  | (CanvasNodeBase & { type: 'group'; label?: string })

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: CanvasSide
  toNode: string
  toSide?: CanvasSide
  color?: string
  label?: string
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface CanvasFile {
  relPath: string
  name: string
  mtime: number
}

// ------------------------------------------------------ themes and plugins

/** One stylesheet in the vault's theme folder, with its header metadata. */
export interface ThemeInfo {
  relPath: string
  name: string
  author: string | null
  description: string | null
}

/** What a plugin is allowed to do. Checked in main on every API call. */
export type PluginPermission = 'commands' | 'vault-read' | 'vault-write' | 'events'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string | null
  permissions: PluginPermission[]
}

export interface LoadedPlugin extends PluginManifest {
  /** Folder under `.stone/plugins`, which is also the id when none is stated. */
  dir: string
  enabled: boolean
  /** Set when the plugin failed to parse, load, or run. */
  error: string | null
}

/** A command a plugin registered, surfaced in Stone's own palette. */
export interface PluginCommand {
  pluginId: string
  id: string
  name: string
}

// ----------------------------------------------------------------- recovery

export interface TrashEntry {
  /** Path inside `.trash`, relative to the vault. */
  relPath: string
  /** The note's title before deletion. */
  title: string
  deletedAt: number
  size: number
}

/** A point-in-time copy kept under `.stone/snapshots`. */
export interface Snapshot {
  id: string
  relPath: string
  savedAt: number
  size: number
}

// ----------------------------------------------------------------- comments

export interface Comment {
  id: string
  relPath: string
  /** The quoted text the comment is attached to. */
  anchor: string
  body: string
  createdAt: number
  resolved: boolean
}

// ------------------------------------------------------------------ settings

export interface Settings {
  vaultPath: string | null
  theme: 'dark' | 'light' | 'system'
  accentHue: number
  /** Folder inside the vault where daily notes live. */
  dailyFolder: string
  dailyFormat: string
  /** Folders for the other periodic notes. */
  weeklyFolder: string
  monthlyFolder: string
  /** Folder for new notes created from the command palette. */
  inboxFolder: string
  attachmentsFolder: string
  /** Folder holding note templates. */
  templateFolder: string
  /** Template applied to a freshly created daily note, by relPath. */
  dailyTemplate: string | null
  editorFont: 'serif' | 'sans' | 'mono'
  editorWidth: number
  showStrataRail: boolean
  weekStartsOn: 0 | 1
  /** Vim keybindings in the editor. */
  vimMode: boolean
  /**
   * Chords bound to each command, by command id, overriding its defaults.
   * A command absent here keeps its default; one mapped to `[]` is unbound.
   */
  keybindings: Record<string, string[]>
  spellcheck: boolean
  /** Fire an OS notification when a task falls due. */
  remindersEnabled: boolean
  /** Minutes before an event or due time to notify. */
  reminderLeadMinutes: number
  /** Keep a snapshot of each note on save, for recovery. */
  snapshotsEnabled: boolean

  // ------------------------------------------------------------- capture
  /** System-wide chord that opens quick-add, in Electron accelerator form. */
  captureShortcut: string | null
  /** Show a tray icon, so capture survives the window being closed. */
  trayEnabled: boolean
  /** Listen on loopback for the browser clipper. Off unless asked for. */
  clipperEnabled: boolean
  clipperPort: number
  /** Shared secret the bookmarklet presents. Regenerated on demand. */
  clipperToken: string
  /** Folder clipped pages are filed under. */
  clipFolder: string
  /** Vault-relative CSS files loaded into the renderer, on top of the theme. */
  cssSnippets: string[]
  /** Folder inside the vault holding theme stylesheets. */
  themeFolder: string
  /** The one theme in force, by vault-relative path. */
  activeTheme: string | null
  /** Plugin ids the user has switched on. */
  enabledPlugins: string[]
  /** Folders of PDFs and GoodNotes documents Stone indexes. */
  libraryFolders: LibraryFolder[]
  /** Notes pinned to the top of the sidebar. */
  favorites: string[]
  savedViews: SavedView[]
  calendars: CalendarAccount[]
  icsSubscriptions: { id: string; name: string; url: string; color: string }[]
  firstRunComplete: boolean
}

export interface VaultStats {
  notes: number
  tasks: number
  openTasks: number
  words: number
  tags: number
}

/** One matching line inside a search hit, with the match offsets in it. */
export interface SearchMatch {
  line: number
  text: string
  from: number
  to: number
}

export interface SearchHit {
  relPath: string
  title: string
  score: number
  /** Snippet with `<mark>`-free plain text; renderer does the highlighting. */
  excerpt: string
  matchedTerms: string[]
  matches: SearchMatch[]
}

export interface SearchOptions {
  limit?: number
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
}

/** A note that names another note in plain text without linking to it. */
export interface Mention {
  relPath: string
  title: string
  line: number
  text: string
}

export interface GraphNode {
  relPath: string
  title: string
  /** Total links in and out, which drives node size. */
  degree: number
  tags: string[]
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/**
 * Something to do, arriving from outside the window — the global chord, the
 * tray, or a `stone://` link. Main raises the window and forwards one of these
 * rather than acting itself, so the renderer's existing paths stay authoritative.
 */
export type CaptureAction =
  | { type: 'quick-add'; text?: string }
  | { type: 'open'; relPath: string }
  | { type: 'daily' }
  | { type: 'new-note'; title: string; content?: string }

/** Emitted by main whenever the on-disk vault changes. */
export type VaultEvent =
  | { type: 'note-changed'; note: NoteMeta }
  | { type: 'note-removed'; relPath: string }
  | { type: 'reindexed'; count: number }
  | { type: 'conflict'; relPath: string; backupPath: string }
  | { type: 'reminder'; title: string; body: string; relPath: string | null }

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
 * `index` leaves the files where they are — an iCloud folder, a Downloads
 * folder — and only reads them. `copy` imports anything
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

export type DocumentKind = 'pdf' | 'epub' | 'other'

export interface LibraryDoc {
  /** Absolute path for an indexed file; vault-relative for a copied one. */
  id: string
  path: string
  name: string
  kind: DocumentKind
  folderId: string
  /** Set when the file lives inside the vault and can use `stone-file://`. */
  relPath: string | null
  /**
   * Path, relative to the watched folder's root, of the directory holding this
   * document — '/' separated, empty when it sits directly inside the watched
   * folder. It is what lets a folder's own structure reappear in Stone rather
   * than dumping every file into one flat list.
   */
  folderPath: string
  size: number
  mtime: number
  pageCount: number | null
  /** True for an iCloud placeholder whose contents are not on this machine. */
  evicted: boolean
  /** Extraction problems worth telling the user about, rather than hiding. */
  warning: string | null
  hasText: boolean
  /** True when Stone has pages it can actually display. */
  renderable: boolean
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

/**
 * A permanent copy kept under `.stone/backups`. Same shape as a Snapshot, but
 * the file behind it is read-only, never reused, and never rotated out.
 */
export interface Backup {
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
  /** Editor body size in px. The prose measure scales with it. */
  editorFontSize: number
  /** Shell column widths in px, dragged by the user and remembered. */
  sidebarWidth: number
  inspectorWidth: number
  agendaWidth: number
  editorWidth: number
  showStrataRail: boolean
  /**
   * Show Canvas in the view bar. Off by default — it is a surface people either
   * live in or never open, and an unused tab costs everyone attention. The
   * command palette and its chord still reach it either way.
   */
  showCanvas: boolean
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

  // ----------------------------------------------------------- pdf export
  /** Paper the PDF export is laid out for. */
  pdfPageSize: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5'
  /** Page margin in millimetres, applied on all four sides. */
  pdfMargin: number
  /** Open with a cover page carrying the title, author and date. */
  pdfCoverPage: boolean
  /** Include a table of contents. Skipped anyway when there is little to list. */
  pdfToc: boolean
  /** Running header and footer with the note title and a page number. */
  pdfHeaderFooter: boolean
  /** Name printed on the cover. Blank falls back to the vault's name. */
  pdfAuthor: string

  // -------------------------------------------------------------- claude
  /** Model the headless CLI is asked for: an alias like `sonnet`, or a full id. */
  claudeModel: string
  /** Path to the `claude` binary, when the usual places are the wrong ones. */
  claudeCommand: string | null
  /** The mode the ask dialog opens in, remembered from last time. */
  claudeMode: ClaudeMode
  /**
   * What the agent may do beyond reading the vault.
   *
   * Reading is not listed because it is the mode: an agent that cannot open a
   * note cannot answer anything about the vault, and opening one is the same
   * act as the search the user could have run themselves. Writing, the web and
   * the shell are each a further promise, so each is its own switch.
   */
  claudeTools: ClaudeTools
  // ---------------------------------------------------------------- code
  /**
   * Command lines for running a fenced block, keyed by language id.
   *
   * Only the ones the user has changed are stored; everything else falls back
   * to the table in `@shared/code-langs`. A key that is not in that table adds
   * a language Stone ships no runner for.
   */
  codeRunners: Record<string, string>
  /** Seconds a block may run before it is stopped. */
  codeRunTimeout: number
  /** Set the first time the user agrees to run code from a note. */
  codeRunConfirmed: boolean
  /**
   * Whether a note's blocks share one running session per language, the way
   * the cells of a notebook do: what the third block declares, the fourth can
   * use, without the third being run again.
   *
   * A note overrides this with a `notebook:` key in its frontmatter, so a page
   * of unrelated snippets can keep each block to itself in a vault where the
   * rest are notebooks, and the other way round.
   */
  codeNotebook: boolean

  // --------------------------------------------------------------- audio
  /**
   * Path to a Whisper command line, when the usual places are the wrong ones.
   * Auto-detected exactly the way `claudeCommand` is.
   */
  whisperCommand: string | null
  /**
   * The model to transcribe with.
   *
   * whisper.cpp wants a path to a `ggml-*.bin`; the Python and MLX front ends
   * want a name like `base.en` or `mlx-community/whisper-small`. Which of the
   * two it is follows from the binary, so one field covers both.
   */
  whisperModel: string
  /** BCP-47-ish language hint, or `auto` to let the model decide. */
  whisperLanguage: string
  /** Folder inside the vault where recordings are written. */
  audioFolder: string
  /**
   * Stamp each new block written while recording with the time it was started.
   * Off means only the marks the user asks for, from the recorder or its chord.
   */
  audioAutoStamp: boolean
  /** Start transcribing as soon as a recording is stopped. */
  audioTranscribeOnStop: boolean
  /** Scroll the note to the line being spoken while a recording plays back. */
  audioFollow: boolean

  /** Folders of documents Stone indexes. */
  libraryFolders: LibraryFolder[]
  /** Notes pinned to the top of the sidebar. */
  favorites: string[]
  savedViews: SavedView[]
  calendars: CalendarAccount[]
  icsSubscriptions: { id: string; name: string; url: string; color: string }[]
  firstRunComplete: boolean
}

/**
 * What `exportPdf` needs to lay out a page.
 *
 * Passed in rather than read from `settings` inside the exporter, so the module
 * stays a pure function of its arguments — the same shape `claude.ts` follows.
 */
export interface PdfExportOptions {
  pageSize: Settings['pdfPageSize']
  /** Millimetres. */
  margin: number
  coverPage: boolean
  toc: boolean
  headerFooter: boolean
  author: string
}

/**
 * Everything the print window needs to lay out one note.
 *
 * Main resolves the vault-dependent parts — embeds, the author, the edit date —
 * before sending, so the print window never needs vault access of its own.
 */
export interface PrintPayload {
  title: string
  icon: string | null
  relPath: string
  markdown: string
  /** `![[note]]` targets resolved to their markdown, keyed as written. */
  embeds: Record<string, string>
  /** Where a bare `![[shot.png]]` lives, so the print window can find it. */
  attachmentsFolder: string
  /** Frontmatter `subtitle` or `description`, for the cover. */
  subtitle: string | null
  author: string
  vaultName: string
  /** Last edit, already formatted for the reader's locale. */
  edited: string
  options: PdfExportOptions
  /**
   * Page number per heading id, learned from the measuring pass. Absent on the
   * first pass, when the contents page is drawn with placeholders instead.
   */
  pageNumbers?: Record<string, number>
}

/**
 * What Claude is being asked for.
 *
 * The first five are one-shot: a prompt goes out, a block of markdown comes
 * back, and the process dies. `agent` is the odd one — it keeps a session, is
 * allowed tools, and answers over several turns. `lecture` is not offered in
 * the dialog; it is what the transcript panel asks with.
 */
export type ClaudeMode =
  | 'diagram'
  | 'drawing'
  | 'structure'
  | 'animation'
  | 'code'
  | 'text'
  | 'agent'
  | 'lecture'

/** How much of the note goes out with the prompt. */
export type ClaudeContext = 'none' | 'selection' | 'note'

/**
 * What the agent is allowed to touch. Reading the vault is implied by the mode;
 * everything here is off until it is turned on, because a note can arrive from
 * the web clipper and a prompt inside one is a prompt like any other.
 */
export interface ClaudeTools {
  /** Create and edit notes in the vault. */
  write: boolean
  /** Search and fetch the web. */
  web: boolean
  /** Run shell commands in the vault. */
  shell: boolean
}

export interface ClaudeStatus {
  available: boolean
  /** The resolved path, for the settings screen to show. */
  binary: string | null
}

/** A tool call, as the dialog shows it while the agent works. */
export interface ClaudeActivity {
  /** `Read`, `Grep`, `Bash`… */
  tool: string
  /** The interesting argument — a path, a pattern, a command — already cut down. */
  detail: string
}

export interface ClaudeRunResult {
  text: string
  /**
   * The CLI's session id, when there is one to resume. Present for agent runs
   * and null for the one-shot modes, which persist nothing.
   */
  sessionId: string | null
}

/**
 * One utterance, as Whisper heard it.
 *
 * Seconds rather than milliseconds because that is what every Whisper front
 * end emits and what `<audio>.currentTime` is measured in; converting twice on
 * the way through would only be a chance to be off by a thousand.
 */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

/** A finished transcript, cached against the recording it came from. */
export interface Transcript {
  /** Vault-relative path of the audio, which is also the cache key. */
  audio: string
  /** ISO 8601. */
  createdAt: string
  /** What the model reported, or what was asked for. */
  language: string
  /** The command line that produced it, for a transcript that reads oddly. */
  engine: string
  durationSeconds: number
  segments: TranscriptSegment[]
}

/** Which Whisper front end the resolved binary is, since their flags differ. */
export type WhisperFlavor = 'whisper-cpp' | 'openai' | 'mlx' | 'faster'

export interface WhisperStatus {
  available: boolean
  binary: string | null
  flavor: WhisperFlavor | null
  /**
   * `ggml-*.bin` files found in the usual whisper.cpp model directories, so the
   * settings screen can offer them instead of asking for a path.
   */
  models: string[]
}

/** Progress from a transcription in flight, pushed on `audio:progress`. */
export interface TranscribeProgress {
  id: string
  /** What the run is doing now, in words fit to show. */
  stage: string
  /** 0–1, or null while the run cannot say. */
  progress: number | null
  /** Segments decoded so far, for a transcript that fills in as it goes. */
  segments: TranscriptSegment[]
}

/** A recording being written to disk, as the renderer streams it in. */
export interface AudioSink {
  id: string
  relPath: string
}

/** How the audio bar remembers where a note's player was. */
export interface AudioSession {
  /** Vault-relative path of the recording. */
  audio: string
  /** The note it was recorded against or last opened from. */
  note: string
}

/** How a run of a fenced code block ended. */
export interface CodeRunResult {
  /** The exit status, or null when a signal ended it. */
  code: number | null
  signal: string | null
  /** Stopped at `codeRunTimeout` rather than finishing. */
  timedOut: boolean
  /** Stopped from the note's stop button. */
  cancelled: boolean
  ms: number
  /** Whether the block ran in the note's shared session rather than on its own. */
  session: boolean
  /**
   * Which run this was in that session, counting from one — the `[3]` beside
   * the block, and the only way to tell at a glance what a note's blocks have
   * actually seen. Null for a block that ran on its own.
   */
  count: number | null
  /**
   * Something worth saying that the exit code does not: that the session was
   * restarted out from under the block, or that Stone called a `main` for it.
   */
  note: string | null
}

/** Where a run has got to, before it has any output to show for itself. */
export interface CodeRunPhase {
  id: string
  /**
   * `queued` — the session is busy with an earlier block.
   * `starting` — the session process is coming up, which for a JVM is a second.
   * `running` — the block is in.
   */
  phase: 'queued' | 'starting' | 'running'
}

/** A live per-note language session, as the note's blocks need to see it. */
export interface CodeSessionInfo {
  notePath: string
  langId: string
  label: string
  /** Blocks run into it so far. */
  count: number
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

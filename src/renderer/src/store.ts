import { create } from 'zustand'
import type {
  CalEvent,
  CalendarAccount,
  Comment,
  GraphData,
  Mention,
  LibraryDoc,
  NoteMeta,
  PluginCommand,
  PropertyDef,
  RelationEdge,
  SavedView,
  SearchHit,
  SearchOptions,
  Settings,
  Snapshot,
  Task,
  TaskStatus,
  Transcript,
  TranscriptSegment,
  TrashEntry,
  VaultStats
} from '@shared/types'
import { toISODate } from '@shared/task-syntax'
import { setFrontmatterKey } from '@shared/frontmatter'
import { folderNotePath } from '@shared/folder-note'
import { readStamp, stampInsertPoint, stampTarget } from '@shared/audio'
import * as recorder from './audio/recorder'
import * as decode from './audio/decode'
import { insertBlock } from './editor/insert'

export type View =
  | 'today'
  | 'notes'
  | 'calendar'
  | 'tasks'
  | 'graph'
  | 'search'
  | 'trash'
  | 'views'
  | 'canvas'
  | 'library'
export type CalendarMode = 'month' | 'week' | 'agenda'
export type SidePanel =
  | 'backlinks'
  | 'outline'
  | 'properties'
  | 'relations'
  | 'comments'
  | 'localgraph'
  | 'history'
  | 'transcript'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

/**
 * One tab, with its own back/forward stack. History is per tab rather than
 * global because a tab is the thing a person thinks of as "where I was" —
 * a shared stack would make Back in one tab undo navigation in another.
 */
export interface Tab {
  id: string
  relPath: string
  history: string[]
  index: number
}

export interface Pane {
  id: string
  tabs: Tab[]
  active: number
  /**
   * How wide this pane is, as a flex weight rather than pixels — a width has
   * to survive the window resizing and a neighbour closing, and a stored pixel
   * count survives neither. Weights are normalised to sum to the pane count,
   * so an untouched pane is exactly 1.
   */
  size: number
}

/**
 * What a drag is carrying while it is in flight.
 *
 * It lives in the store rather than in `dataTransfer` because every pane has
 * to render its drop targets *during* the drag, and dataTransfer's payload is
 * deliberately unreadable until the drop actually happens.
 */
export type PaneDrag =
  | { kind: 'tab'; pane: number; tabId: string; relPath: string }
  | { kind: 'pane'; pane: number }

/** An open buffer. Panes share these, so the same note split twice stays in step. */
export interface Doc {
  content: string
  hash: string | null
  dirty: boolean
  /** Line the editor should reveal once, from a `[[Note#Heading]]` jump. */
  revealLine: number | null
}

/**
 * A tab holds either a note or a document, and both have to live in the same
 * history stack — going Back from a PDF should land on the note you came from.
 *
 * Rather than widen `Tab` into a tagged union and rewrite every pane, a
 * document tab's target is its absolute path behind a `doc:` prefix. The tab,
 * its history, and the pane machinery stay plain strings; only the few places
 * that actually render or name a target have to know the difference.
 */
/**
 * A recording in progress.
 *
 * `startedAt` and the paused totals rather than a ticking counter: a timer that
 * counts frames drifts, and the one number that has to be exact is the offset
 * written into the note — a stamp two seconds late points at the wrong sentence.
 */
export interface RecordingState {
  id: string
  /** Vault-relative path of the file being written. */
  relPath: string
  /** The note being stamped, or null when recording started outside one. */
  note: string | null
  /** What a stamp's link points at, already encoded. */
  target: string
  startedAt: number
  /** When the current pause began, or null while running. */
  pausedAt: number | null
  /** Milliseconds spent paused before the current pause. */
  pausedMs: number
}

/** Seconds of audio captured so far — what a stamp written now would say. */
export function recordingElapsed(recording: RecordingState): number {
  const paused =
    recording.pausedMs + (recording.pausedAt === null ? 0 : Date.now() - recording.pausedAt)
  return Math.max(0, (Date.now() - recording.startedAt - paused) / 1000)
}

/** The player at the foot of the window, and what it is following. */
export interface PlaybackState {
  /** Vault-relative path of the recording. */
  audio: string
  /** The note whose stamps are being followed, or null. */
  note: string | null
  playing: boolean
  /** Start as soon as the element has loaded — a stamp click, not a bare open. */
  autoplay: boolean
  time: number
  /** 0 until the element or the transcript says otherwise. */
  duration: number
  rate: number
}

/** A transcription in flight. */
export interface TranscribeState {
  id: string
  audio: string
  stage: string
  /** 0–1, or null while the run cannot say. */
  progress: number | null
  segments: TranscriptSegment[]
}

export const DOC_PREFIX = 'doc:'

export function isDocTarget(target: string): boolean {
  return target.startsWith(DOC_PREFIX)
}

export function docPathOf(target: string): string {
  return target.slice(DOC_PREFIX.length)
}

export function docTarget(absPath: string): string {
  return `${DOC_PREFIX}${absPath}`
}

/** Range the calendar needs loaded, padded so month edges are never blank. */
function monthWindow(anchor: string): { from: string; to: string } {
  const d = new Date(`${anchor}T00:00:00`)
  const from = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const to = new Date(d.getFullYear(), d.getMonth() + 2, 0)
  return { from: toISODate(from), to: toISODate(to) }
}

let seq = 0
const nextId = (prefix: string): string => `${prefix}-${++seq}`

const HISTORY_LIMIT = 60

/** One question for the text dialog: what to ask, and what to prefill. */
export interface TextRequest {
  title: string
  /** Prefilled and selected, so a rename can be typed straight over. */
  value?: string
  placeholder?: string
  confirmLabel?: string
}

interface StoneState {
  ready: boolean
  settings: Settings | null
  stats: VaultStats | null

  view: View
  notes: NoteMeta[]
  tasks: Task[]
  tags: { tag: string; count: number }[]
  folders: string[]
  properties: PropertyDef[]
  /** Resolved frontmatter links, for relation columns and rollups. */
  relations: RelationEdge[]
  templates: NoteMeta[]
  activity: Record<string, number>
  graph: GraphData | null
  localGraph: GraphData | null

  panes: Pane[]
  activePane: number
  /** The tab or pane currently being dragged, or null when nothing is. */
  paneDrag: PaneDrag | null
  /** Which pane the go-to-file picker will open into, or null when it is shut. */
  quickOpen: number | null
  docs: Record<string, Doc>

  /** The focused pane's note — what the side panels describe. */
  activeRelPath: string | null
  backlinks: NoteMeta[]
  mentions: Mention[]
  comments: Comment[]
  snapshots: Snapshot[]
  sidePanel: SidePanel
  panelOpen: boolean

  trash: TrashEntry[]

  searchQuery: string
  searchOptions: SearchOptions
  searchHits: SearchHit[]
  searching: boolean

  activeViewId: string | null

  /** Commands contributed by plugins, merged into the palette. */
  pluginCommands: PluginCommand[]

  /** Documents from the watched folders, alongside the notes. */
  documents: LibraryDoc[]
  loadDocuments: () => Promise<void>
  /** Pick a folder to watch. Resolves false when the picker was dismissed. */
  addLibraryFolder: (mode: 'index' | 'copy') => Promise<boolean>
  removeLibraryFolder: (id: string) => Promise<void>
  openDocument: (absPath: string, opts?: { newTab?: boolean; pane?: number }) => void

  /**
   * The Today view's journal is bound to the day's note specifically, kept
   * separate from the global selection so that clicking a note in the sidebar
   * does not swap out what the journal is editing.
   */
  dailyRelPath: string | null
  dailyContent: string
  dailyHash: string | null
  dailyDirty: boolean

  events: CalEvent[]
  accounts: CalendarAccount[]
  calendarErrors: string[]
  calendarMode: CalendarMode
  /** The day the calendar is centred on, `YYYY-MM-DD`. */
  anchor: string
  selectedDay: string
  loadedRange: { from: string; to: string } | null
  calendarLoading: boolean

  paletteOpen: boolean
  settingsOpen: boolean
  quickAddOpen: boolean
  /** The ask-Claude dialog. Seeded with text when opened from a selection. */
  claudeOpen: boolean
  claudeSeed: string
  /** Text quick-add opens with, when capture arrived carrying some. */
  quickAddSeed: string
  sidebarOpen: boolean
  agendaOpen: boolean
  toasts: Toast[]

  boot: () => Promise<void>
  setView: (view: View) => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void

  refreshVault: () => Promise<void>
  loadGraph: () => Promise<void>
  loadLocalGraph: () => Promise<void>
  patchNoteMeta: (relPath: string, patch: Partial<NoteMeta>) => void

  openNote: (relPath: string, opts?: { newTab?: boolean; pane?: number; line?: number }) => Promise<void>
  openTarget: (target: string) => Promise<void>
  closeTab: (paneIndex: number, tabId: string) => void
  focusTab: (paneIndex: number, tabIndex: number) => void
  focusPane: (paneIndex: number) => void
  splitPane: () => void
  closePane: (paneIndex: number) => void
  setPaneDrag: (drag: PaneDrag | null) => void
  moveTab: (from: { pane: number; tabId: string }, to: { pane: number; index: number }) => void
  tabToNewPane: (from: { pane: number; tabId: string }, at: number) => void
  movePane: (from: number, at: number) => void
  mergePane: (from: number, into: number) => void
  setPaneSizes: (sizes: number[]) => void
  setQuickOpen: (pane: number | null) => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean

  setDoc: (relPath: string, content: string) => void
  saveDoc: (relPath: string) => Promise<void>
  consumeReveal: (relPath: string) => void

  createNote: (
    title: string,
    folder?: string,
    opts?: { pane?: number; newTab?: boolean }
  ) => Promise<void>
  createFromTemplate: (title: string, templateRelPath: string) => Promise<void>
  /** Open the note that defines a folder, writing a starter one if needed. */
  openFolderNote: (folderRel: string, opts?: { newTab?: boolean; pane?: number }) => Promise<void>
  deleteNote: (relPath: string) => Promise<void>
  renameNote: (relPath: string, title: string) => Promise<void>
  moveNote: (relPath: string, folder: string) => Promise<void>
  duplicateNote: (relPath: string) => Promise<void>
  toggleFavorite: (relPath: string) => Promise<void>
  setNoteProperty: (relPath: string, key: string, value: string | null) => Promise<void>

  openDaily: (date?: string) => Promise<void>
  openPeriodic: (kind: 'week' | 'month', date?: string) => Promise<void>
  loadDaily: (date: string) => Promise<void>
  setDailyDraft: (content: string) => void
  saveDaily: () => Promise<void>

  toggleTask: (task: Task, status?: TaskStatus) => Promise<void>
  quickAddTask: (input: Parameters<Window['stone']['tasks']['quickAdd']>[0]) => Promise<void>

  loadCalendar: (force?: boolean) => Promise<void>
  setAnchor: (date: string) => void
  setSelectedDay: (date: string) => void
  setCalendarMode: (mode: CalendarMode) => void
  refreshAccounts: () => Promise<void>

  runSearch: (query: string, options?: SearchOptions) => Promise<void>
  setSearchOptions: (patch: Partial<SearchOptions>) => void
  replaceAll: (replacement: string) => Promise<void>

  loadTrash: () => Promise<void>
  restoreFromTrash: (relPath: string) => Promise<void>
  emptyTrash: () => Promise<void>

  loadComments: () => Promise<void>
  addComment: (anchor: string, body: string) => Promise<void>
  updateComment: (id: string, patch: { body?: string; resolved?: boolean }) => Promise<void>
  removeComment: (id: string) => Promise<void>
  loadSnapshots: () => Promise<void>
  restoreSnapshot: (id: string) => Promise<void>

  saveView: (view: SavedView) => Promise<void>
  deleteView: (id: string) => Promise<void>
  setActiveView: (id: string | null) => void

  updateSettings: (patch: Partial<Settings>) => Promise<void>
  applyCssSnippets: () => Promise<void>
  applyTheme: () => Promise<void>
  /**
   * Ask the user for a single line of text.
   *
   * `window.prompt` throws in Electron — it is overridden to
   * `throw new Error('prompt() is not supported.')` — so every caller of it was
   * dead code that failed silently inside its click handler. This is the
   * replacement: a real dialog, awaited, resolving null when dismissed.
   */
  askText: (request: TextRequest) => Promise<string | null>
  /** The dialog currently open, if any. Rendered by `PromptDialog`. */
  textRequest: (TextRequest & { resolve: (value: string | null) => void }) | null
  resolveText: (value: string | null) => void

  setPalette: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setQuickAdd: (open: boolean, seed?: string) => void
  setClaude: (open: boolean, seed?: string) => void
  toggleSidebar: () => void
  toggleAgenda: () => void
  setSidePanel: (panel: SidePanel) => void
  togglePanel: () => void

  // ---------------------------------------------------------------- audio
  /** The recording in progress, or null. There is only ever one microphone. */
  recording: RecordingState | null
  /** The player at the foot of the window, or null when nothing is loaded. */
  playback: PlaybackState | null
  /** The transcription in flight, or null. */
  transcribing: TranscribeState | null
  /**
   * Transcripts already fetched, by recording path. `null` is a real answer —
   * "asked, and there is none" — which is what stops the panel asking again on
   * every render of an untranscribed lecture.
   */
  transcripts: Record<string, Transcript | null>

  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  discardRecording: () => Promise<void>
  toggleRecordingPause: () => void

  openPlayer: (
    audio: string,
    note?: string | null,
    opts?: { at?: number; play?: boolean }
  ) => Promise<void>
  closePlayer: () => void
  setPlayback: (patch: Partial<PlaybackState>) => void

  transcribe: (audio: string) => Promise<void>
  cancelTranscribe: () => void
  loadTranscript: (audio: string) => Promise<Transcript | null>
}

let toastSeq = 0
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
let dailyTimer: ReturnType<typeof setTimeout> | null = null

function makeTab(relPath: string): Tab {
  return { id: nextId('tab'), relPath, history: [relPath], index: 0 }
}

/** Past three columns a pane is narrower than a line of prose is long. */
export const MAX_PANES = 3

/**
 * Restore the invariants any pane operation can break: no empty splits, always
 * one pane, a valid active tab in each, and weights that sum to the pane count.
 *
 * Every operation below ends here, which is what lets each of them stay plain
 * arithmetic — none has to reason about what its own edge case did to the rest
 * of the layout.
 */
function settle(
  panes: Pane[],
  preferId?: string,
  fallback = 0
): { panes: Pane[]; activePane: number; activeRelPath: string | null } {
  let next = panes.filter((pane) => pane.tabs.length > 0)
  // Nothing open is still a place: one empty pane, to say so in.
  if (next.length === 0) {
    next = [{ id: panes[0]?.id ?? nextId('pane'), tabs: [], active: 0, size: 1 }]
  }

  const weight = (pane: Pane): number => (pane.size > 0 ? pane.size : 1)
  const total = next.reduce((sum, pane) => sum + weight(pane), 0)
  next = next.map((pane) => ({
    ...pane,
    active: Math.max(0, Math.min(pane.active, pane.tabs.length - 1)),
    size: (weight(pane) / total) * next.length
  }))

  const preferred = preferId ? next.findIndex((pane) => pane.id === preferId) : -1
  const activePane = preferred !== -1 ? preferred : Math.max(0, Math.min(fallback, next.length - 1))
  const pane = next[activePane]
  return { panes: next, activePane, activeRelPath: pane?.tabs[pane.active]?.relPath ?? null }
}

export const useStone = create<StoneState>((set, get) => ({
  ready: false,
  settings: null,
  stats: null,

  view: 'today',
  notes: [],
  tasks: [],
  tags: [],
  folders: [],
  properties: [],
  relations: [],
  templates: [],
  activity: {},
  graph: null,
  localGraph: null,

  panes: [{ id: nextId('pane'), tabs: [], active: 0, size: 1 }],
  activePane: 0,
  paneDrag: null,
  quickOpen: null,
  docs: {},

  activeRelPath: null,
  backlinks: [],
  mentions: [],
  comments: [],
  snapshots: [],
  sidePanel: 'backlinks',
  panelOpen: false,

  trash: [],

  searchQuery: '',
  searchOptions: { regex: false, caseSensitive: false, wholeWord: false },
  searchHits: [],
  searching: false,

  activeViewId: null,
  pluginCommands: [],
  documents: [],

  recording: null,
  playback: null,
  transcribing: null,
  transcripts: {},

  dailyRelPath: null,
  dailyContent: '',
  dailyHash: null,
  dailyDirty: false,

  events: [],
  accounts: [],
  calendarErrors: [],
  calendarMode: 'month',
  anchor: toISODate(new Date()),
  selectedDay: toISODate(new Date()),
  loadedRange: null,
  calendarLoading: false,

  paletteOpen: false,
  settingsOpen: false,
  quickAddOpen: false,
  quickAddSeed: '',
  claudeOpen: false,
  claudeSeed: '',
  sidebarOpen: true,
  agendaOpen: true,
  toasts: [],

  async boot() {
    const settings = await window.stone.settings.get()
    document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.vim = settings.vimMode ? 'on' : 'off'
    set({ settings })

    if (settings.vaultPath) {
      await get().refreshVault()
      void get().loadCalendar()
      void get().refreshAccounts()
      // Theme before snippets, so a snippet can still override the theme.
      void get().applyTheme().then(() => get().applyCssSnippets())
      void window.stone.plugins
        .commands()
        .then((pluginCommands) => set({ pluginCommands }))
        .catch(() => undefined)
    }
    set({ ready: true })

    window.stone.plugins.onCommands((pluginCommands) => set({ pluginCommands }))
    // The first library scan runs in the background in main, so the list
    // arrives after boot rather than during it.
    window.stone.library.onScanned((documents) => set({ documents }))
    void get().loadDocuments()

    // Capture from the global chord, the tray, or a `stone://` link. Main has
    // already raised the window by the time one of these lands.
    window.stone.capture.onAction((action) => {
      switch (action.type) {
        case 'quick-add':
          get().setQuickAdd(true, action.text)
          break
        case 'open':
          void get().openNote(action.relPath)
          break
        case 'daily':
          void get().openDaily().then(() => get().setView('today'))
          break
        case 'new-note':
          void get().createNote(action.title)
          break
      }
    })

    window.stone.vault.onEvent((event) => {
      if (event.type === 'conflict') {
        get().toast(
          `Another device had also changed this note. The remote version was kept as ${event.backupPath}.`,
          'error'
        )
      }
      if (event.type === 'reminder') {
        get().toast(`${event.title} — ${event.body}`, 'info')
        return
      }
      void get().refreshVault()
    })
  },

  setView(view) {
    set({ view })
    if (view === 'calendar') void get().loadCalendar()
    if (view === 'graph') void get().loadGraph()
    if (view === 'trash') void get().loadTrash()
  },

  /**
   * Optimistically update one note's indexed metadata. Used for page icons and
   * covers so the sidebar row changes in the same frame as the page, rather
   * than a beat later when the file watcher catches up.
   */
  patchNoteMeta(relPath, patch) {
    set((state) => ({
      notes: state.notes.map((n) => (n.relPath === relPath ? { ...n, ...patch } : n))
    }))
  },

  async loadGraph() {
    try {
      set({ graph: await window.stone.vault.graph() })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async loadLocalGraph() {
    const relPath = get().activeRelPath
    if (!relPath) {
      set({ localGraph: null })
      return
    }
    try {
      set({ localGraph: await window.stone.vault.localGraph(relPath, 2) })
    } catch {
      set({ localGraph: null })
    }
  },

  toast(message, tone = 'info') {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
    // Errors stay until dismissed. An error worth showing is one the user may
    // need to read twice, quote in a bug report, or act on — and a message that
    // deletes itself after eight seconds is one they cannot copy.
    if (tone !== 'error') setTimeout(() => get().dismissToast(id), 3600)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  async refreshVault() {
    const [notes, tasks, stats, tags, activity, folders, properties, relations, templates] =
      await Promise.all([
        window.stone.notes.list(),
        window.stone.tasks.all(),
        window.stone.vault.stats(),
        window.stone.vault.tags(),
        window.stone.vault.activity(),
        window.stone.folders.list().catch(() => [] as string[]),
        window.stone.vault.properties().catch(() => [] as PropertyDef[]),
        window.stone.vault.relations().catch(() => [] as RelationEdge[]),
        window.stone.templates.list().catch(() => [] as NoteMeta[])
      ])
    set({ notes, tasks, stats, tags, activity, folders, properties, relations, templates })

    // Only the graph screen pays for rebuilding the graph on every file change.
    if (get().view === 'graph') void get().loadGraph()

    const active = get().activeRelPath
    // A document can be the active tab, and it has no note metadata to refresh.
    if (active && !isDocTarget(active)) {
      const backlinks = await window.stone.notes.backlinks(active)
      set({ backlinks })
      // An external edit while the buffer is clean should show through.
      const doc = get().docs[active]
      if (doc && !doc.dirty) {
        const fresh = await window.stone.notes.get(active)
        if (fresh && fresh.content !== doc.content) {
          set((state) => ({
            docs: {
              ...state.docs,
              [active]: { ...doc, content: fresh.content, hash: fresh ? state.docs[active].hash : null }
            }
          }))
          const hash = await window.stone.notes.hash(active)
          set((state) => ({
            docs: { ...state.docs, [active]: { ...state.docs[active], hash } }
          }))
        }
      }
    }
  },

  // ------------------------------------------------------------- navigation

  async openNote(relPath, opts = {}) {
    // Today's journal autosaves on a delay, so flush it before reading any file
    // off disk — otherwise opening the day note as a page loses the last few
    // keystrokes, and the pending write then lands under the open editor.
    if (get().dailyDirty) await get().saveDaily()

    const note = await window.stone.notes.get(relPath)
    if (!note) {
      get().toast('That note is no longer in the vault.', 'error')
      return
    }
    const hash = await window.stone.notes.hash(relPath)

    set((state) => {
      const paneIndex = Math.min(opts.pane ?? state.activePane, state.panes.length - 1)
      const panes = state.panes.map((pane, index) => {
        if (index !== paneIndex) return pane

        const existing = pane.tabs.findIndex((t) => t.relPath === relPath)
        if (existing !== -1 && !opts.newTab) return { ...pane, active: existing }

        if (opts.newTab || pane.tabs.length === 0) {
          const tabs = [...pane.tabs, makeTab(relPath)]
          return { ...pane, tabs, active: tabs.length - 1 }
        }

        // Reuse the current tab, pushing onto its history and dropping whatever
        // was ahead of it — the same contract a browser's address bar has.
        const tabs = pane.tabs.map((tab, i) => {
          if (i !== pane.active) return tab
          if (tab.relPath === relPath) return tab
          const history = [...tab.history.slice(0, tab.index + 1), relPath].slice(-HISTORY_LIMIT)
          return { ...tab, relPath, history, index: history.length - 1 }
        })
        return { ...pane, tabs }
      })

      return {
        panes,
        activePane: paneIndex,
        activeRelPath: relPath,
        // Opening a page is a request to read it, so the pane it lands in has
        // to be the one on screen — including from Today, whose sidebar and
        // event rows would otherwise open notes nobody can see.
        view: 'notes',
        docs: {
          ...state.docs,
          [relPath]: {
            content: note.content,
            hash,
            dirty: state.docs[relPath]?.dirty ?? false,
            revealLine: opts.line ?? null
          }
        }
      }
    })

    const [backlinks, mentions] = await Promise.all([
      window.stone.notes.backlinks(relPath),
      window.stone.notes.mentions(relPath).catch(() => [] as Mention[])
    ])
    set({ backlinks, mentions })
    if (get().sidePanel === 'comments') void get().loadComments()
    if (get().sidePanel === 'history') void get().loadSnapshots()
    if (get().sidePanel === 'localgraph') void get().loadLocalGraph()
  },

  /**
   * Follow a raw link target, which may carry a `#heading` or `^block` anchor.
   * Resolution happens in main, where aliases and block ids are indexed.
   */
  async openTarget(target) {
    try {
      const hit = await window.stone.notes.resolveLink(target)
      if (hit) {
        await get().openNote(hit.relPath, { line: hit.line ?? undefined })
        return
      }
    } catch {
      // Fall through to the document index, then to creating the note.
    }

    const name = target.split(/[#^]/)[0].trim()
    if (!name) return

    // No note answers to that name — but a document might. This is what makes
    // `[[Calculus III]]` reach a document, so linking a PDF costs no more than
    // linking a note and nobody has to know which kind of thing it is.
    const needle = name.toLowerCase()
    const doc =
      get().documents.find((d) => d.name.toLowerCase() === needle) ??
      get().documents.find((d) => d.name.toLowerCase().startsWith(needle))
    if (doc) {
      get().openDocument(doc.path)
      return
    }

    get().toast(`Creating "${name}".`, 'info')
    await get().createNote(name)
  },

  // ------------------------------------------------------------- documents

  async loadDocuments() {
    try {
      set({ documents: await window.stone.library.list() })
    } catch {
      set({ documents: [] })
    }
  },

  /**
   * Add a watched folder, from wherever the button happens to be.
   *
   * Main picks the folder, saves it and scans it, so all this does is take the
   * new list back — three places offer this button and they were drifting.
   */
  async addLibraryFolder(mode) {
    const settings = get().settings
    try {
      const result = await window.stone.library.addFolder(mode)
      if (!result) return false
      if (settings) set({ settings: { ...settings, libraryFolders: result.libraryFolders } })
      set({ documents: await window.stone.library.list() })
      get().toast(`Watching ${result.folder.label}.`, 'success')
      return true
    } catch (err) {
      get().toast((err as Error).message, 'error')
      return false
    }
  },

  async removeLibraryFolder(id) {
    const settings = get().settings
    try {
      const libraryFolders = await window.stone.library.removeFolder(id)
      if (settings) set({ settings: { ...settings, libraryFolders } })
      set({ documents: await window.stone.library.list() })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  /**
   * Open a document in a pane, exactly as a note opens.
   *
   * Same tabs, same history, same splits — which is the whole point: a PDF you
   * are reading and the note you are writing about it belong side by side, and
   * that only works if a document is not a different kind of citizen.
   */
  openDocument(absPath, opts = {}) {
    const target = docTarget(absPath)
    set((state) => {
      const paneIndex = Math.min(opts.pane ?? state.activePane, state.panes.length - 1)
      const panes = state.panes.map((pane, index) => {
        if (index !== paneIndex) return pane

        const existing = pane.tabs.findIndex((t) => t.relPath === target)
        if (existing !== -1 && !opts.newTab) return { ...pane, active: existing }

        if (opts.newTab || pane.tabs.length === 0) {
          const tabs = [...pane.tabs, makeTab(target)]
          return { ...pane, tabs, active: tabs.length - 1 }
        }

        const tabs = pane.tabs.map((tab, i) => {
          if (i !== pane.active) return tab
          if (tab.relPath === target) return tab
          const history = [...tab.history.slice(0, tab.index + 1), target].slice(-HISTORY_LIMIT)
          return { ...tab, relPath: target, history, index: history.length - 1 }
        })
        return { ...pane, tabs }
      })

      return { panes, activePane: paneIndex, activeRelPath: target, view: 'notes' }
    })
  },

  closeTab(paneIndex, tabId) {
    set((state) => {
      const panes = state.panes.map((pane, index) => {
        if (index !== paneIndex) return pane
        const position = pane.tabs.findIndex((t) => t.id === tabId)
        if (position === -1) return pane
        const tabs = pane.tabs.filter((t) => t.id !== tabId)
        return { ...pane, tabs, active: Math.max(0, Math.min(pane.active, tabs.length - 1)) }
      })

      // An emptied split is closed outright; keeping one on screen is only ever
      // an accident. `settle` also hands the space back to its neighbours.
      return settle(panes, state.panes[state.activePane]?.id, state.activePane)
    })
  },

  focusTab(paneIndex, tabIndex) {
    set((state) => {
      const panes = state.panes.map((pane, index) =>
        index === paneIndex ? { ...pane, active: tabIndex } : pane
      )
      return {
        panes,
        activePane: paneIndex,
        activeRelPath: panes[paneIndex]?.tabs[tabIndex]?.relPath ?? null
      }
    })
    // Reload the buffer and the panels around it, but nothing else: clicking a
    // tab is not navigation, so it must not touch that tab's history. `hydrate`
    // also knows a document tab has no buffer to fetch, where `openNote` would
    // go looking for a note that was never there and report it missing.
    const relPath = get().activeRelPath
    if (relPath) void hydrate(relPath, set, get)
  },

  focusPane(paneIndex) {
    set((state) => {
      const pane = state.panes[paneIndex]
      return {
        activePane: paneIndex,
        activeRelPath: pane?.tabs[pane.active]?.relPath ?? state.activeRelPath
      }
    })
  },

  splitPane() {
    set((state) => {
      if (state.panes.length >= MAX_PANES) return state
      const current = state.panes[state.activePane]
      const tab = current?.tabs[current.active]
      if (!tab) return state
      const pane: Pane = { id: nextId('pane'), tabs: [makeTab(tab.relPath)], active: 0, size: 1 }
      const panes = [...state.panes]
      // Beside what it came from, not at the far end: a split is a companion to
      // the thing you were already reading.
      panes.splice(state.activePane + 1, 0, pane)
      return settle(panes, pane.id)
    })
  },

  closePane(paneIndex) {
    set((state) => {
      if (state.panes.length === 1) return state
      const panes = state.panes.filter((_, index) => index !== paneIndex)
      const keep = state.activePane === paneIndex ? undefined : state.panes[state.activePane]?.id
      return settle(panes, keep, Math.min(state.activePane, panes.length - 1))
    })
  },

  setPaneDrag(paneDrag) {
    set({ paneDrag })
  },

  /**
   * Move a tab to a slot in a pane — a reorder when the panes match, a move
   * across the divider when they don't. Either way the `Tab` object itself
   * travels, so its back/forward stack arrives with it.
   */
  moveTab(from, to) {
    set((state) => {
      const source = state.panes[from.pane]
      const position = source?.tabs.findIndex((t) => t.id === from.tabId) ?? -1
      if (!source || position === -1) return state

      const tab = source.tabs[position]
      // Within one strip, lifting the tab out shifts every later slot down by
      // one — so the slot it was aimed at moves too.
      let index = to.index
      if (to.pane === from.pane && position < index) index -= 1

      const panes = state.panes
        .map((pane, i) =>
          i === from.pane ? { ...pane, tabs: pane.tabs.filter((t) => t.id !== from.tabId) } : pane
        )
        .map((pane, i) => {
          if (i !== to.pane) return pane
          const tabs = [...pane.tabs]
          const at = Math.max(0, Math.min(index, tabs.length))
          tabs.splice(at, 0, tab)
          return { ...pane, tabs, active: at }
        })

      return settle(panes, state.panes[to.pane]?.id, to.pane)
    })
  },

  /** Tear a tab out into a split of its own, at a given column. */
  tabToNewPane(from, at) {
    set((state) => {
      const source = state.panes[from.pane]
      const tab = source?.tabs.find((t) => t.id === from.tabId)
      if (!source || !tab) return state
      // A pane's only tab dropped elsewhere empties the pane it left, so the
      // column count holds and the cap has nothing to say about it.
      if (source.tabs.length > 1 && state.panes.length >= MAX_PANES) return state

      const pane: Pane = { id: nextId('pane'), tabs: [tab], active: 0, size: 1 }
      const panes = state.panes.map((p, i) =>
        i === from.pane ? { ...p, tabs: p.tabs.filter((t) => t.id !== from.tabId) } : p
      )
      panes.splice(Math.max(0, Math.min(at, panes.length)), 0, pane)
      return settle(panes, pane.id)
    })
  },

  /** Reorder the columns. `at` is a slot between panes, counted before the move. */
  movePane(from, at) {
    set((state) => {
      if (at === from || at === from + 1) return state
      const panes = [...state.panes]
      const [pane] = panes.splice(from, 1)
      if (!pane) return state
      panes.splice(Math.max(0, Math.min(at > from ? at - 1 : at, panes.length)), 0, pane)
      return settle(panes, pane.id)
    })
  },

  /** Fold one split's tabs into another and close it. */
  mergePane(from, into) {
    set((state) => {
      const source = state.panes[from]
      const target = state.panes[into]
      if (from === into || !source || !target) return state
      // A note already open in the target is the same buffer, not a second copy.
      const incoming = source.tabs.filter(
        (tab) => !target.tabs.some((t) => t.relPath === tab.relPath)
      )
      const panes = state.panes.map((pane, i) => {
        if (i === from) return { ...pane, tabs: [] }
        if (i !== into) return pane
        return {
          ...pane,
          tabs: [...pane.tabs, ...incoming],
          active: incoming.length > 0 ? pane.tabs.length : pane.active
        }
      })
      return settle(panes, target.id, into)
    })
  },

  setPaneSizes(sizes) {
    set((state) => {
      if (sizes.length !== state.panes.length) return state
      const total = sizes.reduce((sum, n) => sum + n, 0) || sizes.length
      return {
        panes: state.panes.map((pane, i) => ({
          ...pane,
          size: (sizes[i] / total) * sizes.length
        }))
      }
    })
  },

  setQuickOpen(pane) {
    set({ quickOpen: pane })
  },

  canGoBack() {
    const state = get()
    const tab = state.panes[state.activePane]?.tabs[state.panes[state.activePane]?.active]
    return Boolean(tab && tab.index > 0)
  },

  canGoForward() {
    const state = get()
    const tab = state.panes[state.activePane]?.tabs[state.panes[state.activePane]?.active]
    return Boolean(tab && tab.index < tab.history.length - 1)
  },

  goBack() {
    const state = get()
    const pane = state.panes[state.activePane]
    const tab = pane?.tabs[pane.active]
    if (!tab || tab.index === 0) return
    const target = tab.history[tab.index - 1]
    set({
      panes: state.panes.map((p, i) =>
        i !== state.activePane
          ? p
          : {
              ...p,
              tabs: p.tabs.map((t, j) =>
                j !== p.active ? t : { ...t, relPath: target, index: t.index - 1 }
              )
            }
      ),
      activeRelPath: target
    })
    void hydrate(target, set, get)
  },

  goForward() {
    const state = get()
    const pane = state.panes[state.activePane]
    const tab = pane?.tabs[pane.active]
    if (!tab || tab.index >= tab.history.length - 1) return
    const target = tab.history[tab.index + 1]
    set({
      panes: state.panes.map((p, i) =>
        i !== state.activePane
          ? p
          : {
              ...p,
              tabs: p.tabs.map((t, j) =>
                j !== p.active ? t : { ...t, relPath: target, index: t.index + 1 }
              )
            }
      ),
      activeRelPath: target
    })
    void hydrate(target, set, get)
  },

  // ------------------------------------------------------------- documents

  setDoc(relPath, content) {
    set((state) => {
      const doc = state.docs[relPath]
      if (!doc) return state
      return { docs: { ...state.docs, [relPath]: { ...doc, content, dirty: true } } }
    })

    const existing = saveTimers.get(relPath)
    if (existing) clearTimeout(existing)
    saveTimers.set(
      relPath,
      setTimeout(() => void get().saveDoc(relPath), 900)
    )
  },

  async saveDoc(relPath) {
    const doc = get().docs[relPath]
    if (!doc) return
    const timer = saveTimers.get(relPath)
    if (timer) {
      clearTimeout(timer)
      saveTimers.delete(relPath)
    }
    try {
      const result = await window.stone.notes.save(relPath, doc.content, doc.hash ?? undefined)
      set((state) => ({
        docs: state.docs[relPath]
          ? { ...state.docs, [relPath]: { ...state.docs[relPath], dirty: false, hash: result.hash } }
          : state.docs
      }))
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  consumeReveal(relPath) {
    set((state) => {
      const doc = state.docs[relPath]
      if (!doc || doc.revealLine === null) return state
      return { docs: { ...state.docs, [relPath]: { ...doc, revealLine: null } } }
    })
  },

  // ----------------------------------------------------------- note actions

  async createNote(title, folder, opts = {}) {
    const settings = get().settings
    const target = folder ?? settings?.inboxFolder ?? 'Notes'
    try {
      // Empty body: the filename is the title, so an H1 would just duplicate it.
      const { relPath } = await window.stone.notes.create(target, title, '')
      await get().refreshVault()
      await get().openNote(relPath, opts)
      set({ view: 'notes' })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async createFromTemplate(title, templateRelPath) {
    try {
      const { relPath } = await window.stone.templates.create(title, templateRelPath)
      await get().refreshVault()
      await get().openNote(relPath)
      set({ view: 'notes' })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async openFolderNote(folderRel, opts = {}) {
    try {
      const existing = folderNotePath(folderRel)
      // Already indexed? Open it without a round trip to the main process, so
      // clicking a folder feels the same as clicking a note.
      if (existing && get().notes.some((n) => n.relPath === existing)) {
        await get().openNote(existing, opts)
        set({ view: 'notes' })
        return
      }
      const { relPath } = await window.stone.folders.note(folderRel)
      await get().refreshVault()
      await get().openNote(relPath, opts)
      set({ view: 'notes' })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async deleteNote(relPath) {
    await window.stone.notes.remove(relPath)
    set((state) => {
      const docs = { ...state.docs }
      delete docs[relPath]
      const panes = state.panes.map((pane) => {
        const tabs = pane.tabs.filter((t) => t.relPath !== relPath)
        return { ...pane, tabs, active: Math.max(0, Math.min(pane.active, tabs.length - 1)) }
      })
      return { docs, ...settle(panes, state.panes[state.activePane]?.id, state.activePane) }
    })
    await get().refreshVault()
    get().toast('Moved to the vault trash.', 'success')
  },

  async renameNote(relPath, title) {
    try {
      const { relPath: next } = await window.stone.notes.rename(relPath, title)
      set((state) => {
        const docs = { ...state.docs }
        delete docs[relPath]
        const panes = state.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((tab) =>
            tab.relPath === relPath
              ? { ...tab, relPath: next, history: tab.history.map((h) => (h === relPath ? next : h)) }
              : tab
          )
        }))
        return { docs, panes }
      })
      await get().refreshVault()
      await get().openNote(next)
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async moveNote(relPath, folder) {
    try {
      const { relPath: next } = await window.stone.notes.move(relPath, folder)
      await get().refreshVault()
      if (next !== relPath) await get().openNote(next)
      get().toast(`Moved to ${folder || 'the vault root'}.`, 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async duplicateNote(relPath) {
    try {
      const { relPath: copy } = await window.stone.notes.duplicate(relPath)
      await get().refreshVault()
      await get().openNote(copy)
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async toggleFavorite(relPath) {
    const settings = get().settings
    if (!settings) return
    const favorites = settings.favorites.includes(relPath)
      ? settings.favorites.filter((f) => f !== relPath)
      : [...settings.favorites, relPath]
    await get().updateSettings({ favorites })
  },

  /**
   * Write one frontmatter key on a note that may not be open.
   *
   * This is what makes a database view a place you can change things rather
   * than only read them. It goes through the same surgical frontmatter helpers
   * the properties panel uses, so dragging a card between board columns edits
   * exactly one line of YAML and leaves the rest of the file byte-identical.
   *
   * The buffer is patched too when the note happens to be open, since the file
   * watcher would otherwise land an "external change" on a note the user is
   * looking at, and discard nothing but confuse everyone.
   */
  async setNoteProperty(relPath, key, value) {
    try {
      const open = get().docs[relPath]
      const content = open?.content ?? (await window.stone.notes.get(relPath))?.content
      if (content === undefined) throw new Error('That note is no longer in the vault.')

      const next = setFrontmatterKey(content, key, value)
      if (next === content) return

      const result = await window.stone.notes.save(relPath, next, open?.hash ?? undefined)
      if (open) {
        set((state) => ({
          docs: {
            ...state.docs,
            [relPath]: { ...state.docs[relPath], content: next, hash: result.hash, dirty: false }
          }
        }))
      }
      // Optimistic, so a dragged card lands in its new column on the same frame
      // rather than after the watcher has caught up.
      set((state) => ({
        notes: state.notes.map((n) =>
          n.relPath === relPath
            ? { ...n, frontmatter: { ...n.frontmatter, [key]: value ?? undefined } }
            : n
        )
      }))
      await get().refreshVault()
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // ------------------------------------------------------------- daily note

  async openDaily(date) {
    const day = date ?? toISODate(new Date())
    try {
      const { relPath } = await window.stone.notes.daily(day)
      await get().refreshVault()
      await get().openNote(relPath)
      set({ selectedDay: day })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async openPeriodic(kind, date) {
    const day = date ?? toISODate(new Date())
    try {
      const { relPath } = await window.stone.notes.periodic(kind, day)
      await get().refreshVault()
      await get().openNote(relPath)
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async loadDaily(date) {
    if (get().dailyRelPath && get().dailyDirty) await get().saveDaily()
    try {
      const { relPath } = await window.stone.notes.daily(date)
      const note = await window.stone.notes.get(relPath)
      if (!note) return
      set({
        dailyRelPath: relPath,
        dailyContent: note.content,
        dailyHash: await window.stone.notes.hash(relPath),
        dailyDirty: false
      })
      // The note may be brand new, so the sidebar and index need to know.
      if (!get().notes.some((n) => n.relPath === relPath)) await get().refreshVault()
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  setDailyDraft(content) {
    set({ dailyContent: content, dailyDirty: true })
    if (dailyTimer) clearTimeout(dailyTimer)
    dailyTimer = setTimeout(() => void get().saveDaily(), 900)
  },

  async saveDaily() {
    const { dailyRelPath, dailyContent, dailyHash } = get()
    if (!dailyRelPath) return
    if (dailyTimer) {
      clearTimeout(dailyTimer)
      dailyTimer = null
    }
    try {
      const result = await window.stone.notes.save(
        dailyRelPath,
        dailyContent,
        dailyHash ?? undefined
      )
      set({ dailyDirty: false, dailyHash: result.hash })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // ------------------------------------------------------------------ tasks

  async toggleTask(task, status) {
    const next: TaskStatus = status ?? (task.status === 'done' ? 'todo' : 'done')
    // Optimistic: the checkbox must feel instant even though a file write follows.
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, status: next } : t))
    }))
    try {
      const result = await window.stone.tasks.setStatus(task.relPath, task.line, next)
      if (result?.repeated) get().toast('Repeated — the next one is scheduled.', 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
      await get().refreshVault()
    }
  },

  async quickAddTask(input) {
    try {
      await window.stone.tasks.quickAdd(input)
      await get().refreshVault()
      get().toast('Task added to today.', 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // --------------------------------------------------------------- calendar

  async loadCalendar(force) {
    const { anchor, loadedRange } = get()
    const window_ = monthWindow(anchor)
    if (!force && loadedRange && loadedRange.from === window_.from && loadedRange.to === window_.to) {
      return
    }
    set({ calendarLoading: true })
    try {
      if (force) await window.stone.calendar.refresh()
      const { events, errors } = await window.stone.calendar.events(window_.from, window_.to)
      set({ events, calendarErrors: errors, loadedRange: window_ })
    } catch (err) {
      set({ calendarErrors: [(err as Error).message] })
    } finally {
      set({ calendarLoading: false })
    }
  },

  setAnchor(date) {
    set({ anchor: date })
    void get().loadCalendar()
  },

  setSelectedDay(date) {
    set({ selectedDay: date, anchor: date })
    void get().loadCalendar()
  },

  setCalendarMode(calendarMode) {
    set({ calendarMode })
  },

  async refreshAccounts() {
    try {
      const { accounts, errors } = await window.stone.calendar.accounts()
      set({ accounts, calendarErrors: errors })
    } catch (err) {
      set({ calendarErrors: [(err as Error).message] })
    }
  },

  // ----------------------------------------------------------------- search

  async runSearch(query, options) {
    const merged = { ...get().searchOptions, ...options }
    set({ searchQuery: query, searchOptions: merged, searching: true })
    if (!query.trim()) {
      set({ searchHits: [], searching: false })
      return
    }
    try {
      const hits = await window.stone.search.query(query, { ...merged, limit: 200 })
      // A slower query that resolves after a newer one must not overwrite it.
      if (get().searchQuery === query) set({ searchHits: hits })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ searching: false })
    }
  },

  setSearchOptions(patch) {
    const options = { ...get().searchOptions, ...patch }
    set({ searchOptions: options })
    void get().runSearch(get().searchQuery, options)
  },

  async replaceAll(replacement) {
    const { searchQuery, searchOptions } = get()
    if (!searchQuery.trim()) return
    try {
      const result = await window.stone.search.replaceAll(searchQuery, replacement, searchOptions)
      get().toast(
        `${result.replacements} replacement${result.replacements === 1 ? '' : 's'} across ${result.notes} note${result.notes === 1 ? '' : 's'}.`,
        'success'
      )
      await get().refreshVault()
      await get().runSearch(searchQuery)
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // ------------------------------------------------------------------ trash

  async loadTrash() {
    try {
      set({ trash: await window.stone.trash.list() })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async restoreFromTrash(relPath) {
    try {
      const { relPath: restored } = await window.stone.trash.restore(relPath)
      await get().refreshVault()
      await get().loadTrash()
      get().toast(`Restored to ${restored}.`, 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async emptyTrash() {
    try {
      const removed = await window.stone.trash.empty()
      await get().loadTrash()
      get().toast(`${removed} note${removed === 1 ? '' : 's'} deleted for good.`, 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // --------------------------------------------------------------- comments

  async loadComments() {
    const relPath = get().activeRelPath
    if (!relPath) {
      set({ comments: [] })
      return
    }
    try {
      set({ comments: await window.stone.comments.list(relPath) })
    } catch {
      set({ comments: [] })
    }
  },

  async addComment(anchor, body) {
    const relPath = get().activeRelPath
    if (!relPath || !body.trim()) return
    try {
      await window.stone.comments.add(relPath, anchor, body)
      await get().loadComments()
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async updateComment(id, patch) {
    try {
      await window.stone.comments.update(id, patch)
      await get().loadComments()
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async removeComment(id) {
    try {
      await window.stone.comments.remove(id)
      await get().loadComments()
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // -------------------------------------------------------------- snapshots

  async loadSnapshots() {
    const relPath = get().activeRelPath
    if (!relPath) {
      set({ snapshots: [] })
      return
    }
    try {
      set({ snapshots: await window.stone.snapshots.list(relPath) })
    } catch {
      set({ snapshots: [] })
    }
  },

  async restoreSnapshot(id) {
    const relPath = get().activeRelPath
    if (!relPath) return
    try {
      await window.stone.snapshots.restore(relPath, id)
      await get().openNote(relPath)
      await get().loadSnapshots()
      get().toast('Earlier version restored.', 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  // ----------------------------------------------------------- saved views

  async saveView(view) {
    const settings = get().settings
    if (!settings) return
    const exists = settings.savedViews.some((v) => v.id === view.id)
    const savedViews = exists
      ? settings.savedViews.map((v) => (v.id === view.id ? view : v))
      : [...settings.savedViews, view]
    await get().updateSettings({ savedViews })
    set({ activeViewId: view.id })
  },

  async deleteView(id) {
    const settings = get().settings
    if (!settings) return
    await get().updateSettings({ savedViews: settings.savedViews.filter((v) => v.id !== id) })
    if (get().activeViewId === id) set({ activeViewId: null })
  },

  setActiveView(activeViewId) {
    set({ activeViewId })
  },

  // --------------------------------------------------------------- settings

  async updateSettings(patch) {
    const settings = await window.stone.settings.set(patch)
    if (patch.theme) {
      document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
    }
    if (patch.vimMode !== undefined) {
      document.documentElement.dataset.vim = settings.vimMode ? 'on' : 'off'
    }
    set({ settings })
    if (patch.cssSnippets) void get().applyCssSnippets()
    if (patch.activeTheme !== undefined || patch.themeFolder) void get().applyTheme()
  },

  /**
   * The active theme, in its own style element ahead of the snippets one.
   *
   * Order is the whole mechanism here: two stylesheets of equal specificity are
   * resolved by which came last, so putting the theme first is what lets a
   * snippet adjust a theme rather than fight it.
   */
  async applyTheme() {
    let style = document.getElementById('stone-theme') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'stone-theme'
      const snippets = document.getElementById('stone-snippets')
      if (snippets) document.head.insertBefore(style, snippets)
      else document.head.appendChild(style)
    }
    try {
      style.textContent = await window.stone.vault.themeCss()
    } catch {
      style.textContent = ''
    }
  },

  /**
   * User CSS lives in the vault and is injected into a single style element, so
   * a snippet can restyle anything the app renders without a build step.
   */
  async applyCssSnippets() {
    let style = document.getElementById('stone-snippets') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'stone-snippets'
      document.head.appendChild(style)
    }
    try {
      const snippets = await window.stone.vault.cssSnippets()
      style.textContent = snippets
        .map((s) => `/* ${s.name} */\n${s.css}`)
        .join('\n\n')
    } catch {
      style.textContent = ''
    }
  },

  textRequest: null,

  askText(request) {
    // A second ask while one is open would strand the first promise, so the
    // one already on screen is dismissed rather than replaced silently.
    const open = get().textRequest
    if (open) open.resolve(null)

    return new Promise<string | null>((resolve) => {
      set({ textRequest: { ...request, resolve } })
    })
  },

  resolveText(value) {
    const open = get().textRequest
    if (!open) return
    set({ textRequest: null })
    open.resolve(value)
  },

  setPalette(paletteOpen) {
    set({ paletteOpen })
  },
  setSettingsOpen(settingsOpen) {
    set({ settingsOpen })
  },
  setQuickAdd(quickAddOpen, seed) {
    set({ quickAddOpen, quickAddSeed: quickAddOpen ? (seed ?? '') : '' })
  },
  setClaude(claudeOpen, seed) {
    // Pressing the chord again while it is open must not reseed the field and
    // throw away a half-typed prompt.
    if (claudeOpen && get().claudeOpen) return
    set({ claudeOpen, claudeSeed: claudeOpen ? (seed ?? '') : '' })
  },
  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }))
  },
  toggleAgenda() {
    set((s) => ({ agendaOpen: !s.agendaOpen }))
  },
  setSidePanel(sidePanel) {
    set({ sidePanel, panelOpen: true })
    if (sidePanel === 'comments') void get().loadComments()
    if (sidePanel === 'history') void get().loadSnapshots()
    if (sidePanel === 'localgraph') void get().loadLocalGraph()
  },
  togglePanel() {
    set((s) => ({ panelOpen: !s.panelOpen }))
  },

  // ---------------------------------------------------------------- audio

  async startRecording() {
    if (get().recording) return
    const state = get()
    const note = state.activeRelPath
    const settings = state.settings

    try {
      const label = note ? note.split('/').pop()!.replace(/\.md$/, '') : 'Recording'
      const started = await recorder.start(label)
      const target = stampTarget(started.relPath, settings?.attachmentsFolder ?? 'Attachments')

      set({
        recording: {
          id: started.id,
          relPath: started.relPath,
          note,
          target,
          startedAt: Date.now(),
          pausedAt: null,
          pausedMs: 0
        }
      })

      // The embed goes in straight away rather than at the end. It is how the
      // note says "this is being recorded", it gives the stamps below it
      // something to hang from, and it means an app killed mid-lecture still
      // leaves a note that points at the audio it did capture.
      const name = started.relPath.split('/').pop() ?? started.relPath
      insertBlock(`![[${name}]]`)

      void get().openPlayer(started.relPath, note)
      get().toast('Recording. Everything you type from here is stamped.', 'success')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    }
  },

  async stopRecording() {
    const recording = get().recording
    if (!recording) return
    set({ recording: null })

    let done: { relPath: string; bytes: number }
    try {
      done = await recorder.stop()
    } catch (err) {
      get().toast(`The recording ended badly: ${(err as Error).message}`, 'error')
      return
    }

    // A stamp on a line that never got any words is bookkeeping the reader did
    // not ask for. They only exist where someone pressed Enter and thought
    // better of it, so they go on the way out rather than being prevented —
    // preventing them would mean not stamping a line until it had content, and
    // then the stamp would be the time the sentence *ended*.
    //
    // The stamp goes, not the line. A blank line between two paragraphs is what
    // keeps them two paragraphs, and deleting it would silently run them
    // together the moment the recording stopped.
    if (recording.note) {
      const doc = get().docs[recording.note]
      if (doc) {
        const cleaned = doc.content
          .split('\n')
          .map((line) => {
            const at = stampInsertPoint(line)
            const stamp = readStamp(line.slice(at))
            if (!stamp) return line
            const rest = line.slice(at + stamp.length)
            return rest.trim() === '' ? line.slice(0, at) + rest : line
          })
          .join('\n')
        if (cleaned !== doc.content) get().setDoc(recording.note, cleaned)
      }
    }

    if (done.bytes === 0) {
      get().toast('Nothing was captured — check the microphone in System Settings.', 'error')
      return
    }

    void get().openPlayer(done.relPath, recording.note)

    if (get().settings?.audioTranscribeOnStop) void get().transcribe(done.relPath)
    else get().toast('Recording saved.', 'success')
  },

  async discardRecording() {
    const recording = get().recording
    if (!recording) return
    set({ recording: null })
    await recorder.discard()

    if (get().playback?.audio === recording.relPath) get().closePlayer()

    // Take the embed back out too, or the note is left pointing at a file that
    // no longer exists.
    const doc = recording.note ? get().docs[recording.note] : null
    if (recording.note && doc) {
      const name = recording.relPath.split('/').pop() ?? ''
      const cleaned = doc.content
        .split('\n')
        .filter((line) => line.trim() !== `![[${name}]]`)
        .join('\n')
      if (cleaned !== doc.content) get().setDoc(recording.note, cleaned)
    }
    get().toast('Recording discarded.', 'info')
  },

  toggleRecordingPause() {
    const recording = get().recording
    if (!recording) return
    if (recording.pausedAt === null) {
      recorder.pause()
      set({ recording: { ...recording, pausedAt: Date.now() } })
    } else {
      recorder.resume()
      set({
        recording: {
          ...recording,
          pausedMs: recording.pausedMs + (Date.now() - recording.pausedAt),
          pausedAt: null
        }
      })
    }
  },

  async openPlayer(audio, note, opts) {
    const current = get().playback
    set({
      playback: {
        audio,
        note: note ?? get().activeRelPath,
        playing: false,
        // Whether to start on load. A stamp or a play button means "now"; the
        // player opening because a recording just stopped does not.
        autoplay: opts?.play ?? false,
        // Where the element should land once it has loaded. A player that has
        // not mounted yet cannot be seeked, so the wanted position travels as
        // state and the element catches up to it.
        time: opts?.at ?? 0,
        // Kept across a reopen of the same file so the scrubber does not jump
        // to zero width while the element works the duration out again.
        duration: current?.audio === audio ? current.duration : 0,
        rate: current?.rate ?? 1
      }
    })
    const known = await window.stone.audio.duration(audio).catch(() => null)
    if (known && get().playback?.audio === audio) {
      set((s) => (s.playback ? { playback: { ...s.playback, duration: known } } : s))
    }
    void get().loadTranscript(audio)
  },

  closePlayer() {
    set({ playback: null })
  },

  setPlayback(patch) {
    set((s) => (s.playback ? { playback: { ...s.playback, ...patch } } : s))
  },

  async transcribe(audio) {
    if (get().transcribing) {
      get().toast('One transcription at a time — this one is still running.', 'error')
      return
    }

    const status = await window.stone.audio.whisperStatus().catch(() => null)
    if (!status?.available) {
      get().toast(
        'No Whisper command was found. Install one — `brew install whisper-cpp` — then check Settings → Audio.',
        'error'
      )
      return
    }

    const id = crypto.randomUUID()
    set({ transcribing: { id, audio, stage: 'Decoding', progress: 0, segments: [] } })

    try {
      // Decoding is the renderer's half: Chromium already has the Opus decoder
      // and the resampler, and main would need ffmpeg to do the same job.
      const duration = await decode.streamPcm(id, audio, (fraction) => {
        if (get().transcribing?.id !== id) return
        set((s) =>
          s.transcribing ? { transcribing: { ...s.transcribing, progress: fraction } } : s
        )
      })

      if (get().transcribing?.id !== id) return
      set((s) =>
        s.transcribing
          ? { transcribing: { ...s.transcribing, stage: 'Transcribing', progress: null } }
          : s
      )
      // Now the length is known for certain, which the WebM header never said.
      set((s) =>
        s.playback?.audio === audio ? { playback: { ...s.playback, duration } } : s
      )

      const transcript = await window.stone.audio.transcribe({
        id,
        audio,
        durationSeconds: duration
      })

      set((s) => ({
        transcribing: s.transcribing?.id === id ? null : s.transcribing,
        transcripts: { ...s.transcripts, [audio]: transcript }
      }))
      get().toast(`Transcribed — ${transcript.segments.length} segments.`, 'success')
      if (get().sidePanel !== 'transcript') get().setSidePanel('transcript')
    } catch (err) {
      const message = (err as Error).message
      set((s) => (s.transcribing?.id === id ? { transcribing: null } : s))
      if (message !== 'cancelled') get().toast(message, 'error')
    }
  },

  cancelTranscribe() {
    const running = get().transcribing
    if (!running) return
    void window.stone.audio.cancelTranscribe(running.id)
    void window.stone.audio.discardPcm(running.id).catch(() => undefined)
    set({ transcribing: null })
  },

  async loadTranscript(audio) {
    const cached = get().transcripts[audio]
    if (cached !== undefined) return cached
    const transcript = await window.stone.audio.transcript(audio).catch(() => null)
    set((s) => ({ transcripts: { ...s.transcripts, [audio]: transcript } }))
    return transcript
  }
}))

/** Load a note into the doc map without touching pane history. */
async function hydrate(
  relPath: string,
  set: (partial: Partial<StoneState>) => void,
  get: () => StoneState
): Promise<void> {
  // Navigating back onto a document needs no buffer; the viewer reads the file.
  if (isDocTarget(relPath)) return
  const note = await window.stone.notes.get(relPath)
  if (!note) return
  const hash = await window.stone.notes.hash(relPath)
  const state = get()
  set({
    docs: {
      ...state.docs,
      [relPath]: {
        content: note.content,
        hash,
        dirty: state.docs[relPath]?.dirty ?? false,
        revealLine: null
      }
    }
  })
  const [backlinks, mentions] = await Promise.all([
    window.stone.notes.backlinks(relPath),
    window.stone.notes.mentions(relPath).catch(() => [] as Mention[])
  ])
  set({ backlinks, mentions })
}

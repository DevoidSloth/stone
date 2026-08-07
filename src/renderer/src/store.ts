import { create } from 'zustand'
import type {
  CalEvent,
  CalendarAccount,
  Comment,
  GraphData,
  Mention,
  NoteMeta,
  PropertyDef,
  SavedView,
  SearchHit,
  SearchOptions,
  Settings,
  Snapshot,
  Task,
  TaskStatus,
  TrashEntry,
  VaultStats
} from '@shared/types'
import { toISODate } from '@shared/task-syntax'

export type View = 'today' | 'notes' | 'calendar' | 'tasks' | 'graph' | 'search' | 'trash' | 'views'
export type CalendarMode = 'month' | 'week' | 'agenda'
export type SidePanel = 'backlinks' | 'outline' | 'properties' | 'comments' | 'localgraph' | 'history'

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
}

/** An open buffer. Panes share these, so the same note split twice stays in step. */
export interface Doc {
  content: string
  hash: string | null
  dirty: boolean
  /** Line the editor should reveal once, from a `[[Note#Heading]]` jump. */
  revealLine: number | null
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
  templates: NoteMeta[]
  activity: Record<string, number>
  graph: GraphData | null
  localGraph: GraphData | null

  panes: Pane[]
  activePane: number
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
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean

  setDoc: (relPath: string, content: string) => void
  saveDoc: (relPath: string) => Promise<void>
  consumeReveal: (relPath: string) => void

  createNote: (title: string, folder?: string) => Promise<void>
  createFromTemplate: (title: string, templateRelPath: string) => Promise<void>
  deleteNote: (relPath: string) => Promise<void>
  renameNote: (relPath: string, title: string) => Promise<void>
  moveNote: (relPath: string, folder: string) => Promise<void>
  duplicateNote: (relPath: string) => Promise<void>
  toggleFavorite: (relPath: string) => Promise<void>

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
  setPalette: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setQuickAdd: (open: boolean) => void
  toggleSidebar: () => void
  toggleAgenda: () => void
  setSidePanel: (panel: SidePanel) => void
  togglePanel: () => void
}

let toastSeq = 0
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
let dailyTimer: ReturnType<typeof setTimeout> | null = null

function makeTab(relPath: string): Tab {
  return { id: nextId('tab'), relPath, history: [relPath], index: 0 }
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
  templates: [],
  activity: {},
  graph: null,
  localGraph: null,

  panes: [{ id: nextId('pane'), tabs: [], active: 0 }],
  activePane: 0,
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
      void get().applyCssSnippets()
    }
    set({ ready: true })

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
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 8000 : 3600)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  async refreshVault() {
    const [notes, tasks, stats, tags, activity, folders, properties, templates] = await Promise.all([
      window.stone.notes.list(),
      window.stone.tasks.all(),
      window.stone.vault.stats(),
      window.stone.vault.tags(),
      window.stone.vault.activity(),
      window.stone.folders.list().catch(() => [] as string[]),
      window.stone.vault.properties().catch(() => [] as PropertyDef[]),
      window.stone.templates.list().catch(() => [] as NoteMeta[])
    ])
    set({ notes, tasks, stats, tags, activity, folders, properties, templates })

    // Only the graph screen pays for rebuilding the graph on every file change.
    if (get().view === 'graph') void get().loadGraph()

    const active = get().activeRelPath
    if (active) {
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
        view: state.view === 'today' ? 'today' : 'notes',
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

    // Opening a page from anywhere other than Today is a request to read it.
    if (get().view !== 'today') set({ view: 'notes' })

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
      // Fall through to creating the note.
    }
    const name = target.split(/[#^]/)[0].trim()
    if (!name) return
    get().toast(`Creating "${name}".`, 'info')
    await get().createNote(name)
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

      // An empty pane other than the first is closed outright; keeping an empty
      // split on screen is only ever an accident.
      const pruned = panes.filter((pane, index) => index === 0 || pane.tabs.length > 0)
      const activePane = Math.min(state.activePane, pruned.length - 1)
      const pane = pruned[activePane]
      return {
        panes: pruned,
        activePane,
        activeRelPath: pane?.tabs[pane.active]?.relPath ?? null
      }
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
    const relPath = get().activeRelPath
    if (relPath) void get().openNote(relPath)
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
      if (state.panes.length >= 3) return state
      const current = state.panes[state.activePane]
      const tab = current?.tabs[current.active]
      const pane: Pane = {
        id: nextId('pane'),
        tabs: tab ? [makeTab(tab.relPath)] : [],
        active: 0
      }
      return { panes: [...state.panes, pane], activePane: state.panes.length }
    })
  },

  closePane(paneIndex) {
    set((state) => {
      if (state.panes.length === 1) return state
      const panes = state.panes.filter((_, index) => index !== paneIndex)
      const activePane = Math.min(state.activePane, panes.length - 1)
      const pane = panes[activePane]
      return { panes, activePane, activeRelPath: pane?.tabs[pane.active]?.relPath ?? null }
    })
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

  async createNote(title, folder) {
    const settings = get().settings
    const target = folder ?? settings?.inboxFolder ?? 'Notes'
    try {
      // Empty body: the filename is the title, so an H1 would just duplicate it.
      const { relPath } = await window.stone.notes.create(target, title, '')
      await get().refreshVault()
      await get().openNote(relPath)
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

  async deleteNote(relPath) {
    await window.stone.notes.remove(relPath)
    set((state) => {
      const docs = { ...state.docs }
      delete docs[relPath]
      const panes = state.panes.map((pane) => {
        const tabs = pane.tabs.filter((t) => t.relPath !== relPath)
        return { ...pane, tabs, active: Math.max(0, Math.min(pane.active, tabs.length - 1)) }
      })
      const pane = panes[Math.min(state.activePane, panes.length - 1)]
      return { docs, panes, activeRelPath: pane?.tabs[pane.active]?.relPath ?? null }
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

  setPalette(paletteOpen) {
    set({ paletteOpen })
  },
  setSettingsOpen(settingsOpen) {
    set({ settingsOpen })
  },
  setQuickAdd(quickAddOpen) {
    set({ quickAddOpen })
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
  }
}))

/** Load a note into the doc map without touching pane history. */
async function hydrate(
  relPath: string,
  set: (partial: Partial<StoneState>) => void,
  get: () => StoneState
): Promise<void> {
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

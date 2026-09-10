import { contextBridge, ipcRenderer } from 'electron'
import type {
  CalEvent,
  CanvasData,
  CanvasFile,
  CaptureAction,
  LibraryDoc,
  LibraryFolder,
  LoadedPlugin,
  PluginCommand,
  CalendarAccount,
  ClaudeActivity,
  ClaudeMode,
  ClaudeRunResult,
  ClaudeStatus,
  Transcript,
  TranscribeProgress,
  WhisperStatus,
  Backup,
  CloudTarget,
  CodeRunResult,
  CodeRunPhase,
  CodeSessionInfo,
  Comment,
  GraphData,
  Mention,
  Note,
  NoteMeta,
  Priority,
  PropertyDef,
  RelationEdge,
  SearchHit,
  SearchOptions,
  Settings,
  Snapshot,
  Task,
  TaskStatus,
  TrashEntry,
  ThemeInfo,
  VaultEvent,
  VaultStats
} from '@shared/types'

type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

/** Unwrap the main-process envelope: success returns data, failure throws. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}

export interface DeviceCodePrompt {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  message: string
}

export type CloudTargetWithAdvice = CloudTarget & { advice: string[] }

const api = {
  settings: {
    get: () => call<Settings>('settings:get'),
    set: (patch: Partial<Settings>) => call<Settings>('settings:set', patch)
  },

  vault: {
    cloudTargets: () => call<CloudTargetWithAdvice[]>('vault:cloudTargets'),
    choose: () => call<string | null>('vault:choose'),
    open: (vaultPath: string) => call<{ vaultPath: string; stats: VaultStats }>('vault:open', vaultPath),
    reindex: () => call<VaultStats>('vault:reindex'),
    stats: () => call<VaultStats>('vault:stats'),
    graph: () => call<GraphData>('vault:graph'),
    localGraph: (relPath: string, depth?: number) =>
      call<GraphData>('vault:localGraph', relPath, depth),
    tags: () => call<{ tag: string; count: number }[]>('vault:tags'),
    renameTag: (from: string, to: string) => call<{ notes: number }>('tags:rename', from, to),
    properties: () => call<PropertyDef[]>('vault:properties'),
    relations: () => call<RelationEdge[]>('vault:relations'),
    activity: () => call<Record<string, number>>('vault:activity'),
    revealInFolder: (relPath: string) => call<boolean>('vault:revealInFolder', relPath),
    cssSnippets: () => call<{ name: string; css: string }[]>('vault:cssSnippets'),
    pickCssSnippet: () => call<string | null>('vault:pickCssSnippet'),
    themes: () => call<ThemeInfo[]>('vault:themes'),
    themeCss: () => call<string>('vault:themeCss'),
    onEvent: (handler: (event: VaultEvent) => void) => {
      const listener = (_e: unknown, payload: VaultEvent): void => handler(payload)
      ipcRenderer.on('vault:event', listener)
      return (): void => {
        ipcRenderer.removeListener('vault:event', listener)
      }
    }
  },

  notes: {
    list: () => call<NoteMeta[]>('notes:list'),
    get: (relPath: string) => call<Note | null>('notes:get', relPath),
    hash: (relPath: string) => call<string | null>('notes:hash', relPath),
    save: (relPath: string, content: string, expectedHash?: string) =>
      call<{ hash: string }>('notes:save', relPath, content, expectedHash),
    create: (folder: string, title: string, content?: string) =>
      call<{ relPath: string }>('notes:create', folder, title, content),
    remove: (relPath: string) => call<{ ok: boolean }>('notes:delete', relPath),
    rename: (relPath: string, title: string) => call<{ relPath: string }>('notes:rename', relPath, title),
    backlinks: (relPath: string) => call<NoteMeta[]>('notes:backlinks', relPath),
    mentions: (relPath: string) => call<Mention[]>('notes:mentions', relPath),
    daily: (date: string) => call<{ relPath: string }>('notes:daily', date),
    periodic: (kind: 'week' | 'month', date: string) =>
      call<{ relPath: string }>('notes:periodic', kind, date),
    move: (relPath: string, folder: string) =>
      call<{ relPath: string }>('notes:move', relPath, folder),
    duplicate: (relPath: string) => call<{ relPath: string }>('notes:duplicate', relPath),
    resolveLink: (target: string) =>
      call<{ relPath: string; line: number | null } | null>('notes:resolveLink', target),
    replaceLine: (relPath: string, line: number, text: string) =>
      call<boolean>('notes:replaceLine', relPath, line, text)
  },

  templates: {
    list: () => call<NoteMeta[]>('templates:list'),
    create: (title: string, templateRelPath: string, folder?: string) =>
      call<{ relPath: string }>('templates:create', title, templateRelPath, folder)
  },

  folders: {
    list: () => call<string[]>('folders:list'),
    create: (relPath: string) => call<{ relPath: string }>('folders:create', relPath),
    rename: (relPath: string, name: string) =>
      call<{ relPath: string }>('folders:rename', relPath, name),
    move: (fromRel: string, toRel: string) =>
      call<{ relPath: string }>('folders:move', fromRel, toRel),
    remove: (relPath: string) => call<boolean>('folders:delete', relPath),
    /** Open the note that defines a folder, creating it if there is none yet. */
    note: (relPath: string) => call<{ relPath: string }>('folders:note', relPath)
  },

  trash: {
    list: () => call<TrashEntry[]>('trash:list'),
    restore: (relPath: string) => call<{ relPath: string }>('trash:restore', relPath),
    empty: () => call<number>('trash:empty')
  },

  snapshots: {
    list: (relPath: string) => call<Snapshot[]>('snapshots:list', relPath),
    read: (relPath: string, id: string) => call<string | null>('snapshots:read', relPath, id),
    restore: (relPath: string, id: string) =>
      call<{ hash: string }>('snapshots:restore', relPath, id)
  },

  /** Permanent, read-only copies under `.stone/backups`; these never rotate. */
  backups: {
    list: (relPath: string) => call<Backup[]>('backups:list', relPath),
    read: (relPath: string, id: string) => call<string | null>('backups:read', relPath, id),
    restore: (relPath: string, id: string) =>
      call<{ hash: string }>('backups:restore', relPath, id)
  },

  attachments: {
    save: (data: Uint8Array, name: string) =>
      call<{ relPath: string; markdown: string }>('attachments:save', data, name),
    url: (relPath: string) => call<string>('attachments:url', relPath),
    open: (relPath: string) => call<boolean>('attachments:open', relPath),
    pick: () => call<{ relPath: string; markdown: string }[]>('attachments:pick')
  },

  comments: {
    list: (relPath: string) => call<Comment[]>('comments:list', relPath),
    add: (relPath: string, anchor: string, body: string) =>
      call<Comment>('comments:add', relPath, anchor, body),
    update: (id: string, patch: { body?: string; resolved?: boolean }) =>
      call<Comment | null>('comments:update', id, patch),
    remove: (id: string) => call<boolean>('comments:remove', id)
  },

  exporter: {
    markdown: (relPath: string) => call<string | null>('export:markdown', relPath),
    html: (relPath: string) => call<string | null>('export:html', relPath),
    pdf: (relPath: string) => call<string | null>('export:pdf', relPath),
    vault: () => call<{ folder: string; count: number } | null>('export:vault'),
    reveal: (filePath: string) => call<boolean>('export:reveal', filePath)
  },

  importer: {
    run: (kind: 'notion' | 'evernote' | 'appleNotes' | 'markdown', destination: string) =>
      call<{ imported: number; skipped: number; folder: string; warnings: string[] } | null>(
        'import:run',
        kind,
        destination
      )
  },

  tasks: {
    all: () => call<Task[]>('tasks:all'),
    setStatus: (relPath: string, line: number, status: TaskStatus) =>
      call<{ repeated: boolean }>('tasks:setStatus', relPath, line, status),
    setDue: (relPath: string, line: number, due: string | null) =>
      call<boolean>('tasks:setDue', relPath, line, due),
    setPriority: (relPath: string, line: number, priority: Priority) =>
      call<boolean>('tasks:setPriority', relPath, line, priority),
    checkReminders: () => call<boolean>('tasks:checkReminders'),
    quickAdd: (input: {
      text: string
      due: string | null
      priority: Priority
      tags: string[]
      estimate: number | null
      recurrence?: string | null
    }) => call<{ relPath: string }>('tasks:quickAdd', input)
  },

  search: {
    query: (query: string, options?: SearchOptions) =>
      call<SearchHit[]>('search:query', query, options),
    replaceAll: (query: string, replacement: string, options?: SearchOptions) =>
      call<{ notes: number; replacements: number }>(
        'search:replaceAll',
        query,
        replacement,
        options
      )
  },

  calendar: {
    accounts: () => call<{ accounts: CalendarAccount[]; errors: string[] }>('cal:accounts'),
    setEnabled: (id: string, enabled: boolean) => call<CalendarAccount[]>('cal:setEnabled', id, enabled),
    events: (fromISO: string, toISO: string) =>
      call<{ events: CalEvent[]; errors: string[] }>('cal:events', fromISO, toISO),
    refresh: () => call<boolean>('cal:refresh'),
    save: (
      accountId: string,
      input: {
        id?: string
        title: string
        start: string
        end: string
        allDay: boolean
        location?: string | null
        notes?: string | null
      }
    ) => call<{ id: string; relPath: string | null }>('cal:save', accountId, input),
    remove: (id: string) => call<boolean>('cal:delete', id),
    addSubscription: (name: string, url: string, color: string) =>
      call<Settings['icsSubscriptions']>('cal:addSubscription', name, url, color),
    removeSubscription: (id: string) => call<Settings['icsSubscriptions']>('cal:removeSubscription', id),
    exportIcs: (events: CalEvent[], suggestedName: string) =>
      call<string | null>('cal:export', events, suggestedName)
  },

  microsoft: {
    status: () => call<{ connected: boolean }>('graph:status'),
    begin: (clientId: string) => call<DeviceCodePrompt>('graph:begin', clientId),
    complete: (clientId: string, deviceCode: string, interval: number, expiresIn: number) =>
      call<{ account: string }>('graph:complete', clientId, deviceCode, interval, expiresIn),
    signOut: () => call<void>('graph:signOut')
  },

  library: {
    list: () => call<LibraryDoc[]>('library:list'),
    scan: () => call<LibraryDoc[]>('library:scan'),
    search: (query: string) =>
      call<{ doc: LibraryDoc; score: number; excerpt: string }[]>('library:search', query),
    text: (id: string) => call<string>('library:text', id),
    url: (absPath: string) => call<string>('library:url', absPath),
    renderUrl: (id: string) => call<string | null>('library:renderUrl', id),
    download: (absPath: string) => call<LibraryDoc[]>('library:download', absPath),
    reveal: (absPath: string) => call<boolean>('library:reveal', absPath),
    openExternally: (absPath: string) => call<boolean>('library:open', absPath),
    addFolder: (mode: 'index' | 'copy') =>
      call<{ folder: LibraryFolder; libraryFolders: LibraryFolder[] } | null>(
        'library:addFolder',
        mode
      ),
    removeFolder: (id: string) => call<LibraryFolder[]>('library:removeFolder', id),
    onScanned: (handler: (docs: LibraryDoc[]) => void) => {
      const listener = (_e: unknown, payload: LibraryDoc[]): void => handler(payload)
      ipcRenderer.on('library:scanned', listener)
      return (): void => {
        ipcRenderer.removeListener('library:scanned', listener)
      }
    }
  },

  canvas: {
    list: () => call<CanvasFile[]>('canvas:list'),
    read: (relPath: string) => call<CanvasData>('canvas:read', relPath),
    write: (relPath: string, data: CanvasData) => call<boolean>('canvas:write', relPath, data),
    create: (folder: string, name: string) => call<{ relPath: string }>('canvas:create', folder, name),
    remove: (relPath: string) => call<boolean>('canvas:delete', relPath)
  },

  plugins: {
    list: () => call<LoadedPlugin[]>('plugins:list'),
    setEnabled: (id: string, enabled: boolean) =>
      call<LoadedPlugin[]>('plugins:setEnabled', id, enabled),
    reload: () => call<LoadedPlugin[]>('plugins:reload'),
    commands: () => call<PluginCommand[]>('plugins:commands'),
    run: (pluginId: string, commandId: string) => call<boolean>('plugins:run', pluginId, commandId),
    onCommands: (handler: (commands: PluginCommand[]) => void) => {
      const listener = (_e: unknown, payload: PluginCommand[]): void => handler(payload)
      ipcRenderer.on('plugins:commands', listener)
      return (): void => {
        ipcRenderer.removeListener('plugins:commands', listener)
      }
    }
  },

  capture: {
    setShortcut: (chord: string | null) => call<{ ok: boolean }>('capture:setShortcut', chord),
    setTray: (enabled: boolean) => call<boolean>('capture:setTray', enabled),
    /** Quick-add, open a note, and the rest, arriving from outside the window. */
    onAction: (handler: (action: CaptureAction) => void) => {
      const listener = (_e: unknown, payload: CaptureAction): void => handler(payload)
      ipcRenderer.on('stone:action', listener)
      return (): void => {
        ipcRenderer.removeListener('stone:action', listener)
      }
    }
  },

  clipper: {
    status: () =>
      call<{ running: boolean; port: number; bookmarklet: string }>('clipper:status'),
    setEnabled: (enabled: boolean) =>
      call<{ running: boolean; bookmarklet: string }>('clipper:setEnabled', enabled),
    regenerateToken: () => call<{ bookmarklet: string }>('clipper:regenerateToken')
  },

  claude: {
    status: () => call<ClaudeStatus>('claude:status'),
    run: (request: {
      id: string
      mode: ClaudeMode
      prompt: string
      context: string | null
      /** Agent mode: the session a follow-up continues. */
      sessionId?: string | null
    }) => call<ClaudeRunResult>('claude:run', request),
    cancel: (id: string) => call<boolean>('claude:cancel', id),
    /** Output so far, for the dialog's live preview. */
    onChunk: (handler: (payload: { id: string; text: string }) => void) => {
      const listener = (_e: unknown, payload: { id: string; text: string }): void => handler(payload)
      ipcRenderer.on('claude:chunk', listener)
      return (): void => {
        ipcRenderer.removeListener('claude:chunk', listener)
      }
    },
    /** Each tool the agent picks up, for the line that says what it is doing. */
    onActivity: (handler: (payload: { id: string; activity: ClaudeActivity }) => void) => {
      const listener = (_e: unknown, payload: { id: string; activity: ClaudeActivity }): void =>
        handler(payload)
      ipcRenderer.on('claude:activity', listener)
      return (): void => {
        ipcRenderer.removeListener('claude:activity', listener)
      }
    }
  },

  /**
   * Recording, decoding and transcribing.
   *
   * Both write paths are streams rather than single calls: an hour of lecture
   * is tens of megabytes as Opus and over a hundred as the PCM Whisper wants,
   * and neither should cross the bridge in one piece.
   */
  audio: {
    requestMicrophone: () => call<boolean>('audio:requestMicrophone'),
    startRecording: (label: string) =>
      call<{ id: string; relPath: string }>('audio:startRecording', label),
    appendRecording: (id: string, chunk: Uint8Array) =>
      call<number>('audio:appendRecording', id, chunk),
    finishRecording: (id: string) =>
      call<{ relPath: string; bytes: number }>('audio:finishRecording', id),
    cancelRecording: (id: string) => call<boolean>('audio:cancelRecording', id),

    openPcm: (id: string) => call<string>('audio:openPcm', id),
    writePcm: (id: string, chunk: Uint8Array) => call<void>('audio:writePcm', id, chunk),
    closePcm: (id: string) => call<string | null>('audio:closePcm', id),
    discardPcm: (id: string) => call<void>('audio:discardPcm', id),

    whisperStatus: () => call<WhisperStatus>('audio:whisperStatus'),
    transcribe: (request: { id: string; audio: string; durationSeconds: number }) =>
      call<Transcript>('audio:transcribe', request),
    cancelTranscribe: (id: string) => call<boolean>('audio:cancelTranscribe', id),

    transcript: (audioRelPath: string) => call<Transcript | null>('audio:transcript', audioRelPath),
    transcripts: () => call<Transcript[]>('audio:transcripts'),
    deleteTranscript: (audioRelPath: string) =>
      call<boolean>('audio:deleteTranscript', audioRelPath),
    duration: (audioRelPath: string) => call<number | null>('audio:duration', audioRelPath),

    /** Segments as they are decoded, so a long transcript fills in as it runs. */
    onProgress: (handler: (payload: TranscribeProgress) => void) => {
      const listener = (_e: unknown, payload: TranscribeProgress): void => handler(payload)
      ipcRenderer.on('audio:progress', listener)
      return (): void => {
        ipcRenderer.removeListener('audio:progress', listener)
      }
    }
  },

  /**
   * Running a fenced code block, and the output it prints while it runs.
   *
   * `session` asks for the note's shared session — the notebook behaviour, where
   * a block goes on from the ones above it. Main decides whether this particular
   * block can have it and says so in the result, so the renderer never has to
   * guess.
   */
  code: {
    run: (request: {
      id: string
      lang: string
      code: string
      notePath: string | null
      session: boolean
    }) => call<CodeRunResult>('code:run', request),
    cancel: (id: string) => call<boolean>('code:cancel', id),
    /** Throws a note's sessions away; the next block starts from nothing. */
    restartSession: (notePath: string, langId: string | null) =>
      call<boolean>('code:session:restart', { notePath, langId }),
    sessions: () => call<CodeSessionInfo[]>('code:sessions'),
    onSessions: (handler: (sessions: CodeSessionInfo[]) => void) => {
      const listener = (_e: unknown, payload: CodeSessionInfo[]): void => handler(payload)
      ipcRenderer.on('code:sessions', listener)
      return (): void => {
        ipcRenderer.removeListener('code:sessions', listener)
      }
    },
    /** Where a run has got to before it has printed anything. */
    onPhase: (handler: (payload: CodeRunPhase) => void) => {
      const listener = (_e: unknown, payload: CodeRunPhase): void => handler(payload)
      ipcRenderer.on('code:phase', listener)
      return (): void => {
        ipcRenderer.removeListener('code:phase', listener)
      }
    },
    onChunk: (handler: (payload: { id: string; stream: 'out' | 'err'; text: string }) => void) => {
      const listener = (
        _e: unknown,
        payload: { id: string; stream: 'out' | 'err'; text: string }
      ): void => handler(payload)
      ipcRenderer.on('code:chunk', listener)
      return (): void => {
        ipcRenderer.removeListener('code:chunk', listener)
      }
    },
    /**
     * Run a Java block and hand back the `boxes` source for the objects it
     * left behind. One shot, and slow enough to be worth a status line: it
     * compiles the block and runs it before it can draw anything.
     *
     * `prelude` is the note's earlier blocks. The drawer needs a JShell of its
     * own and so cannot join the note's session, and a block that uses what an
     * earlier one declared has to be given it back.
     */
    javaObjects: (request: { code: string; prelude: string[]; notePath: string | null }) =>
      call<string>('java:objects', request)
  },

  shell: {
    openExternal: (url: string) => call<boolean>('app:openExternal', url)
  },

  window: {
    minimize: () => call<boolean>('window:minimize'),
    toggleMaximize: () => call<boolean>('window:toggleMaximize'),
    close: () => call<boolean>('window:close'),
    isMaximized: () => call<boolean>('window:isMaximized'),
    onMaximizeChange: (handler: (maximized: boolean) => void) => {
      const listener = (_e: unknown, value: boolean): void => handler(value)
      ipcRenderer.on('window:maximized', listener)
      return (): void => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    }
  },

  updates: {
    check: () => call<unknown>('update:check'),
    state: () => call<unknown>('update:state'),
    onState: (handler: (state: unknown) => void) => {
      const listener = (_e: unknown, value: unknown): void => handler(value)
      ipcRenderer.on('update:state', listener)
      return (): void => {
        ipcRenderer.removeListener('update:state', listener)
      }
    }
  },

  menu: {
    /** The renderer's command registry, so main can build a menu from it. */
    publish: (commands: { id: string; label: string; accelerator?: string }[]) =>
      ipcRenderer.send('menu:commands', commands),
    onInvoke: (handler: (id: string) => void) => {
      const listener = (_e: unknown, id: string): void => handler(id)
      ipcRenderer.on('menu:invoke', listener)
      return (): void => {
        ipcRenderer.removeListener('menu:invoke', listener)
      }
    }
  },

  app: {
    /** Main asks for a flush before it lets the quit through. */
    onFlush: (handler: () => void | Promise<void>) => {
      const listener = (): void => {
        void Promise.resolve(handler()).finally(() => ipcRenderer.send('app:flushed'))
      }
      ipcRenderer.on('app:flush', listener)
      return (): void => {
        ipcRenderer.removeListener('app:flush', listener)
      }
    }
  },

  theme: {
    /** Fires only while the theme is `system` and the OS crosses light/dark. */
    onChange: (handler: (theme: 'dark' | 'light') => void) => {
      const listener = (_e: unknown, value: 'dark' | 'light'): void => handler(value)
      ipcRenderer.on('theme:changed', listener)
      return (): void => {
        ipcRenderer.removeListener('theme:changed', listener)
      }
    }
  },

  platform: process.platform as NodeJS.Platform
}

export type StoneApi = typeof api

/**
 * Paint the right theme on the very first frame.
 *
 * The renderer used to ship `<html data-theme="dark">` hardcoded and correct
 * itself once the store had booted, so every light-theme user watched the app
 * flash dark on launch. The usual fix — an inline script in the head — is
 * rightly forbidden by the CSP (`script-src 'self'`), and loosening it for a
 * cosmetic fix would be a bad trade. The preload runs before any page script
 * and can ask main synchronously, so it does.
 */
function applyInitialTheme(): void {
  let theme: 'dark' | 'light' = 'dark'
  try {
    theme = ipcRenderer.sendSync('theme:resolved') as 'dark' | 'light'
  } catch {
    // A failed hint is a cosmetic problem; the store corrects it on boot.
  }
  const stamp = (): void => {
    if (document.documentElement) document.documentElement.dataset.theme = theme
  }
  stamp()
  // `documentElement` is normally already there, but not guaranteed this early.
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', stamp, { once: true })
  }
}

applyInitialTheme()

contextBridge.exposeInMainWorld('stone', api)

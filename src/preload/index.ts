import { contextBridge, ipcRenderer } from 'electron'
import type {
  CalEvent,
  CalendarAccount,
  CloudTarget,
  Comment,
  GraphData,
  Mention,
  Note,
  NoteMeta,
  Priority,
  PropertyDef,
  SearchHit,
  SearchOptions,
  Settings,
  Snapshot,
  Task,
  TaskStatus,
  TrashEntry,
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
    activity: () => call<Record<string, number>>('vault:activity'),
    revealInFolder: (relPath: string) => call<boolean>('vault:revealInFolder', relPath),
    cssSnippets: () => call<{ name: string; css: string }[]>('vault:cssSnippets'),
    pickCssSnippet: () => call<string | null>('vault:pickCssSnippet'),
    onEvent: (handler: (event: VaultEvent) => void) => {
      const listener = (_e: unknown, payload: VaultEvent): void => handler(payload)
      ipcRenderer.on('vault:event', listener)
      return () => ipcRenderer.removeListener('vault:event', listener)
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
    remove: (relPath: string) => call<boolean>('folders:delete', relPath)
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

  attachments: {
    save: (data: Uint8Array, name: string) =>
      call<{ relPath: string; markdown: string }>('attachments:save', data, name),
    url: (relPath: string) => call<string>('attachments:url', relPath),
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
      return () => ipcRenderer.removeListener('window:maximized', listener)
    }
  },

  platform: process.platform as NodeJS.Platform
}

export type StoneApi = typeof api

contextBridge.exposeInMainWorld('stone', api)

import { BrowserWindow, dialog, ipcMain, nativeTheme, shell, app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CalEvent,
  CalendarAccount,
  Priority,
  SearchOptions,
  Settings,
  TaskStatus
} from '@shared/types'
import {
  buildTaskLine,
  rollRecurrence,
  setDueOnLine,
  setPriorityOnLine,
  setStatusOnLine,
  toISODate
} from '@shared/task-syntax'
import { Vault } from './vault/store'
import { CalendarService } from './calendar/service'
import { buildIcs } from './calendar/ics'
import * as graph from './calendar/graph'
import { detectCloudTargets, syncAdvice } from './cloud'
import { applyThemeChrome } from './window-chrome'
import { loadSettings, saveSettings } from './settings'
import { readNote, toAbsPath } from './vault/fs'
import { exportHtml, exportMarkdown, exportPdf, exportVault, revealExport } from './export'
import { runImport, type ImportKind } from './import'
import { addComment, listComments, removeComment, updateComment } from './comments'
import { checkReminders, startReminders, stopReminders } from './notify'
import { toProtocolUrl } from './protocol'

export const vault = new Vault()
const calendar = new CalendarService(vault)

/** Reads the calendar over the next day, for the reminder scheduler. */
async function upcomingEvents(): Promise<CalEvent[]> {
  const settings = await loadSettings()
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 36 * 60 * 60 * 1000)
  const { events } = await calendar.eventsInRange(
    settings,
    toISODate(now),
    toISODate(tomorrow)
  )
  return events
}

/** Every handler returns `{ ok, data }` or `{ ok: false, error }` so the renderer never sees a raw throw. */
type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...(args as never[])) } satisfies Reply<T>
    } catch (err) {
      return { ok: false, error: (err as Error).message } satisfies Reply<T>
    }
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Load a template note's body, or null when none is configured or readable. */
async function readTemplate(relPath: string | null): Promise<string | null> {
  if (!relPath || !vault.vaultPath) return null
  try {
    return await readNote(toAbsPath(vault.vaultPath, relPath))
  } catch {
    return null
  }
}

export function registerIpc(): void {
  vault.on('vault-event', (event) => broadcast('vault:event', event))

  void loadSettings().then((settings) => {
    vault.snapshotsEnabled = settings.snapshotsEnabled
    startReminders(
      { tasks: () => vault.allTasks(), events: upcomingEvents },
      () => ({
        enabled: settings.remindersEnabled,
        leadMinutes: settings.reminderLeadMinutes
      }),
      (payload) => broadcast('vault:event', { type: 'reminder', ...payload })
    )
  })

  // ------------------------------------------------------------- settings

  handle('settings:get', () => loadSettings())
  handle('settings:set', async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch)
    if (patch.snapshotsEnabled !== undefined) vault.snapshotsEnabled = patch.snapshotsEnabled
    if (patch.remindersEnabled !== undefined || patch.reminderLeadMinutes !== undefined) {
      stopReminders()
      startReminders(
        { tasks: () => vault.allTasks(), events: upcomingEvents },
        () => ({ enabled: next.remindersEnabled, leadMinutes: next.reminderLeadMinutes }),
        (payload) => broadcast('vault:event', { type: 'reminder', ...payload })
      )
    }
    if (patch.theme) {
      nativeTheme.themeSource = patch.theme === 'system' ? 'system' : patch.theme
      // The system draws the caption buttons, so the renderer cannot restyle
      // them — main has to repaint the overlay whenever the theme flips.
      const resolved =
        patch.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : patch.theme
      applyThemeChrome(resolved)
    }
    return next
  })

  // ---------------------------------------------------------------- vault

  handle('vault:cloudTargets', async () => {
    const targets = await detectCloudTargets()
    return targets.map((t) => ({ ...t, advice: syncAdvice(t) }))
  })

  handle('vault:choose', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Choose a folder for your vault',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Use this folder'
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('vault:open', async (vaultPath: string) => {
    await vault.open(vaultPath)
    await saveSettings({ vaultPath, firstRunComplete: true })
    return { vaultPath, stats: vault.stats() }
  })

  handle('vault:reindex', async () => {
    await vault.reindex()
    return vault.stats()
  })

  handle('vault:stats', () => vault.stats())
  handle('vault:graph', () => vault.graph())
  handle('vault:localGraph', (relPath: string, depth?: number) =>
    vault.localGraph(relPath, depth ?? 1)
  )
  handle('vault:tags', () => vault.tagCounts())
  handle('vault:activity', () => vault.activityByDay())

  handle('vault:revealInFolder', (relPath: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    shell.showItemInFolder(toAbsPath(vault.vaultPath, relPath))
    return true
  })

  // ---------------------------------------------------------------- notes

  handle('notes:list', () => vault.listNotes())
  handle('notes:get', (relPath: string) => vault.getNote(relPath))
  handle('notes:hash', (relPath: string) => vault.getHash(relPath))

  handle('notes:save', async (relPath: string, content: string, expectedHash?: string) => {
    const result = await vault.saveNote(relPath, content, expectedHash)
    if (!result.ok) throw new Error(result.error)
    return { hash: result.hash }
  })

  handle('notes:create', async (folder: string, title: string, content?: string) => {
    const result = await vault.createNote(folder, title, content)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('notes:delete', (relPath: string) => vault.deleteNote(relPath))

  handle('notes:rename', async (relPath: string, title: string) => {
    const result = await vault.renameNote(relPath, title)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('notes:backlinks', (relPath: string) => vault.backlinks(relPath))
  handle('notes:mentions', (relPath: string) => vault.unlinkedMentions(relPath))

  handle('notes:daily', async (date: string) => {
    const settings = await loadSettings()
    const template = await readTemplate(settings.dailyTemplate)
    const result = await vault.dailyNote(date, settings.dailyFolder, template ?? undefined)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('notes:periodic', async (kind: 'week' | 'month', date: string) => {
    const settings = await loadSettings()
    const folder = kind === 'week' ? settings.weeklyFolder : settings.monthlyFolder
    const result = await vault.periodicNote(kind, date, folder)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('notes:move', async (relPath: string, folder: string) => {
    const result = await vault.moveNote(relPath, folder)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('notes:duplicate', async (relPath: string) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    const result = await vault.createNote(folder, `${note.title} copy`, note.content)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  /** Where a `[[Note#Heading]]` should land once the note is open. */
  handle('notes:resolveLink', (target: string) => {
    const parts = Vault.splitTarget(target)
    const relPath = vault.resolveLink(parts.name)
    if (!relPath) return null
    return { relPath, line: vault.anchorLine(relPath, parts.heading, parts.block) }
  })

  // ------------------------------------------------------------- templates

  handle('templates:list', async () => {
    const settings = await loadSettings()
    return vault.templates(settings.templateFolder)
  })

  handle('templates:create', async (title: string, templateRelPath: string, folder?: string) => {
    const settings = await loadSettings()
    const result = await vault.createFromTemplate(
      folder ?? settings.inboxFolder,
      title,
      templateRelPath
    )
    if ('error' in result) throw new Error(result.error)
    return result
  })

  // --------------------------------------------------------------- folders

  handle('folders:list', () => vault.folders())

  handle('folders:create', async (relPath: string) => {
    const result = await vault.createFolder(relPath)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('folders:rename', async (relPath: string, name: string) => {
    const result = await vault.renameFolder(relPath, name)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('folders:move', async (fromRel: string, toRel: string) => {
    const result = await vault.movePath(fromRel, toRel)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('folders:delete', async (relPath: string) => {
    const result = await vault.deleteFolder(relPath)
    if (!result.ok) throw new Error(result.error ?? 'That folder could not be moved to the trash.')
    return true
  })

  // ----------------------------------------------------------------- trash

  handle('trash:list', () => vault.trash())

  handle('trash:restore', async (relPath: string) => {
    const settings = await loadSettings()
    const result = await vault.restore(relPath, settings.inboxFolder)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  handle('trash:empty', () => vault.emptyTrash())

  // ------------------------------------------------------------- snapshots

  handle('snapshots:list', (relPath: string) => vault.snapshots(relPath))
  handle('snapshots:read', (relPath: string, id: string) => vault.snapshot(relPath, id))

  handle('snapshots:restore', async (relPath: string, id: string) => {
    const body = await vault.snapshot(relPath, id)
    if (body === null) throw new Error('That version is no longer available.')
    const result = await vault.saveNote(relPath, body)
    if (!result.ok) throw new Error(result.error)
    return { hash: result.hash }
  })

  // ----------------------------------------------------------- attachments

  handle('attachments:save', async (data: Uint8Array, name: string) => {
    const settings = await loadSettings()
    const result = await vault.saveAttachment(settings.attachmentsFolder, data, name)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  /** Turn a vault-relative path into a URL the renderer is allowed to load. */
  handle('attachments:url', (relPath: string) => toProtocolUrl(relPath))

  handle('attachments:pick', async () => {
    const settings = await loadSettings()
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Insert a file',
      properties: ['openFile', 'multiSelections']
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled) return []

    const out: { relPath: string; markdown: string }[] = []
    for (const file of picked.filePaths) {
      const data = await fs.readFile(file)
      const saved = await vault.saveAttachment(
        settings.attachmentsFolder,
        data,
        path.basename(file)
      )
      if (!('error' in saved)) out.push(saved)
    }
    return out
  })

  // ---------------------------------------------------------- properties

  handle('vault:properties', () => vault.properties())

  handle('tags:rename', (from: string, to: string) => vault.renameTag(from, to))

  // ------------------------------------------------------------- comments

  handle('comments:list', (relPath: string) => {
    if (!vault.vaultPath) return []
    return listComments(vault.vaultPath, relPath)
  })

  handle('comments:add', (relPath: string, anchor: string, body: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return addComment(vault.vaultPath, relPath, anchor, body)
  })

  handle('comments:update', (id: string, patch: { body?: string; resolved?: boolean }) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return updateComment(vault.vaultPath, id, patch)
  })

  handle('comments:remove', (id: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return removeComment(vault.vaultPath, id)
  })

  // --------------------------------------------------------------- export

  handle('export:markdown', async (relPath: string) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    return exportMarkdown(note)
  })

  handle('export:html', async (relPath: string) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    return exportHtml(note)
  })

  handle('export:pdf', async (relPath: string) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    return exportPdf(note)
  })

  handle('export:vault', () => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return exportVault(
      vault.vaultPath,
      vault.listNotes().map((n) => ({ relPath: n.relPath, path: n.path }))
    )
  })

  handle('export:reveal', async (filePath: string) => {
    await revealExport(filePath)
    return true
  })

  handle('import:run', async (kind: ImportKind, destination: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const settings = await loadSettings()
    const result = await runImport(
      kind,
      vault.vaultPath,
      destination,
      settings.attachmentsFolder
    )
    if (result) await vault.reindex()
    return result
  })

  // --------------------------------------------------------- css snippets

  /** Read the user's CSS snippets so the renderer can inject them. */
  handle('vault:cssSnippets', async () => {
    if (!vault.vaultPath) return []
    const settings = await loadSettings()
    const out: { name: string; css: string }[] = []
    for (const relPath of settings.cssSnippets) {
      try {
        const absPath = toAbsPath(vault.vaultPath, relPath)
        // Snippets are vault files like any other, so the same guard applies.
        if (!absPath.startsWith(path.resolve(vault.vaultPath))) continue
        out.push({ name: relPath, css: await fs.readFile(absPath, 'utf8') })
      } catch {
        // A snippet that has been deleted simply stops applying.
      }
    }
    return out
  })

  handle('vault:pickCssSnippet', async () => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a CSS snippet inside the vault',
      defaultPath: vault.vaultPath,
      properties: ['openFile'],
      filters: [{ name: 'CSS', extensions: ['css'] }]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null

    const chosen = path.resolve(picked.filePaths[0])
    const root = path.resolve(vault.vaultPath)
    if (!chosen.startsWith(root + path.sep)) {
      throw new Error('CSS snippets have to live inside the vault so they sync with it.')
    }
    return path.relative(root, chosen).split(path.sep).join('/')
  })

  handle('notes:replaceLine', async (relPath: string, line: number, text: string) => {
    const result = await vault.replaceLine(relPath, line, text)
    if (!result.ok) throw new Error(result.error ?? 'Could not update that line.')
    return true
  })

  // ---------------------------------------------------------------- tasks

  handle('tasks:all', () => vault.allTasks())

  /**
   * Completing a repeating task leaves the next one behind rather than ending
   * the series — the whole point of a repeat is that it comes back.
   */
  handle('tasks:setStatus', async (relPath: string, line: number, status: TaskStatus) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    const lines = note.content.split('\n')
    if (line < 0 || line >= lines.length) throw new Error('That task has moved. Reload the note.')

    const rolled = status === 'done' ? rollRecurrence(lines[line]) : null
    if (rolled) lines.splice(line, 1, rolled.next, rolled.completed)
    else lines[line] = setStatusOnLine(lines[line], status)

    const result = await vault.saveNote(relPath, lines.join('\n'))
    if (!result.ok) throw new Error(result.error)
    return { repeated: Boolean(rolled) }
  })

  handle('tasks:setPriority', async (relPath: string, line: number, priority: Priority) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    const lines = note.content.split('\n')
    if (line < 0 || line >= lines.length) throw new Error('That task has moved. Reload the note.')
    lines[line] = setPriorityOnLine(lines[line], priority)
    const result = await vault.saveNote(relPath, lines.join('\n'))
    if (!result.ok) throw new Error(result.error)
    return true
  })

  handle('tasks:checkReminders', async () => {
    const settings = await loadSettings()
    await checkReminders(
      { tasks: () => vault.allTasks(), events: upcomingEvents },
      { enabled: settings.remindersEnabled, leadMinutes: settings.reminderLeadMinutes },
      (payload) => broadcast('vault:event', { type: 'reminder', ...payload })
    )
    return true
  })

  handle('tasks:setDue', async (relPath: string, line: number, due: string | null) => {
    const note = await vault.getNote(relPath)
    if (!note) throw new Error('That note is no longer in the vault.')
    const lines = note.content.split('\n')
    if (line < 0 || line >= lines.length) throw new Error('That task has moved. Reload the note.')
    lines[line] = setDueOnLine(lines[line], due)
    const result = await vault.saveNote(relPath, lines.join('\n'))
    if (!result.ok) throw new Error(result.error)
    return true
  })

  handle(
    'tasks:quickAdd',
    async (input: {
      text: string
      due: string | null
      priority: Priority
      tags: string[]
      estimate: number | null
      recurrence?: string | null
    }) => {
      const settings = await loadSettings()
      const line = buildTaskLine(input)
      const day = input.due ? input.due.slice(0, 10) : toISODate(new Date())
      const result = await vault.addTaskToDaily(day, settings.dailyFolder, line)
      if ('error' in result) throw new Error(result.error)
      return result
    }
  )

  // --------------------------------------------------------------- search

  handle('search:query', (query: string, options?: SearchOptions) => vault.search(query, options))

  handle('search:replaceAll', (query: string, replacement: string, options?: SearchOptions) =>
    vault.replaceAll(query, replacement, options)
  )

  // ------------------------------------------------------------- calendar

  handle('cal:accounts', async () => {
    const settings = await loadSettings()
    const result = await calendar.listAccounts(settings)
    // Persist newly-discovered calendars so their enabled state survives restarts.
    const known = new Map(settings.calendars.map((c) => [c.id, c]))
    for (const account of result.accounts) if (!known.has(account.id)) known.set(account.id, account)
    await saveSettings({ calendars: [...known.values()] })
    return result
  })

  handle('cal:setEnabled', async (id: string, enabled: boolean) => {
    const settings = await loadSettings()
    const calendars = settings.calendars.map((c) => (c.id === id ? { ...c, enabled } : c))
    await saveSettings({ calendars })
    return calendars
  })

  handle('cal:events', async (fromISO: string, toISO: string) => {
    const settings = await loadSettings()
    return calendar.eventsInRange(settings, fromISO, toISO)
  })

  handle('cal:refresh', () => {
    calendar.clearFeedCache()
    return true
  })

  handle(
    'cal:save',
    async (
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
    ) => {
      const settings = await loadSettings()

      if (accountId === 'stone') {
        const frontmatter = [
          '---',
          `date: ${input.start.slice(0, 10)}`,
          ...(input.allDay ? [] : [`start: ${input.start.slice(11, 16)}`, `end: ${input.end.slice(11, 16)}`]),
          ...(input.location ? [`location: ${input.location}`] : []),
          '---',
          '',
          `# ${input.title}`,
          '',
          input.notes ?? '',
          ''
        ].join('\n')
        const created = await vault.createNote(settings.dailyFolder, input.title, frontmatter)
        if ('error' in created) throw new Error(created.error)
        return { id: `stone:${created.relPath}`, relPath: created.relPath }
      }

      const account = settings.calendars.find((c) => c.id === accountId)
      if (!account) throw new Error('That calendar is no longer connected.')
      const id = await calendar.saveExternalEvent(account, input)
      return { id, relPath: null }
    }
  )

  handle('cal:delete', async (id: string) => {
    if (id.startsWith('stone:')) {
      await vault.deleteNote(id.slice('stone:'.length))
      return true
    }
    await calendar.removeExternalEvent(id)
    return true
  })

  handle('cal:addSubscription', async (name: string, url: string, color: string) => {
    const settings = await loadSettings()
    const id = `ics:${Buffer.from(url).toString('base64url').slice(0, 24)}`
    if (settings.icsSubscriptions.some((s) => s.id === id)) {
      throw new Error('That calendar is already subscribed.')
    }
    const icsSubscriptions = [...settings.icsSubscriptions, { id, name, url, color }]
    await saveSettings({ icsSubscriptions })
    calendar.clearFeedCache()
    return icsSubscriptions
  })

  handle('cal:removeSubscription', async (id: string) => {
    const settings = await loadSettings()
    const icsSubscriptions = settings.icsSubscriptions.filter((s) => s.id !== id)
    await saveSettings({
      icsSubscriptions,
      calendars: settings.calendars.filter((c) => c.id !== id)
    })
    calendar.clearFeedCache()
    return icsSubscriptions
  })

  handle('cal:export', async (events: CalEvent[], suggestedName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export calendar',
      defaultPath: path.join(app.getPath('downloads'), suggestedName),
      filters: [{ name: 'ICalendar', extensions: ['ics'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, buildIcs(events), 'utf8')
    return result.filePath
  })

  // ----------------------------------------------------- microsoft account

  handle('graph:status', async () => ({ connected: await graph.isConnected() }))
  handle('graph:begin', (clientId: string) => graph.beginSignIn(clientId))
  handle(
    'graph:complete',
    (clientId: string, deviceCode: string, interval: number, expiresIn: number) =>
      graph.completeSignIn(clientId, deviceCode, interval, expiresIn)
  )
  handle('graph:signOut', () => graph.signOut())

  // ------------------------------------------------------------ app shell

  handle('app:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.')
    await shell.openExternal(url)
    return true
  })

  handle('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
    return true
  })

  handle('window:toggleMaximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  handle('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
    return true
  })

  handle('window:isMaximized', () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false)
}

export function accountsFor(settings: Settings): CalendarAccount[] {
  return settings.calendars
}

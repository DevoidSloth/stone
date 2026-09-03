import { BrowserWindow, dialog, ipcMain, nativeTheme, shell, app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CalEvent,
  CalendarAccount,
  CanvasData,
  ClaudeMode,
  LibraryDoc,
  LibraryFolder,
  Priority,
  SearchOptions,
  Settings,
  TaskStatus
} from '@shared/types'
import {
  buildTaskLine,
  parseQuickAdd,
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
import { loadSettings, peekSettings, saveSettings } from './settings'
import { seedVault } from './seed'
import { readNote, toAbsPath } from './vault/fs'
import {
  configureExport,
  exportHtml,
  exportMarkdown,
  exportPdf,
  exportVault,
  revealExport
} from './export'
import { configurePrintHost } from './print'
import { runImport, type ImportKind } from './import'
import { addComment, listComments, removeComment, updateComment } from './comments'
import { checkReminders, startReminders, stopReminders } from './notify'
import { toDocumentUrl, toProtocolUrl } from './protocol'
import {
  documentText,
  downloadDocument,
  importDocument,
  listDocuments,
  loadCache,
  renderablePath,
  scanLibrary,
  searchDocuments
} from './library'
import { setCaptureShortcut, setTrayEnabled } from './capture'
import * as claude from './claude'
import * as audio from './audio'
import * as whisper from './transcribe'
import { cancelRun, runCode } from './run-code'
import {
  cancelSessionRun,
  listSessions,
  restartSession,
  runInSession,
  sessionPlan,
  watchSessions
} from './code-session'
import { listThemes, readTheme } from './themes'
import { createCanvas, deleteCanvas, listCanvases, readCanvas, writeCanvas } from './canvas'
import {
  configurePluginHost,
  discoverPlugins,
  handlePluginApi,
  pluginCommands,
  reloadPlugins,
  runPluginCommand
} from './plugins'
import {
  bookmarkletSource,
  clipperRunning,
  newToken,
  startClipper,
  stopClipper,
  type ClipperHooks
} from './clipper'

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

/**
 * What the clipper is allowed to do to the vault.
 *
 * Deliberately two narrow operations rather than a general write: the listener
 * is the least trusted thing in the process, so it gets a verb, not a path.
 */
const clipperHooks: ClipperHooks = {
  async saveClip(clip) {
    const settings = await loadSettings()
    const frontmatter = [
      '---',
      `date: ${toISODate(new Date())}`,
      ...(clip.url ? [`source: ${clip.url}`] : []),
      ...(clip.tags.length > 0 ? [`tags: [${clip.tags.join(', ')}]`] : []),
      '---',
      '',
      clip.markdown,
      ''
    ].join('\n')

    const created = await vault.createNote(settings.clipFolder, clip.title, frontmatter)
    if ('error' in created) throw new Error(created.error)
    broadcast('vault:event', { type: 'reindexed', count: 1 })
    return created.relPath
  },

  async saveTask(text) {
    const settings = await loadSettings()
    const parsed = parseQuickAdd(text)
    const line = buildTaskLine(parsed)
    const day = parsed.due ? parsed.due.slice(0, 10) : toISODate(new Date())
    const result = await vault.addTaskToDaily(day, settings.dailyFolder, line)
    if ('error' in result) throw new Error(result.error)
    broadcast('vault:event', { type: 'reindexed', count: 1 })
    return result.relPath
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

  configurePluginHost({
    readNote: async (relPath) => (await vault.getNote(relPath))?.content ?? null,
    writeNote: async (relPath, content) => {
      const result = await vault.saveNote(relPath, content)
      if (!result.ok) throw new Error(result.error)
    },
    listNotes: () => vault.listNotes().map((n) => ({ relPath: n.relPath, title: n.title })),
    notice: (message) =>
      broadcast('vault:event', { type: 'reminder', title: 'Plugin', body: message, relPath: null }),
    onCommandsChanged: (commands) => broadcast('plugins:commands', commands),
    preloadPath: path.join(__dirname, '../preload/plugin-host.js'),
    loadHost: async (win) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      if (devUrl) await win.loadURL(`${devUrl}/plugin-host.html`)
      else await win.loadFile(path.join(__dirname, '../renderer/plugin-host.html'))
    }
  })

  configurePrintHost({
    preloadPath: path.join(__dirname, '../preload/print.js'),
    loadPage: async (win) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      if (devUrl) await win.loadURL(`${devUrl}/print.html`)
      else await win.loadFile(path.join(__dirname, '../renderer/print.html'))
    }
  })

  configureExport({
    readEmbed: async (target) => {
      const relPath = vault.resolveLink(target)
      return relPath ? ((await vault.getNote(relPath))?.content ?? null) : null
    },
    vaultName: () => (vault.vaultPath ? path.basename(vault.vaultPath) : 'Stone')
  })


  void loadSettings().then(async (settings) => {
    vault.snapshotsEnabled = settings.snapshotsEnabled

    // The library is scanned in the background: extraction reads whole files,
    // and a first run over a large document folder takes long enough that
    // doing it before the window paints would look like a hang.
    if (settings.libraryFolders.length > 0) {
      await loadCache()
      void scanLibrary(settings.libraryFolders)
        .then((found) => broadcast('library:scanned', found))
        .catch(() => undefined)
    }

    // The clipper was left on, so bring it back up. A port already in use is
    // reported rather than retried — something else owns it, and silently
    // moving to another port would break the bookmarklet the user installed.
    if (settings.clipperEnabled && settings.clipperToken) {
      void startClipper(settings.clipperPort, settings.clipperToken, clipperHooks).catch(
        (err: Error) => {
          broadcast('vault:event', {
            type: 'reminder',
            title: 'Web clipper',
            body: `Could not listen on port ${settings.clipperPort}: ${err.message}`,
            relPath: null
          })
        }
      )
    }

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
    // Seed before opening, so the starter notes are in the index the first
    // scan builds rather than arriving as watcher events afterwards. Only on
    // the very first vault, and only when it is genuinely empty — an existing
    // Obsidian vault opened for the first time must never be written into.
    const before = peekSettings()
    if (!before.firstRunComplete) await seedVault(vaultPath, before.inboxFolder)

    await vault.open(vaultPath)
    const settings = await saveSettings({ vaultPath, firstRunComplete: true })
    // Plugins live inside the vault, so opening one is what makes them exist.
    // A failure here is the plugin's problem, not the vault's — it is reported
    // per plugin in the manager rather than aborting the open.
    if (settings.enabledPlugins.length > 0) {
      void reloadPlugins(vaultPath, settings.enabledPlugins).catch(() => undefined)
    }
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

  /** The folder's defining note, written the first time it is asked for. */
  handle('folders:note', async (relPath: string) => {
    const result = await vault.ensureFolderNote(relPath)
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

  /**
   * Open an embedded file in whatever app owns it.
   *
   * An embedded PDF is a figure, not a reader — sooner or later the reader
   * wants the whole document. The path is resolved and checked against the
   * vault the same way every other write is, so a crafted `../` in a note
   * cannot make Stone launch something outside it.
   */
  handle('attachments:open', async (relPath: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const absolute = toAbsPath(vault.vaultPath, relPath)
    const root = path.resolve(vault.vaultPath)
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error('That file is outside the vault.')
    }
    const failure = await shell.openPath(absolute)
    if (failure) throw new Error(failure)
    return true
  })

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
  handle('vault:relations', () => vault.relations())

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
    const settings = await loadSettings()
    return exportPdf(note, {
      pageSize: settings.pdfPageSize,
      margin: settings.pdfMargin,
      coverPage: settings.pdfCoverPage,
      toc: settings.pdfToc,
      headerFooter: settings.pdfHeaderFooter,
      author: settings.pdfAuthor
    })
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

  // -------------------------------------------------- capture and clipper

  handle('capture:setShortcut', async (chord: string | null) => {
    const ok = setCaptureShortcut(chord)
    // Store it either way: a chord another app has claimed is still the user's
    // choice, and it may well be free the next time Stone starts.
    await saveSettings({ captureShortcut: chord })
    return { ok }
  })

  handle('capture:setTray', async (enabled: boolean) => {
    setTrayEnabled(enabled)
    await saveSettings({ trayEnabled: enabled })
    return true
  })

  handle('clipper:status', async () => {
    const settings = await loadSettings()
    return {
      running: clipperRunning(),
      port: settings.clipperPort,
      bookmarklet: settings.clipperToken
        ? bookmarkletSource(settings.clipperPort, settings.clipperToken)
        : ''
    }
  })

  handle('clipper:setEnabled', async (enabled: boolean) => {
    const settings = await loadSettings()
    if (!enabled) {
      stopClipper()
      await saveSettings({ clipperEnabled: false })
      return { running: false, bookmarklet: '' }
    }
    // First time on, mint a token. Reusing an empty one would leave the
    // listener effectively open to any page that finds the port.
    const token = settings.clipperToken || newToken()
    await startClipper(settings.clipperPort, token, clipperHooks)
    await saveSettings({ clipperEnabled: true, clipperToken: token })
    return {
      running: true,
      bookmarklet: bookmarkletSource(settings.clipperPort, token)
    }
  })

  handle('clipper:regenerateToken', async () => {
    const settings = await loadSettings()
    const token = newToken()
    await saveSettings({ clipperToken: token })
    if (settings.clipperEnabled) await startClipper(settings.clipperPort, token, clipperHooks)
    return { bookmarklet: bookmarkletSource(settings.clipperPort, token) }
  })

  // ---------------------------------------------------------------- library

  handle('library:list', () => listDocuments())

  /**
   * Walk the watched folders and rebuild the index.
   *
   * Shared by the Rescan button and by adding a folder, because "the folder is
   * in settings" and "its documents are in the list" have to happen together —
   * a folder that is watched but unscanned looks to the user like nothing
   * happened at all.
   */
  const runScan = async (): Promise<LibraryDoc[]> => {
    const settings = await loadSettings()
    const found = await scanLibrary(settings.libraryFolders)

    // `copy` folders bring anything new into the vault. Done after the scan so
    // extraction has already run against the original, and the copy inherits
    // the cached result rather than being read a second time.
    if (vault.vaultPath) {
      for (const folder of settings.libraryFolders.filter((f) => f.mode === 'copy')) {
        for (const doc of found.filter((d) => d.folderId === folder.id && !d.evicted)) {
          try {
            await importDocument(vault.vaultPath, settings.attachmentsFolder, doc.path)
          } catch {
            // One document that will not copy should not stop the rest.
          }
        }
      }
    }
    return found
  }

  handle('library:scan', () => runScan())

  handle('library:search', (query: string) => searchDocuments(query))
  handle('library:text', (id: string) => documentText(id))

  handle('library:url', (absPath: string) => toDocumentUrl(absPath))

  /** The URL a viewer should load. Null when there is nothing renderable. */
  handle('library:renderUrl', async (id: string) => {
    const file = await renderablePath(id)
    return file ? toDocumentUrl(file) : null
  })

  handle('library:download', async (absPath: string) => {
    const settings = await loadSettings()
    const resolved = path.resolve(absPath)
    const inWatched = settings.libraryFolders.some((f) => {
      const root = path.resolve(f.path)
      return resolved === root || resolved.startsWith(root + path.sep)
    })
    if (!inWatched) throw new Error('That file is outside your watched folders.')

    await downloadDocument(resolved)
    return scanLibrary(settings.libraryFolders)
  })

  /**
   * Both of these hand a path to the operating system, and the path can come
   * from note content — a `[link](file://…)` anyone could have written or
   * synced in. So neither trusts its argument: a path is only opened when it
   * sits inside a folder the user added to the library, or inside the vault.
   * Without this, a crafted link is an instruction to launch anything on disk.
   */
  const assertOpenable = async (absPath: string): Promise<string> => {
    const settings = await loadSettings()
    const resolved = path.resolve(absPath)
    const roots = [
      ...settings.libraryFolders.map((f) => f.path),
      ...(vault.vaultPath ? [vault.vaultPath] : [])
    ]
    const allowed = roots.some((root) => {
      const resolvedRoot = path.resolve(root)
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
    })
    if (!allowed) throw new Error('That file is outside your vault and watched folders.')
    return resolved
  }

  handle('library:reveal', async (absPath: string) => {
    shell.showItemInFolder(await assertOpenable(absPath))
    return true
  })

  handle('library:open', async (absPath: string) => {
    // Hands the document to whichever app owns it, which is the only thing
    // that can actually edit one.
    await shell.openPath(await assertOpenable(absPath))
    return true
  })

  /**
   * Add a folder to the library.
   *
   * Main is the only writer here. It picks the folder, saves it, scans it and
   * pushes the documents out — so a caller only has to take the settings back.
   * Having the renderer save the list too was how a folder could be added
   * twice, or added and then never read.
   */
  handle('library:addFolder', async (mode: 'index' | 'copy') => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder of documents',
      buttonLabel: 'Watch this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null

    const chosen = path.resolve(picked.filePaths[0])
    const settings = await loadSettings()

    // A folder already watched, or sitting inside one, would be scanned twice
    // and listed twice — with two ids, so removing one would not remove it.
    const clash = settings.libraryFolders.find((f) => {
      const root = path.resolve(f.path)
      return chosen === root || chosen.startsWith(root + path.sep)
    })
    if (clash) {
      throw new Error(
        chosen === path.resolve(clash.path)
          ? `${clash.label} is already in your library.`
          : `That folder is already covered by ${clash.label}.`
      )
    }

    const folder: LibraryFolder = {
      id: `lib-${Date.now().toString(36)}`,
      path: chosen,
      label: path.basename(chosen) || chosen,
      mode
    }

    const libraryFolders = [...settings.libraryFolders, folder]
    await saveSettings({ libraryFolders })

    // The cache is only loaded at boot when there was already a folder to
    // scan, so the very first one added has to load it before scanning.
    if (settings.libraryFolders.length === 0) await loadCache()
    broadcast('library:scanned', await runScan())

    return { folder, libraryFolders }
  })

  handle('library:removeFolder', async (id: string) => {
    const settings = await loadSettings()
    const libraryFolders = settings.libraryFolders.filter((f) => f.id !== id)
    await saveSettings({ libraryFolders })
    broadcast('library:scanned', await scanLibrary(libraryFolders))
    return libraryFolders
  })

  // ----------------------------------------------------------------- canvas

  handle('canvas:list', () => {
    if (!vault.vaultPath) return []
    return listCanvases(vault.vaultPath)
  })

  handle('canvas:read', (relPath: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return readCanvas(vault.vaultPath, relPath)
  })

  handle('canvas:write', async (relPath: string, data: CanvasData) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    await writeCanvas(vault.vaultPath, relPath, data)
    return true
  })

  handle('canvas:create', async (folder: string, name: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    return createCanvas(vault.vaultPath, folder, name)
  })

  handle('canvas:delete', async (relPath: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    await deleteCanvas(vault.vaultPath, relPath)
    return true
  })

  // ------------------------------------------------- themes and snippets

  handle('vault:themes', async () => {
    if (!vault.vaultPath) return []
    const settings = await loadSettings()
    return listThemes(vault.vaultPath, settings.themeFolder)
  })

  handle('vault:themeCss', async () => {
    if (!vault.vaultPath) return ''
    const settings = await loadSettings()
    return readTheme(vault.vaultPath, settings.activeTheme)
  })

  // ---------------------------------------------------------------- plugins

  handle('plugins:list', async () => {
    if (!vault.vaultPath) return []
    const settings = await loadSettings()
    return discoverPlugins(vault.vaultPath, settings.enabledPlugins)
  })

  handle('plugins:setEnabled', async (id: string, enabled: boolean) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const settings = await loadSettings()
    const enabledPlugins = enabled
      ? [...new Set([...settings.enabledPlugins, id])]
      : settings.enabledPlugins.filter((p) => p !== id)
    await saveSettings({ enabledPlugins })
    return reloadPlugins(vault.vaultPath, enabledPlugins)
  })

  handle('plugins:reload', async () => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const settings = await loadSettings()
    return reloadPlugins(vault.vaultPath, settings.enabledPlugins)
  })

  handle('plugins:commands', () => pluginCommands())

  handle('plugins:run', (pluginId: string, commandId: string) => {
    runPluginCommand(pluginId, commandId)
    return true
  })

  /** The host's one way out. Everything it asks for is checked in `plugins.ts`. */
  ipcMain.handle('plugin-host:api', async (_event, pluginId: string, method: string, args: unknown[]) => {
    try {
      return { ok: true, data: await handlePluginApi(pluginId, method, args) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.on('plugin-host:failed', (_event, pluginId: string, message: string) => {
    broadcast('vault:event', {
      type: 'reminder',
      title: `Plugin ${pluginId}`,
      body: message,
      relPath: null
    })
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

  // ---------------------------------------------------------------- claude

  handle('claude:status', async () => claude.status((await loadSettings()).claudeCommand))

  handle(
    'claude:run',
    async (request: {
      id: string
      mode: ClaudeMode
      prompt: string
      context: string | null
      sessionId?: string | null
    }) => {
      const settings = await loadSettings()
      return await claude.run({
        id: request.id,
        mode: request.mode,
        prompt: request.prompt,
        context: request.context,
        sessionId: request.sessionId ?? null,
        // Read straight from settings on every run rather than trusted from the
        // renderer: what the agent may do is the user's standing decision, and
        // it should not be something a message can widen.
        tools: settings.claudeTools,
        model: settings.claudeModel,
        binaryOverride: settings.claudeCommand,
        // The vault. For the one-shot modes that only means a CLAUDE.md beside
        // the notes is picked up; for the agent it is also the root its file
        // tools are confined to.
        cwd: vault.vaultPath,
        onChunk: (partial) => broadcast('claude:chunk', { id: request.id, text: partial }),
        onActivity: (activity) => broadcast('claude:activity', { id: request.id, activity })
      })
    }
  )

  handle('claude:cancel', (id: string) => claude.cancel(id))

  // ----------------------------------------------------------------- audio

  /**
   * Recording is a stream, not a file upload.
   *
   * MediaRecorder hands the renderer a chunk every few seconds and each one is
   * written straight through. Holding an hour of Opus in a renderer array and
   * posting it across in one go would work right up until the moment it
   * mattered — a crash, a reload, a laptop lid — and lose the whole lecture.
   */
  /** The macOS gate, asked for on the first press of record. */
  handle('audio:requestMicrophone', () => audio.askForMicrophone())

  handle('audio:startRecording', async (label: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const settings = await loadSettings()
    return audio.startRecording(vault.vaultPath, settings.audioFolder, label)
  })

  handle('audio:appendRecording', (id: string, chunk: Uint8Array) =>
    audio.appendRecording(id, chunk)
  )

  handle('audio:finishRecording', async (id: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    const done = await audio.finishRecording(vault.vaultPath, id)
    // The recordings folder is inside the vault, so the watcher will notice on
    // its own; this only makes the file show up without waiting for the debounce.
    broadcast('vault:event', { type: 'reindexed', count: 0 })
    return done
  })

  handle('audio:cancelRecording', (id: string) => audio.cancelRecording(id))

  /** The decoded 16 kHz mono WAV Whisper is fed, streamed the same way. */
  handle('audio:openPcm', (id: string) => audio.openPcm(id))
  handle('audio:writePcm', (id: string, chunk: Uint8Array) => audio.writePcm(id, chunk))
  handle('audio:closePcm', (id: string) => audio.closePcm(id))
  handle('audio:discardPcm', (id: string) => audio.discardPcm(id))

  handle('audio:whisperStatus', async () => whisper.status((await loadSettings()).whisperCommand))

  handle(
    'audio:transcribe',
    async (request: { id: string; audio: string; durationSeconds: number }) => {
      if (!vault.vaultPath) throw new Error('No vault is open.')
      const settings = await loadSettings()
      const wav = await audio.closePcm(request.id)
      if (!wav) throw new Error('The audio was not decoded. Try transcribing again.')

      try {
        const transcript = await whisper.run({
          id: request.id,
          wav,
          audio: request.audio,
          durationSeconds: request.durationSeconds,
          binaryOverride: settings.whisperCommand,
          model: settings.whisperModel,
          language: settings.whisperLanguage,
          onProgress: (segments, progress, stage) =>
            broadcast('audio:progress', { id: request.id, segments, progress, stage })
        })
        await audio.writeTranscript(vault.vaultPath, transcript)
        return transcript
      } finally {
        await audio.discardPcm(request.id)
      }
    }
  )

  handle('audio:cancelTranscribe', (id: string) => whisper.cancel(id))

  handle('audio:transcript', (audioRelPath: string) => {
    if (!vault.vaultPath) return null
    return audio.readTranscript(vault.vaultPath, audioRelPath)
  })

  handle('audio:transcripts', () => {
    if (!vault.vaultPath) return []
    return audio.listTranscripts(vault.vaultPath)
  })

  handle('audio:deleteTranscript', async (audioRelPath: string) => {
    if (!vault.vaultPath) throw new Error('No vault is open.')
    await audio.deleteTranscript(vault.vaultPath, audioRelPath)
    return true
  })

  /**
   * How long a recording is, without decoding it.
   *
   * The renderer needs this to size the scrubber, and a WebM from MediaRecorder
   * carries no duration in its header — `<audio>.duration` reads Infinity until
   * the whole file has been seeked through. The transcript knows, so when there
   * is one it answers; otherwise the player measures it the slow way, once.
   */
  handle('audio:duration', async (audioRelPath: string) => {
    if (!vault.vaultPath) return null
    const transcript = await audio.readTranscript(vault.vaultPath, audioRelPath)
    return transcript?.durationSeconds ?? null
  })

  // ------------------------------------------------------------ code blocks

  /**
   * A note that is a notebook runs its blocks in one session per language, so
   * that the fourth block can use what the second declared. Whether this block
   * can join that session is decided here rather than in the renderer, because
   * it depends on the block's own contents — a Java block with a package in it
   * cannot — and a block that cannot still runs, on its own, with a line in its
   * status saying why.
   */
  handle(
    'code:run',
    async (request: {
      id: string
      lang: string
      code: string
      notePath: string | null
      session: boolean
    }) => {
      const settings = await loadSettings()
      // The note's own folder, so a script can read the file sitting next to
      // it. Falls back to the vault, and then to the home directory in main.
      const cwd =
        vault.vaultPath && request.notePath
          ? path.dirname(toAbsPath(vault.vaultPath, request.notePath))
          : vault.vaultPath
      const timeoutMs = Math.max(1, settings.codeRunTimeout) * 1000
      const onChunk = (stream: 'out' | 'err', text: string): void =>
        broadcast('code:chunk', { id: request.id, stream, text })

      let aside: string | null = null
      if (request.session && request.notePath) {
        const plan = sessionPlan(request.lang, request.code, settings.codeRunners)
        if (!('reason' in plan)) {
          return await runInSession({
            id: request.id,
            lang: request.lang,
            code: request.code,
            notePath: request.notePath,
            cwd,
            timeoutMs,
            overrides: settings.codeRunners,
            onChunk,
            onPhase: (phase) => broadcast('code:phase', { id: request.id, phase })
          })
        }
        // An empty reason is "there is no runner for this at all", which the
        // one-shot path reports far better than a note in the status line.
        aside = plan.reason || null
        // The block asked for a session and is not getting one, so nothing else
        // will move it off "waiting for the block above".
        broadcast('code:phase', { id: request.id, phase: 'running' })
      }

      return await runCode({
        id: request.id,
        lang: request.lang,
        code: request.code,
        cwd,
        timeoutMs,
        overrides: settings.codeRunners,
        note: aside,
        onChunk
      })
    }
  )

  handle('code:cancel', (id: string) => cancelSessionRun(id) || cancelRun(id))

  /** Throws away a note's sessions, so the next block starts from nothing. */
  handle('code:session:restart', (request: { notePath: string; langId: string | null }) =>
    restartSession(request.notePath, request.langId)
  )

  handle('code:sessions', () => listSessions())

  // The blocks in a note show which session they belong to and how many blocks
  // have been through it, so the renderer is told whenever that changes.
  watchSessions(() => broadcast('code:sessions', listSessions()))

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

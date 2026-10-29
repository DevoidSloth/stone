import { app, BrowserWindow, dialog, globalShortcut, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import type { CaptureAction } from '@shared/types'
import { activeVault } from './windows'

/**
 * Reach Stone from outside the app.
 *
 * The window isn't always open, which is the one moment a thought is easiest
 * to lose — it arrives while you are doing something else. Three routes bring
 * it in from the outside: a global chord, a tray menu, and a `stone://` URL.
 *
 * All three land in the same place. Main does not create notes here; it raises
 * the window and forwards an action, so the renderer's existing navigation
 * paths stay the single implementation of what those things mean.
 */

interface CaptureDeps {
  /** Existing window if there is one, otherwise a freshly created one. */
  ensureWindow: () => Promise<BrowserWindow>
}

let tray: Tray | null = null
let deps: CaptureDeps | null = null
let registeredChord: string | null = null

/** Raise the window and hand the renderer something to do. */
async function dispatch(action: CaptureAction): Promise<void> {
  if (!deps) return
  const win = await deps.ensureWindow()
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  // macOS keeps the app in the background when only a shortcut fired, so ask
  // for the foreground explicitly — otherwise the window raises behind Chrome.
  if (process.platform === 'darwin') app.focus({ steal: true })
  win.webContents.send('stone:action', action)
}

/**
 * Parse a `stone://` URL into an action.
 *
 * Anything unrecognised returns null rather than throwing: these arrive from
 * the operating system, and a malformed one is a no-op, not a crash.
 */
export function actionFromUrl(raw: string): CaptureAction | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'stone:') return null

  // `stone://open?...` parses with "open" as the host, not the path.
  const verb = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
  const q = url.searchParams

  switch (verb) {
    case 'open': {
      const relPath = q.get('path')
      return relPath ? { type: 'open', relPath } : null
    }
    case 'daily':
    case 'today':
      return { type: 'show' }
    case 'new': {
      const title = q.get('title')
      return title ? { type: 'new-note', title, content: q.get('content') ?? undefined } : null
    }
    default:
      return null
  }
}

export function handleUrl(raw: string): void {
  const action = actionFromUrl(raw)
  if (action) void dispatch(action)
}

/** Pull a `stone://` argument out of a process argv, for Windows and Linux. */
export function urlFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('stone://')) ?? null
}

const MARKDOWN_FILE = /\.(md|markdown)$/i

/** Pull markdown file arguments out of a process argv, for Windows and Linux. */
export function markdownFromArgv(argv: string[]): string[] {
  // Packaged, argv[0] is the executable; in dev it is followed by the app path,
  // which is a directory and never matches.
  return argv.slice(1).filter((arg) => !arg.startsWith('-') && MARKDOWN_FILE.test(arg))
}

/**
 * Open a markdown file the OS handed us, which is what happens when Stone is
 * the default app for `.md`. A file inside the current vault opens as a note.
 * One outside it is not a note Stone knows about, so say so rather than
 * ignoring the double-click.
 */
export async function openMarkdownFile(absPath: string): Promise<void> {
  const win = deps ? await deps.ensureWindow() : null
  const root = activeVault()?.vaultPath
  const rel = root ? path.relative(root, absPath) : null
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    void dispatch({ type: 'open', relPath: rel.split(path.sep).join('/') })
    return
  }
  void dispatch({ type: 'show' })
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    message: `${path.basename(absPath)} is outside your vault.`,
    detail: 'Stone opens notes from the vault folder. Move or copy the file into it, or switch to the vault that contains it.'
  }
  if (win) await dialog.showMessageBox(win, options)
  else await dialog.showMessageBox(options)
}

/**
 * macOS delivers a double-clicked file as an `open-file` event, and on a cold
 * launch it fires before the app is ready — so this has to be attached at
 * import time, with the paths held until there is a window to show them in.
 */
export function registerOpenFile(): void {
  const pending: string[] = []
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (deps && app.isReady()) void openMarkdownFile(filePath)
    else pending.push(filePath)
  })
  app.whenReady().then(() => {
    // registerCapture runs later in startup; wait for it rather than race it.
    const timer = setInterval(() => {
      if (!deps) return
      clearInterval(timer)
      for (const p of pending.splice(0)) void openMarkdownFile(p)
    }, 100)
  })
}

/**
 * Bind the global capture chord.
 *
 * Returns false when the OS refuses, which happens whenever another app already
 * owns the combination. That is worth reporting rather than swallowing: a
 * shortcut that silently does nothing reads as a broken app.
 */
export function setCaptureShortcut(chord: string | null): boolean {
  if (registeredChord) {
    globalShortcut.unregister(registeredChord)
    registeredChord = null
  }
  if (!chord) return true
  try {
    const ok = globalShortcut.register(chord, () => void dispatch({ type: 'show' }))
    if (ok) registeredChord = chord
    return ok
  } catch {
    return false
  }
}

function buildTray(): void {
  if (tray) return
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return

  image = image.resize({ width: 18, height: 18 })
  // A template image follows the menu bar through light and dark; without this
  // the icon keeps its own colours and looks pasted on.
  if (process.platform === 'darwin') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('Stone')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Stone', click: () => void dispatch({ type: 'show' }) },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ])
  )
  tray.on('click', () => void dispatch({ type: 'show' }))
}

export function registerCapture(
  next: CaptureDeps,
  options: { shortcut: string | null; tray: boolean }
): void {
  deps = next

  app.setAsDefaultProtocolClient('stone')
  setCaptureShortcut(options.shortcut)
  if (options.tray) buildTray()

  // macOS delivers the URL as an event; Windows and Linux as an argument to a
  // second instance, which the single-instance lock funnels back to this one.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleUrl(url)
  })

  const initial = urlFromArgv(process.argv)
  if (initial) setTimeout(() => handleUrl(initial), 800)
  for (const file of markdownFromArgv(process.argv)) {
    setTimeout(() => void openMarkdownFile(path.resolve(file)), 800)
  }
}

export function setTrayEnabled(enabled: boolean): void {
  if (enabled) buildTray()
  else {
    tray?.destroy()
    tray = null
  }
}

export function teardownCapture(): void {
  // `before-quit` also fires on the path where a second instance loses the
  // single-instance lock and quits immediately — which happens before the app
  // is ready, and `globalShortcut` throws if touched that early. Nothing has
  // been registered at that point anyway, so there is nothing to undo.
  if (app.isReady()) globalShortcut.unregisterAll()
  registeredChord = null
  tray?.destroy()
  tray = null
}

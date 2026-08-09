import { app, BrowserWindow, globalShortcut, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import type { CaptureAction } from '@shared/types'

/**
 * Capture from outside the app.
 *
 * Quick-add already existed, but it only answered when Stone had focus, which
 * is the one moment you are least likely to need it — a thought worth capturing
 * almost always arrives while you are doing something else. Three routes bring
 * it in from the outside: a global chord, a tray menu, and a `stone://` URL.
 *
 * All three land in the same place. Main does not create notes here; it raises
 * the window and forwards an action, so the renderer's existing quick-add and
 * navigation paths stay the single implementation of what those things mean.
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
    case 'capture':
    case 'task':
      return { type: 'quick-add', text: q.get('text') ?? undefined }
    case 'open': {
      const relPath = q.get('path')
      return relPath ? { type: 'open', relPath } : null
    }
    case 'daily':
    case 'today':
      return { type: 'daily' }
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
    const ok = globalShortcut.register(chord, () => void dispatch({ type: 'quick-add' }))
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
      { label: 'Quick add…', click: () => void dispatch({ type: 'quick-add' }) },
      { label: "Open today's note", click: () => void dispatch({ type: 'daily' }) },
      { type: 'separator' },
      { label: 'Show Stone', click: () => void dispatch({ type: 'daily' }) },
      { label: 'Quit', role: 'quit' }
    ])
  )
  tray.on('click', () => void dispatch({ type: 'quick-add' }))
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

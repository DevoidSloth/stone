import { app, BrowserWindow, ipcMain, nativeTheme, screen, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { registerIpc, vault } from './ipc'
import { closeAllRecordings } from './audio'
import { loadSettings, peekSettings, saveSettings } from './settings'
import { CHROME_BG, OVERLAY, applyThemeChrome, resolveTheme } from './window-chrome'
import { registerProtocolHandler, registerProtocolScheme } from './protocol'
import { handleUrl, registerCapture, teardownCapture, urlFromArgv } from './capture'
import { stopClipper } from './clipper'
import { reloadPlugins, shutdownPlugins } from './plugins'
import { cancelAllRuns } from './run-code'
import { endAllSessions } from './code-session'
import { registerSpellingMenu } from './spelling'
import { buildAppMenu, type MenuCommand } from './menu'
import { checkForUpdates, registerUpdater, updateState } from './updater'

const isDev = !app.isPackaged

// Schemes can only be declared before the app is ready, so this runs at import.
registerProtocolScheme()

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function iconFile(): string {
  return path.join(app.getAppPath(), 'build', 'icon.png')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Keep a restored window on a screen that still exists.
 *
 * Bounds are saved verbatim, so a window last closed on an external monitor is
 * restored to coordinates that, once the laptop is undocked, name a point no
 * display covers — the window opens off-screen with no way back but deleting
 * the state file. Anything that does not overlap a live display by a reasonable
 * margin gets centred on the primary one instead.
 */
function clampToDisplays(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state

  const rect = { x: state.x, y: state.y, width: state.width, height: state.height }
  const visible = screen.getAllDisplays().some((display) => {
    const a = display.workArea
    const overlapX = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x)
    const overlapY = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y)
    // Enough of the title bar to grab, not merely a corner pixel.
    return overlapX > 120 && overlapY > 60
  })
  if (visible) return state

  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(state.width, workArea.width)
  const height = Math.min(state.height, workArea.height)
  return {
    ...state,
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2)
  }
}

async function readWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf8')
    return clampToDisplays({ width: 1360, height: 900, ...(JSON.parse(raw) as Partial<WindowState>) })
  } catch {
    return { width: 1360, height: 900 }
  }
}

async function persistWindowState(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  const state: WindowState = { ...bounds, maximized: win.isMaximized() }
  try {
    await fs.mkdir(path.dirname(stateFile()), { recursive: true })
    await fs.writeFile(stateFile(), JSON.stringify(state), 'utf8')
  } catch {
    // Losing window position is not worth surfacing to the user.
  }
}

/**
 * The same write, synchronously, for the `close` handler.
 *
 * An async write started as the window closes races the process exit, and the
 * one time it reliably loses is the one that matters: a resize made just before
 * quitting, which is exactly when the user expects the size to stick. The
 * payload is one small object, so blocking for it costs nothing.
 */
function persistWindowStateSync(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const state: WindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() }
  try {
    fsSync.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fsSync.writeFileSync(stateFile(), JSON.stringify(state), 'utf8')
  } catch {
    // Losing window position is not worth surfacing to the user.
  }
}

async function createWindow(): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const state = await readWindowState()
  const theme = resolveTheme(settings.theme)

  // macOS takes its icon from the bundle, so setting it here would be ignored.
  const icon =
    process.platform === 'darwin' || !(await fileExists(iconFile())) ? undefined : iconFile()

  const win = new BrowserWindow({
    icon,
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: CHROME_BG[theme],
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    titleBarOverlay:
      process.platform === 'darwin' ? undefined : { ...OVERLAY[theme], height: 46 },
    // A faint vibrancy on macOS keeps the chrome from reading as a flat rectangle.
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  if (state.maximized) win.maximize()

  // Show on first paint, but never let a renderer problem leave the user with
  // an invisible running app: fall back to showing the window regardless.
  let shown = false
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', reveal)
  setTimeout(reveal, 4000)

  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error(`[stone] renderer failed to load (${code}) ${description} ${url}`)
    reveal()
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[stone] renderer process gone: ${details.reason}`)
  })

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })

  registerSpellingMenu(win.webContents)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persistWindowState(win), 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => persistWindowStateSync(win))

  const notifyMaximize = (): void =>
    win.webContents.send('window:maximized', win.isMaximized())
  win.on('maximize', notifyMaximize)
  win.on('unmaximize', notifyMaximize)

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * Let the renderer reach the microphone, and nothing else.
 *
 * Chromium denies every permission a renderer asks for unless the embedder
 * says otherwise, and Electron installs no handler by default — so without
 * this, `getUserMedia` in the recorder fails with NotAllowedError and no
 * prompt ever appears. The handler is deliberately an allowlist of one: this
 * app has no reason to want the camera, the screen, or a notification stream
 * it did not ask for through `Notification` in main.
 *
 * On macOS the OS prompt is a second, separate gate. It is triggered here
 * rather than at launch, because a note-taking app that asks for the
 * microphone the first time it opens has explained nothing about why.
 */
function allowMicrophone(): void {
  const isMedia = (permission: string): boolean =>
    permission === 'media' || permission === 'audioCapture'

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!isMedia(permission)) {
      callback(false)
      return
    }
    // `mediaTypes` is absent on some request shapes; an audio-only request that
    // does not say so is still audio-only, but a request that names video is not.
    const types = (details as { mediaTypes?: string[] }).mediaTypes
    callback(!types || (types.includes('audio') && !types.includes('video')))
  })

  session.defaultSession.setPermissionCheckHandler((_contents, permission) => isMedia(permission))
}

/**
 * Answer the preload's synchronous question: which theme is in force?
 *
 * The renderer cannot paint the right theme on its first frame without knowing
 * this before any page script runs, and the CSP rightly forbids the inline
 * bootstrap script that would normally carry it. `sendSync` in the preload is
 * the remaining way in, and it is cheap: one cached settings read, once per
 * window, before the first paint.
 */
function registerThemeHint(): void {
  ipcMain.on('theme:resolved', (event) => {
    event.returnValue = resolveTheme(peekSettings().theme)
  })
}

/**
 * Follow the OS when the user has asked to.
 *
 * `nativeTheme.themeSource = 'system'` makes Electron's own chrome follow along,
 * but nothing tells the renderer, so the app would keep whatever palette it had
 * when macOS crossed into dark mode at sunset.
 */
function watchSystemTheme(): void {
  nativeTheme.on('updated', () => {
    if (peekSettings().theme !== 'system') return
    const resolved = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    applyThemeChrome(resolved)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('theme:changed', resolved)
    }
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.stone.app')

  // A packaged build gets its dock icon from Stone.app; `npm run dev` runs the
  // stock Electron.app instead, whose icon and name are Electron's. The name is
  // fixed in the bundle by scripts/patch-dev-electron.mjs — the icon has to be
  // set here, because macOS caches the one it read from the bundle at launch.
  if (isDev && process.platform === 'darwin' && (await fileExists(iconFile()))) {
    app.dock?.setIcon(iconFile())
  }

  const settings = await loadSettings()
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : settings.theme

  // The library roots are read live rather than captured, so adding a folder
  // takes effect without a restart — and removing one revokes access at once.
  registerProtocolHandler(vault, () => peekSettings().libraryFolders.map((f) => f.path))
  registerIpc()
  registerThemeHint()
  watchSystemTheme()

  // A menu before the renderer has reported anything, so the window never opens
  // menuless; it is rebuilt with real labels and accelerators once it has.
  buildAppMenu([])
  ipcMain.on('menu:commands', (_event, commands: MenuCommand[]) => buildAppMenu(commands))

  registerUpdater()
  ipcMain.handle('update:check', () => {
    checkForUpdates(true)
    return updateState()
  })
  ipcMain.handle('update:state', () => updateState())
  allowMicrophone()

  registerCapture(
    {
      // Capture has to work with the window closed, which on macOS is the
      // normal state of a running app — so this creates one when there is none
      // rather than dropping the keystroke.
      ensureWindow: async () => BrowserWindow.getAllWindows()[0] ?? (await createWindow())
    },
    { shortcut: settings.captureShortcut, tray: settings.trayEnabled }
  )

  // Reopen the last vault before the window paints, so the UI never flashes empty.
  if (settings.vaultPath) {
    try {
      await vault.open(settings.vaultPath)
      // Reopening the last vault bypasses the IPC handler, so start its plugins
      // here too — otherwise they only ever run after an explicit vault change.
      if (settings.enabledPlugins.length > 0) {
        void reloadPlugins(settings.vaultPath, settings.enabledPlugins).catch(() => undefined)
      }
    } catch {
      await saveSettings({ vaultPath: null })
    }
  }

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Let the renderer write what it still has in a debounce timer.
 *
 * The renderer saves 900ms after the last keystroke, so quitting mid-sentence
 * used to drop it. `beforeunload` catches most exits, but not the ones that
 * begin here — ⌘Q, the dock menu, a system logout — so the quit is held for one
 * round-trip. Bounded, because a wedged renderer must not make the app
 * unquittable.
 */
let flushed = false

app.on('before-quit', (event) => {
  const [win] = BrowserWindow.getAllWindows()
  if (!flushed && win && !win.isDestroyed() && !win.webContents.isCrashed()) {
    event.preventDefault()
    flushed = true
    const done = new Promise<void>((resolve) => {
      ipcMain.once('app:flushed', () => resolve())
      win.webContents.send('app:flush')
    })
    void Promise.race([done, new Promise((r) => setTimeout(r, 1500))]).then(() => app.quit())
    return
  }

  void vault.close()
  // A recording still open is a file handle holding an unflushed tail; closing
  // it keeps whatever was captured rather than losing the last few seconds.
  void closeAllRecordings()
  teardownCapture()
  stopClipper()
  shutdownPlugins()
  // A block still running is a process group of our own making, and it would
  // outlive the app that has nowhere left to show its output. A notebook's
  // sessions are the same thing sitting idle: a JVM per note, waiting.
  cancelAllRuns()
  endAllSessions()
})

// A second instance should focus the existing window rather than open a rival vault.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // On Windows and Linux a `stone://` link starts a second process, and the
    // URL rides in on its argv — this is the only place it can be read.
    const url = urlFromArgv(argv)
    if (url) {
      handleUrl(url)
      return
    }
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

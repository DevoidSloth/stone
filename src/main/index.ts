import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { registerIpc, vault } from './ipc'
import { loadSettings, peekSettings, saveSettings } from './settings'
import { CHROME_BG, OVERLAY } from './window-chrome'
import { registerProtocolHandler, registerProtocolScheme } from './protocol'
import { handleUrl, registerCapture, teardownCapture, urlFromArgv } from './capture'
import { stopClipper } from './clipper'
import { reloadPlugins, shutdownPlugins } from './plugins'

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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf8')
    return { width: 1360, height: 900, ...(JSON.parse(raw) as Partial<WindowState>) }
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

async function createWindow(): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const state = await readWindowState()
  const theme = settings.theme === 'light' ? 'light' : 'dark'

  // macOS takes its icon from the bundle, so setting it here would be ignored.
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  const icon =
    process.platform === 'darwin' || !(await fileExists(iconPath)) ? undefined : iconPath

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
  win.on('close', () => void persistWindowState(win))

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

app.whenReady().then(async () => {
  app.setAppUserModelId('com.stone.app')

  const settings = await loadSettings()
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : settings.theme

  // The library roots are read live rather than captured, so adding a folder
  // takes effect without a restart — and removing one revokes access at once.
  registerProtocolHandler(vault, () => {
    const roots = peekSettings().libraryFolders.map((f) => f.path)
    // Thumbnails are cached outside any watched folder but are ours to serve.
    return [...roots, path.join(app.getPath('userData'), 'thumbnails')]
  })
  registerIpc()

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

app.on('before-quit', () => {
  void vault.close()
  teardownCapture()
  stopClipper()
  shutdownPlugins()
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

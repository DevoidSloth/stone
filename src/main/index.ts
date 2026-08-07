import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { registerIpc, vault } from './ipc'
import { loadSettings, saveSettings } from './settings'
import { CHROME_BG, OVERLAY } from './window-chrome'
import { registerProtocolHandler, registerProtocolScheme } from './protocol'

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

  registerProtocolHandler(vault)
  registerIpc()

  // Reopen the last vault before the window paints, so the UI never flashes empty.
  if (settings.vaultPath) {
    try {
      await vault.open(settings.vaultPath)
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
})

// A second instance should focus the existing window rather than open a rival vault.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

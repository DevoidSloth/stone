import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'

/**
 * Keeping Stone up to date.
 *
 * The release workflow already builds and signs a DMG on a `v*` tag, and
 * electron-builder already emits the `latest-mac.yml` and `.blockmap` an
 * updater consumes — nothing consumed them, so every user stayed pinned to
 * whatever build they first downloaded.
 *
 * That matters more here than in most apps. The README makes the case for
 * signing precisely because *the next update* must not revoke the calendar
 * permission macOS pinned to the signature, and that argument only pays off if
 * updates actually reach people.
 *
 * Deliberately quiet: it checks, downloads in the background, and then says so
 * once. It never interrupts, and it never restarts the app on its own — a notes
 * app that relaunches under someone mid-sentence has done something worse than
 * being out of date.
 */

// electron-updater ships CommonJS, so the named export comes off the default.
const { autoUpdater } = pkg

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:state', state)
  }
}

function set(next: UpdateState): void {
  state = next
  broadcast()
}

export function updateState(): UpdateState {
  return state
}

/** Install on the next quit — the moment the user has already chosen to stop. */
export function installUpdateOnQuit(): void {
  if (state.status !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}

export function checkForUpdates(manual = false): void {
  if (!app.isPackaged) {
    if (manual) set({ status: 'error', message: 'Updates only apply to an installed build.' })
    return
  }
  if (state.status === 'downloading' || state.status === 'ready') return
  set({ status: 'checking' })
  void autoUpdater.checkForUpdates().catch((err: Error) => {
    set({ status: 'error', message: err.message })
  })
}

export function registerUpdater(): void {
  if (!app.isPackaged) return

  // Downloading is fine unattended; installing is not, so it waits for a quit.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => set({ status: 'downloading', percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle' }))
  autoUpdater.on('download-progress', (progress: { percent: number }) =>
    set({ status: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info: { version: string }) =>
    set({ status: 'ready', version: info.version })
  )
  autoUpdater.on('error', (err: Error) => set({ status: 'error', message: err.message }))

  // Not at launch: the first thirty seconds belong to opening the vault, not to
  // a network round trip nobody asked for.
  setTimeout(() => checkForUpdates(), 30_000)
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000)
}

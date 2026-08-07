import { BrowserWindow } from 'electron'

/**
 * Colours for the Windows caption buttons drawn by the system into the title
 * bar overlay. These live in their own module because both the window factory
 * and the settings IPC handler need them, and importing the entry point from
 * the IPC layer would be circular.
 */
export const OVERLAY = {
  dark: { color: '#191919', symbolColor: '#9b9b9b' },
  light: { color: '#ffffff', symbolColor: '#5f5e5b' }
} as const

export const CHROME_BG = {
  dark: '#191919',
  light: '#ffffff'
} as const

export type ChromeTheme = keyof typeof OVERLAY

/**
 * Repaint the native window chrome to match the in-app theme.
 *
 * Without this the minimise, maximise, and close buttons keep whatever colours
 * they were given at window creation, so switching to the light theme leaves
 * three dark-themed system buttons stranded in a white title bar.
 */
export function applyThemeChrome(theme: ChromeTheme): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(CHROME_BG[theme])
    if (process.platform === 'darwin') continue
    try {
      win.setTitleBarOverlay({ ...OVERLAY[theme], height: 46 })
    } catch {
      // Throws if the window was created without an overlay; nothing to repaint.
    }
  }
}

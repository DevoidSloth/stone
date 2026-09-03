import { BrowserWindow, ipcMain } from 'electron'
import type { Heading } from '@shared/markdown-html'
import type { PrintPayload } from '@shared/types'

/**
 * The print window.
 *
 * A hidden renderer that lays out one note and reports when it has settled, so
 * `printToPDF` never catches a page mid-render. It is the same arrangement the
 * plugin host uses — a second HTML entry, its own minimal preload, never shown
 * — for the same reason: main needs a browser to do something, and the user's
 * window is the wrong browser to borrow.
 *
 * Unlike the plugin host, this window is not kept alive between uses. Printing
 * is occasional and a fresh window costs a few hundred milliseconds, which is
 * cheaper than reasoning about what the last document left behind in the DOM.
 */

export interface PrintHostDeps {
  preloadPath: string
  loadPage: (win: BrowserWindow) => Promise<void>
}

let deps: PrintHostDeps | null = null

export function configurePrintHost(next: PrintHostDeps): void {
  deps = next
}

/**
 * How long to wait for the page to say it is ready.
 *
 * Generous, because a note full of Mermaid diagrams genuinely takes seconds.
 * Bounded, because a diagram that wedges the renderer must not leave an
 * invisible window running for the rest of the session.
 */
const RENDER_TIMEOUT_MS = 30_000

export interface RenderedPage {
  pdf: Buffer
  headings: Heading[]
}

/**
 * Lay out `payload` and print it.
 *
 * `print` receives the window's `webContents` so the caller decides the page
 * geometry — this module knows about rendering, not about paper.
 */
export async function renderToPdf(
  payload: PrintPayload,
  print: (contents: Electron.WebContents) => Promise<Buffer>
): Promise<RenderedPage> {
  if (!deps) throw new Error('The print window is not configured.')

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Hidden windows are throttled by default, and a throttled window can
      // take tens of seconds to lay out a page nobody is looking at.
      backgroundThrottling: false
    }
  })

  const id = win.webContents.id

  try {
    const settled = new Promise<Heading[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('The note took too long to lay out for printing.'))
      }, RENDER_TIMEOUT_MS)

      const onReady = (event: Electron.IpcMainEvent, outline: Heading[]): void => {
        if (event.sender.id !== id) return
        cleanup()
        resolve(outline)
      }
      const onFailed = (event: Electron.IpcMainEvent, message: string): void => {
        if (event.sender.id !== id) return
        cleanup()
        reject(new Error(message))
      }
      const onGone = (): void => {
        cleanup()
        reject(new Error('The print window closed before the note was ready.'))
      }

      function cleanup(): void {
        clearTimeout(timer)
        ipcMain.off('print:ready', onReady)
        ipcMain.off('print:failed', onFailed)
        win.webContents.off('render-process-gone', onGone)
      }

      ipcMain.on('print:ready', onReady)
      ipcMain.on('print:failed', onFailed)
      win.webContents.on('render-process-gone', onGone)
    })

    await deps.loadPage(win)
    win.webContents.send('print:render', payload)
    const headings = await settled

    return { pdf: await print(win.webContents), headings }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

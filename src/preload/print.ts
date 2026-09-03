import { contextBridge, ipcRenderer } from 'electron'
import type { PrintPayload } from '@shared/types'

/**
 * The print window's bridge.
 *
 * Like the plugin host's, this is deliberately tiny: the print window renders
 * one document and says when it is done. It has no reason to reach the vault —
 * main resolves embeds and attachment paths before the payload is sent — so it
 * gets no way to.
 */
/*
 * The payload is caught here rather than in the page.
 *
 * Main sends it as soon as the window reports the document loaded, which can be
 * before the page's module script has run. Listening from the preload — which
 * always runs first — and replaying to whoever asks removes the race entirely.
 */
let pending: PrintPayload | null = null
let listener: ((payload: PrintPayload) => void) | null = null

ipcRenderer.on('print:render', (_e, payload: PrintPayload) => {
  if (listener) listener(payload)
  else pending = payload
})

contextBridge.exposeInMainWorld('stonePrint', {
  onRender: (fn: (payload: PrintPayload) => void) => {
    listener = fn
    if (pending) {
      const payload = pending
      pending = null
      fn(payload)
    }
  },
  /** Rendered, fonts loaded, safe to print. */
  ready: (outline: { level: number; text: string; id: string }[]) => {
    ipcRenderer.send('print:ready', outline)
  },
  failed: (message: string) => {
    ipcRenderer.send('print:failed', message)
  }
})

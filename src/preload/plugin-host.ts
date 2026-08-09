import { contextBridge, ipcRenderer } from 'electron'

/**
 * The plugin host's bridge — deliberately tiny.
 *
 * The main renderer's preload exposes the whole vault API, which is exactly
 * what must not be within reach of plugin code. This one exposes five things:
 * three inbound message taps, one outbound call that main validates against the
 * plugin's granted permissions, and a way to report a crash.
 */
contextBridge.exposeInMainWorld('pluginHost', {
  onLoad: (fn: (msg: { id: string; name: string; source: string }) => void) => {
    ipcRenderer.on('plugin-host:load', (_e, msg) => fn(msg))
  },
  onCommand: (fn: (msg: { pluginId: string; commandId: string }) => void) => {
    ipcRenderer.on('plugin-host:command', (_e, msg) => fn(msg))
  },
  onEvent: (fn: (msg: { name: string; payload: unknown }) => void) => {
    ipcRenderer.on('plugin-host:event', (_e, msg) => fn(msg))
  },
  call: async (pluginId: string, method: string, args: unknown[]) => {
    const reply = (await ipcRenderer.invoke('plugin-host:api', pluginId, method, args)) as
      | { ok: true; data: unknown }
      | { ok: false; error: string }
    if (!reply.ok) throw new Error(reply.error)
    return reply.data
  },
  failed: (pluginId: string, message: string) => {
    ipcRenderer.send('plugin-host:failed', pluginId, message)
  }
})

/**
 * The plugin sandbox's inhabitant.
 *
 * Runs in an offscreen window with no vault access, no network, and no view of
 * Stone's interface. Its whole job is to compile a plugin's source, hand it an
 * API object, and forward what it does back to main — where the permissions
 * that actually gate anything are enforced.
 *
 * Every plugin gets its own function scope but they share this realm, so one
 * plugin can in principle interfere with another's globals. That is the same
 * bargain every extension host makes, and it is bounded: a plugin cannot reach
 * past this window into the app, whatever it does in here.
 */

interface PluginApi {
  addCommand: (command: { id: string; name: string; callback: () => void }) => void
  on: (event: string, handler: (payload: unknown) => void) => void
  notice: (message: string) => void
  vault: {
    list: () => Promise<{ relPath: string; title: string }[]>
    read: (relPath: string) => Promise<string | null>
    write: (relPath: string, content: string) => Promise<void>
  }
}

interface HostBridge {
  onLoad: (fn: (msg: { id: string; name: string; source: string }) => void) => void
  onCommand: (fn: (msg: { pluginId: string; commandId: string }) => void) => void
  onEvent: (fn: (msg: { name: string; payload: unknown }) => void) => void
  call: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>
  failed: (pluginId: string, message: string) => void
}

const bridge = (window as unknown as { pluginHost: HostBridge }).pluginHost

/** Per plugin, the callbacks it registered. */
const callbacks = new Map<string, Map<string, () => void>>()
const listeners = new Map<string, Map<string, ((payload: unknown) => void)[]>>()

function apiFor(pluginId: string): PluginApi {
  return {
    addCommand({ id, name, callback }) {
      const forPlugin = callbacks.get(pluginId) ?? new Map()
      forPlugin.set(id, callback)
      callbacks.set(pluginId, forPlugin)
      void bridge.call(pluginId, 'addCommand', [id, name])
    },

    on(event, handler) {
      const forPlugin = listeners.get(pluginId) ?? new Map()
      forPlugin.set(event, [...(forPlugin.get(event) ?? []), handler])
      listeners.set(pluginId, forPlugin)
    },

    notice(message) {
      void bridge.call(pluginId, 'notice', [String(message)])
    },

    vault: {
      list: () =>
        bridge.call(pluginId, 'listNotes', []) as Promise<{ relPath: string; title: string }[]>,
      read: (relPath) => bridge.call(pluginId, 'read', [relPath]) as Promise<string | null>,
      write: async (relPath, content) => {
        await bridge.call(pluginId, 'write', [relPath, content])
      }
    }
  }
}

bridge.onLoad(({ id, source }) => {
  callbacks.delete(id)
  listeners.delete(id)
  try {
    // Compiled, not evaluated in this scope: the plugin sees its `stone` API and
    // whatever the realm exposes, but none of this module's bindings.
    const factory = new Function('stone', `"use strict";\n${source}`)
    factory(apiFor(id))
  } catch (err) {
    bridge.failed(id, (err as Error).message)
  }
})

bridge.onCommand(({ pluginId, commandId }) => {
  const callback = callbacks.get(pluginId)?.get(commandId)
  if (!callback) return
  try {
    callback()
  } catch (err) {
    bridge.failed(pluginId, (err as Error).message)
  }
})

bridge.onEvent(({ name, payload }) => {
  for (const [pluginId, events] of listeners) {
    for (const handler of events.get(name) ?? []) {
      try {
        handler(payload)
      } catch (err) {
        bridge.failed(pluginId, (err as Error).message)
      }
    }
  }
})

import { BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  LoadedPlugin,
  PluginCommand,
  PluginManifest,
  PluginPermission
} from '@shared/types'

/**
 * The plugin runtime.
 *
 * Obsidian's plugins run in its renderer with full access to the DOM and to
 * Node, which is exactly why its ecosystem is so large and exactly why a
 * malicious plugin there owns the machine. Stone's renderer is locked down —
 * `contextIsolation`, no `nodeIntegration`, and a CSP with `script-src 'self'`
 * that makes injected script a non-event — and widening that so third-party
 * code can be loaded into it would throw away the app's best security property
 * to buy a feature.
 *
 * So plugins run somewhere else: an offscreen window that loads nothing but a
 * bootstrap page shipped inside the app, with no vault access of its own and no
 * handle on the real UI. Plugin source is read here, in main, and passed in as
 * text. Everything a plugin can actually *do* arrives back over IPC as a small
 * set of verbs, each checked against the permissions its manifest declared.
 *
 * The cost is honest and worth naming: a plugin cannot draw its own interface,
 * because it has no DOM to draw into. It can add commands, respond to events,
 * and read and write notes. That covers most of what people write plugins for,
 * and it is the version that does not require trusting the plugin.
 */

export interface PluginHostDeps {
  readNote: (relPath: string) => Promise<string | null>
  writeNote: (relPath: string, content: string) => Promise<void>
  listNotes: () => { relPath: string; title: string }[]
  notice: (message: string) => void
  onCommandsChanged: (commands: PluginCommand[]) => void
  preloadPath: string
  /** Dev serves the host page over http and production loads it off disk. */
  loadHost: (win: BrowserWindow) => Promise<void>
}

const PLUGIN_DIR = ['.stone', 'plugins']

let host: BrowserWindow | null = null
let deps: PluginHostDeps | null = null
let loaded: LoadedPlugin[] = []
let commands: PluginCommand[] = []
/** Permissions by plugin id, consulted on every API call the host makes. */
const grants = new Map<string, Set<PluginPermission>>()

function pluginsRoot(vaultPath: string): string {
  return path.join(vaultPath, ...PLUGIN_DIR)
}

const VALID_PERMISSIONS: PluginPermission[] = ['commands', 'vault-read', 'vault-write', 'events']

function parseManifest(raw: string, dir: string): PluginManifest {
  const json = JSON.parse(raw) as Partial<PluginManifest>
  const permissions = Array.isArray(json.permissions)
    ? json.permissions.filter((p): p is PluginPermission =>
        VALID_PERMISSIONS.includes(p as PluginPermission)
      )
    : []
  return {
    id: (json.id ?? dir).replace(/[^a-zA-Z0-9._-]/g, ''),
    name: json.name ?? dir,
    version: json.version ?? '0.0.0',
    description: json.description ?? '',
    author: json.author ?? null,
    permissions
  }
}

/** Everything installed, whether or not it is switched on. */
export async function discoverPlugins(
  vaultPath: string,
  enabledIds: string[]
): Promise<LoadedPlugin[]> {
  const root = pluginsRoot(vaultPath)
  let dirs: string[]
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }

  const out: LoadedPlugin[] = []
  for (const dir of dirs) {
    try {
      const raw = await fs.readFile(path.join(root, dir, 'manifest.json'), 'utf8')
      const manifest = parseManifest(raw, dir)
      await fs.access(path.join(root, dir, 'main.js'))
      out.push({ ...manifest, dir, enabled: enabledIds.includes(manifest.id), error: null })
    } catch (err) {
      out.push({
        id: dir,
        dir,
        name: dir,
        version: '0.0.0',
        description: '',
        author: null,
        permissions: [],
        enabled: false,
        error:
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'Needs a manifest.json and a main.js.'
            : (err as Error).message
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function ensureHost(): Promise<BrowserWindow> {
  if (host && !host.isDestroyed()) return host

  if (!deps) throw new Error('The plugin host is not configured.')
  host = new BrowserWindow({
    show: false,
    // Never rendered and never focusable — this is a script container, not a
    // window, and the user should have no way to end up looking at it.
    skipTaskbar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Same-origin fetches only, and no network of any kind: whatever a plugin
      // wants to do, it does through the API, where it can be checked.
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  await deps.loadHost(host)
  host.on('closed', () => {
    host = null
  })
  return host
}

/** Hand the host one plugin's source to run. */
async function startPlugin(vaultPath: string, plugin: LoadedPlugin): Promise<void> {
  const source = await fs.readFile(path.join(pluginsRoot(vaultPath), plugin.dir, 'main.js'), 'utf8')
  grants.set(plugin.id, new Set(plugin.permissions))
  const win = await ensureHost()
  win.webContents.send('plugin-host:load', {
    id: plugin.id,
    name: plugin.name,
    source,
    permissions: plugin.permissions
  })
}

export async function reloadPlugins(vaultPath: string, enabledIds: string[]): Promise<LoadedPlugin[]> {
  loaded = await discoverPlugins(vaultPath, enabledIds)
  commands = []
  grants.clear()
  deps?.onCommandsChanged(commands)

  // Tear the host down rather than unloading one plugin at a time: a plugin
  // that scheduled a timer or held a closure has no reliable teardown, and a
  // fresh context is the only honest way to say "that is no longer running".
  if (host && !host.isDestroyed()) host.destroy()
  host = null

  const active = loaded.filter((p) => p.enabled && !p.error)
  if (active.length === 0) return loaded

  for (const plugin of active) {
    try {
      await startPlugin(vaultPath, plugin)
    } catch (err) {
      plugin.error = (err as Error).message
      plugin.enabled = false
    }
  }
  return loaded
}

export function pluginCommands(): PluginCommand[] {
  return commands
}

export function runPluginCommand(pluginId: string, commandId: string): void {
  host?.webContents.send('plugin-host:command', { pluginId, commandId })
}

/** Tell every running plugin something happened, if it asked to hear about it. */
export function emitPluginEvent(name: string, payload: unknown): void {
  if (!host || host.isDestroyed()) return
  host.webContents.send('plugin-host:event', { name, payload })
}

function allowed(pluginId: string, permission: PluginPermission): boolean {
  return grants.get(pluginId)?.has(permission) ?? false
}

/**
 * The API surface, called by the host on a plugin's behalf.
 *
 * Every branch checks the permission first. The host is a separate process that
 * runs untrusted code, so nothing it claims about itself — including which
 * plugin is asking — is worth more than what was granted at load time.
 */
export async function handlePluginApi(
  pluginId: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  if (!deps) throw new Error('The plugin host is not configured.')

  switch (method) {
    case 'addCommand': {
      if (!allowed(pluginId, 'commands')) throw new Error('This plugin cannot add commands.')
      const [id, name] = args as [string, string]
      commands = [
        ...commands.filter((c) => !(c.pluginId === pluginId && c.id === id)),
        { pluginId, id, name }
      ]
      deps.onCommandsChanged(commands)
      return true
    }

    case 'notice': {
      deps.notice(String(args[0] ?? ''))
      return true
    }

    case 'listNotes': {
      if (!allowed(pluginId, 'vault-read')) throw new Error('This plugin cannot read the vault.')
      return deps.listNotes()
    }

    case 'read': {
      if (!allowed(pluginId, 'vault-read')) throw new Error('This plugin cannot read the vault.')
      return deps.readNote(String(args[0]))
    }

    case 'write': {
      if (!allowed(pluginId, 'vault-write')) throw new Error('This plugin cannot write to the vault.')
      await deps.writeNote(String(args[0]), String(args[1]))
      return true
    }

    default:
      throw new Error(`Unknown plugin API method: ${method}`)
  }
}

export function configurePluginHost(next: PluginHostDeps): void {
  deps = next
}

export function shutdownPlugins(): void {
  if (host && !host.isDestroyed()) host.destroy()
  host = null
  commands = []
  grants.clear()
}

import type { BrowserWindow } from 'electron'
import type { Vault } from './vault/store'

/**
 * One vault instance per open window — its own note index, its own file
 * watcher — so two windows can browse two different folders without either
 * seeing the other's files.
 *
 * A handful of integrations were built assuming a single vault: the web
 * clipper, the reminder scheduler, plugins. Rather than rearchitect all of
 * them, they act on the *active* vault — the one belonging to whichever
 * window was focused most recently. `ipc.ts` resolves the vault for a
 * specific request straight from the window that sent it, so this fallback
 * only matters for things that do not originate from a window's own IPC call.
 */
interface Entry {
  win: BrowserWindow
  vault: Vault
}

const entries = new Map<number, Entry>()
let activeId: number | null = null

export function registerWindow(win: BrowserWindow, vault: Vault): void {
  entries.set(win.id, { win, vault })
  activeId = win.id

  win.on('focus', () => {
    activeId = win.id
  })
  win.on('closed', () => {
    entries.delete(win.id)
    if (activeId === win.id) activeId = null
  })
}

export function vaultForWindow(windowId: number): Vault | undefined {
  return entries.get(windowId)?.vault
}

/** The vault belonging to the most recently focused window, or the first one left. */
export function activeVault(): Vault | null {
  if (activeId !== null) {
    const entry = entries.get(activeId)
    if (entry) return entry.vault
  }
  const first = entries.values().next().value as Entry | undefined
  return first ? first.vault : null
}

export function activeWindow(): BrowserWindow | null {
  if (activeId !== null) {
    const entry = entries.get(activeId)
    if (entry) return entry.win
  }
  const first = entries.values().next().value as Entry | undefined
  return first ? first.win : null
}

export function allVaults(): Vault[] {
  return [...entries.values()].map((e) => e.vault)
}

export function allVaultPaths(): string[] {
  return [...entries.values()].map((e) => e.vault.vaultPath).filter((p): p is string => Boolean(p))
}

export function windowCount(): number {
  return entries.size
}

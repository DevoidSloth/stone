import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { STONE_PROTOCOL, toProtocolUrl } from '@shared/attachments'
import type { Vault } from './vault/store'

export { STONE_PROTOCOL, toProtocolUrl }

/**
 * `stone-file://` — read-only access to files inside the open vault.
 *
 * Embedded images have to come from somewhere, and the two obvious options are
 * both wrong: `file://` would hand the renderer the whole filesystem, and
 * inlining every image as a data URI would put megabytes of base64 through IPC
 * on each keystroke.
 *
 * A scheme of our own keeps the renderer's reach to exactly one directory. Every
 * request is resolved against the vault root and refused if it escapes, so a
 * crafted `../../` in a note's image path cannot read anything else.
 */

/** Must run before `app.whenReady`, which is the only time schemes can be registered. */
export function registerProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: STONE_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ])
}

export function registerProtocolHandler(vault: Vault): void {
  protocol.handle(STONE_PROTOCOL, async (request) => {
    const root = vault.vaultPath
    if (!root) return new Response('No vault is open.', { status: 404 })

    let relative: string
    try {
      // `stone-file://vault/Attachments/a.png` — the host segment is a fixed
      // label so the URL parses as a standard scheme; only the path matters.
      const url = new URL(request.url)
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad request.', { status: 400 })
    }
    if (!relative) return new Response('Not found.', { status: 404 })

    const absolute = path.resolve(root, ...relative.split('/'))
    const resolvedRoot = path.resolve(root)
    if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
      return new Response('Refused.', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(absolute).toString())
    } catch {
      return new Response('Not found.', { status: 404 })
    }
  })
}


import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DOC_HOST, STONE_PROTOCOL, toDocumentUrl, toProtocolUrl } from '@shared/attachments'
import type { Vault } from './vault/store'

export { STONE_PROTOCOL, toDocumentUrl, toProtocolUrl }

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

/** True when `absolute` sits at or under `root`. */
function contains(root: string, absolute: string): boolean {
  const resolvedRoot = path.resolve(root)
  return absolute === resolvedRoot || absolute.startsWith(resolvedRoot + path.sep)
}

export function registerProtocolHandler(vault: Vault, libraryRoots: () => string[]): void {
  protocol.handle(STONE_PROTOCOL, async (request) => {
    let host: string
    let relative: string
    try {
      // `stone-file://vault/Attachments/a.png` — the host segment names which
      // set of roots the path is resolved against; only two are ever valid.
      const url = new URL(request.url)
      host = url.hostname
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad request.', { status: 400 })
    }
    if (!relative) return new Response('Not found.', { status: 404 })

    let absolute: string

    if (host === DOC_HOST) {
      // A library document lives outside the vault by design, so the guard here
      // is the set of folders the user explicitly added rather than one root.
      // Everything else on the disk stays exactly as unreachable as before.
      absolute = path.resolve(`/${relative}`)
      if (!libraryRoots().some((root) => contains(root, absolute))) {
        return new Response('Refused.', { status: 403 })
      }
    } else {
      const root = vault.vaultPath
      if (!root) return new Response('No vault is open.', { status: 404 })
      absolute = path.resolve(root, ...relative.split('/'))
      if (!contains(root, absolute)) return new Response('Refused.', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(absolute).toString())
    } catch {
      return new Response('Not found.', { status: 404 })
    }
  })
}


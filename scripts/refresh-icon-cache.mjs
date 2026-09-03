#!/usr/bin/env node
/**
 * Make sure the next package picks up the current build/icon.png.
 *
 * electron-builder derives the .icns and .ico it embeds from build/icon.png and
 * leaves them in release/.icon-icns and release/.icon-ico. It reuses whatever
 * it finds there, so once the artwork changes — `npm run icon`, or an edit to
 * scripts/make-icon.cjs — every later build in the same checkout keeps shipping
 * the old icon, with nothing in the log to say so. Deleting the derived copies
 * costs a second and takes that failure mode off the table.
 *
 * It also refuses to continue when there is no icon at all: electron-builder
 * only warns in that case and packages the app with Electron's own icon, which
 * is a thing you find out about after the release is up.
 *
 * Runs from `dist:win`, and from scripts/build-mac.mjs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function refreshIconCache() {
  const icon = path.join(ROOT, 'build/icon.png')

  if (!fs.existsSync(icon)) {
    console.error(
      '\n  ✗ build/icon.png is missing, so the app would be packaged with ' +
        "Electron's icon. Run `npm run icon` to render it.\n"
    )
    process.exit(1)
  }

  const release = path.join(ROOT, 'release')
  for (const entry of fs.existsSync(release) ? fs.readdirSync(release) : []) {
    if (entry.startsWith('.icon-')) {
      fs.rmSync(path.join(release, entry), { recursive: true, force: true })
    }
  }
}

// Also usable as a step of its own, which is how the Windows build reaches it.
if (process.argv[1] === fileURLToPath(import.meta.url)) refreshIconCache()

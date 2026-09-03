#!/usr/bin/env node
/**
 * Verify an already-built macOS artifact, without rebuilding it.
 *
 * `npm run dist:mac` runs these same checks as its last step. This exists for
 * the cases where the artifact and the build are far apart: confirming a
 * downloaded release dmg is what it claims to be, or checking the app in
 * /Applications after an update to see whether its signature — and so the
 * calendar permission attached to it — is still intact.
 *
 * Usage:
 *   node scripts/verify-mac.mjs                       # newest dmg in release/
 *   node scripts/verify-mac.mjs path/to/Stone.dmg
 *   node scripts/verify-mac.mjs /Applications/Stone.app
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ID, gatekeeperAccepts, verifyApp, withMountedDmg } from './lib/verify-mac-signature.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.join(ROOT, 'release')

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

function newestReleaseDmg() {
  if (!fs.existsSync(RELEASE_DIR)) return null
  const dmgs = fs
    .readdirSync(RELEASE_DIR)
    .filter((entry) => entry.endsWith('.dmg'))
    .map((entry) => path.join(RELEASE_DIR, entry))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return dmgs[0] ?? null
}

if (process.platform !== 'darwin') fail('Signatures can only be checked on macOS.')

const target = process.argv[2] ? path.resolve(process.argv[2]) : newestReleaseDmg()

if (!target) fail('Nothing to verify: no path given and no dmg in release/.')
if (!fs.existsSync(target)) fail(`${target} does not exist.`)

const label = path.basename(target)
console.log(`\n▸ Verifying ${label}`)

let problems
let appForGatekeeper = target

if (target.endsWith('.dmg')) {
  problems = withMountedDmg(target, (app) => {
    appForGatekeeper = null // the mount is gone by the time we could assess it
    return verifyApp(app, label)
  })
} else if (target.endsWith('.app')) {
  problems = verifyApp(target, label)
} else {
  fail(`${label} is neither a .dmg nor a .app.`)
}

if (problems.length > 0) {
  console.error('\n  ✗ The signature is not sound:\n')
  for (const problem of problems) console.error(`    • ${problem}`)
  console.error('')
  process.exit(1)
}

console.log('\n  ✓ Signature verified')
console.log(`      bundle identifier       ${APP_ID}`)
console.log('      hardened runtime        on')
console.log('      Info.plist sealed       yes')
console.log('      requirement anchored    to the certificate, so TCC grants survive updates')
if (appForGatekeeper) {
  console.log(
    `      Gatekeeper              ${
      gatekeeperAccepts(appForGatekeeper)
        ? 'accepted'
        : 'will block first launch (needs a Developer ID and notarisation)'
    }`
  )
}
console.log('')

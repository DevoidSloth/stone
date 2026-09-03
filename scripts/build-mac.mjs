#!/usr/bin/env node
/**
 * Compile, package, sign and verify the macOS build.
 *
 * `electron-builder --mac` already signs, by way of the afterPack hook in
 * scripts/sign-mac.mjs. What it does not do is tell you whether the signature
 * is the *right* one, and a wrong-but-present signature fails in the way this
 * project keeps getting bitten by: calendar access disappearing on update.
 * macOS records a TCC grant against the app's designated requirement, so the
 * grant only survives a rebuild when that requirement anchors to a certificate
 * rather than to the binary's cdhash — and nothing in a normal build fails when
 * it doesn't.
 *
 * So this script wraps the build with the checks that would otherwise only
 * surface as a bug report months later:
 *
 *   - refuses to start when there is no certificate to sign with (a five-minute
 *     universal build is a long time to wait to be told that)
 *   - clears stale output, so a failed package can't leave the last release's
 *     dmg behind to be uploaded as if it were this one, and the icon derived
 *     from a previous build can't outlive the artwork it came from
 *   - verifies the packaged .app and the app inside the dmg, which is the
 *     artifact that actually ships
 *
 * Usage:
 *   npm run dist:mac
 *   node scripts/build-mac.mjs --allow-unsigned      # throwaway build, no cert
 *   node scripts/build-mac.mjs --skip-typecheck
 *   node scripts/build-mac.mjs --skip-dmg-verify     # the staged .app only
 *   node scripts/build-mac.mjs -- --publish always   # args after -- go to electron-builder
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refreshIconCache } from './refresh-icon-cache.mjs'
import { resolveIdentity, UNSIGNED_WARNING } from './lib/mac-identity.mjs'
import { APP_ID, gatekeeperAccepts, verifyApp, withMountedDmg } from './lib/verify-mac-signature.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.join(ROOT, 'release')

const KNOWN_FLAGS = ['--allow-unsigned', '--skip-typecheck', '--skip-dmg-verify']

const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
const flags = new Set(separator === -1 ? argv : argv.slice(0, separator))
const builderArgs = separator === -1 ? [] : argv.slice(separator + 1)

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

for (const flag of flags) {
  if (!KNOWN_FLAGS.includes(flag)) {
    fail(`Unknown option ${flag}. Known options: ${KNOWN_FLAGS.join(', ')}`)
  }
}

// The STONE_* spellings are the CI-friendly ones: a workflow can set them from
// what it already knows — whether the signing secret was available, whether it
// has run the typecheck as its own step.
const allowUnsigned = flags.has('--allow-unsigned') || process.env.STONE_ALLOW_UNSIGNED === '1'
const skipTypecheck = flags.has('--skip-typecheck') || process.env.STONE_SKIP_TYPECHECK === '1'
const skipDmgVerify = flags.has('--skip-dmg-verify')

function step(message) {
  console.log(`\n▸ ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })
  if (result.error) fail(`${command} could not be started: ${result.error.message}`)
  if (result.status !== 0) fail(`\`${command} ${args.join(' ')}\` exited with ${result.status}`)
}

if (process.platform !== 'darwin') {
  fail('macOS builds have to be packaged and signed on macOS.')
}

// ---------------------------------------------------------------------------
// Decide on an identity before spending the time to build.
// ---------------------------------------------------------------------------

const identity = resolveIdentity()

if (!identity && !allowUnsigned) {
  console.error(UNSIGNED_WARNING)
  fail(
    'Refusing to build unsigned. Create a certificate as above, or pass ' +
      '--allow-unsigned for a throwaway build.'
  )
}

if (identity) {
  console.log(`\n  Signing identity: ${identity.name}  (${identity.kind})`)
} else {
  console.warn(UNSIGNED_WARNING)
}

// ---------------------------------------------------------------------------
// Compile and package.
// ---------------------------------------------------------------------------

if (!skipTypecheck) {
  step('Typechecking')
  run('npm', ['run', 'typecheck'])
}

step('Clearing previous macOS output')
// Only the macOS artifacts, so a Windows build sitting in release/ survives.
// The derived icons go too, which is what refreshIconCache is for.
refreshIconCache()
for (const entry of fs.existsSync(RELEASE_DIR) ? fs.readdirSync(RELEASE_DIR) : []) {
  if (entry.startsWith('mac') || entry.endsWith('.dmg') || entry.endsWith('.dmg.blockmap')) {
    fs.rmSync(path.join(RELEASE_DIR, entry), { recursive: true, force: true })
  }
}

step('Building renderer, preload and main')
run('npm', ['run', 'build'])

step('Packaging and signing')
run(
  'npx',
  ['electron-builder', '--mac', ...(builderArgs.length ? builderArgs : ['--publish', 'never'])],
  {
    env: {
      ...process.env,
      // Signing is done by the afterPack hook, so electron-builder's own
      // identity discovery — which rejects a self-signed certificate and would
      // quietly package unsigned — stays off.
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    }
  }
)

// ---------------------------------------------------------------------------
// Verify what came out.
// ---------------------------------------------------------------------------

function findPackagedApp() {
  const macDirs = fs
    .readdirSync(RELEASE_DIR)
    .filter((entry) => entry.startsWith('mac'))
    .map((entry) => path.join(RELEASE_DIR, entry))
    .filter((dir) => fs.statSync(dir).isDirectory())

  for (const dir of macDirs) {
    const app = fs.readdirSync(dir).find((entry) => entry.endsWith('.app'))
    if (app) return path.join(dir, app)
  }
  return null
}

const appPath = findPackagedApp()
if (!appPath) fail('electron-builder produced no .app under release/.')

const dmg = fs.readdirSync(RELEASE_DIR).find((entry) => entry.endsWith('.dmg'))
if (!dmg) fail('electron-builder produced no .dmg under release/.')
const dmgPath = path.join(RELEASE_DIR, dmg)

if (!identity) {
  console.warn('\n  ⚠  Skipping verification — this build was packaged unsigned on purpose.')
  console.log(`\n  ${path.relative(ROOT, dmgPath)}\n`)
  process.exit(0)
}

step(`Verifying ${path.relative(ROOT, appPath)}`)
const problems = verifyApp(appPath, 'packaged app')

if (!skipDmgVerify) {
  step(`Verifying the app inside ${dmg}`)
  problems.push(...withMountedDmg(dmgPath, (app) => verifyApp(app, 'app inside the dmg')))
}

if (problems.length > 0) {
  console.error('\n  ✗ The signature is not sound:\n')
  for (const problem of problems) console.error(`    • ${problem}`)
  console.error('')
  process.exit(1)
}

// Finder and the Dock cache an icon against the bundle, and a rebuild in place
// keeps showing the old one until something touches it. Touching the directory
// changes no sealed content, so the signature verified above still holds.
try {
  fs.utimesSync(appPath, new Date(), new Date())
} catch {
  // Cosmetic; a build is not worth failing over a cache hint.
}

console.log('\n  ✓ Signature verified')
console.log(`      identity                ${identity.name} (${identity.kind})`)
console.log(`      bundle identifier       ${APP_ID}`)
console.log('      hardened runtime        on')
console.log('      Info.plist sealed       yes')
console.log('      requirement anchored    to the certificate, so TCC grants survive updates')
console.log(
  `      Gatekeeper              ${
    gatekeeperAccepts(appPath)
      ? 'accepted'
      : 'will block first launch (needs a Developer ID and notarisation)'
  }`
)
console.log(`\n  ${path.relative(ROOT, dmgPath)}\n`)

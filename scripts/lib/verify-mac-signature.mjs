/**
 * Check that a packaged macOS app carries the signature it needs.
 *
 * "Signed" is not the bar. macOS records a TCC (privacy) grant against an app's
 * *designated requirement*, so calendar access only survives a rebuild when
 * that requirement anchors to a certificate:
 *
 *   identifier "com.stone.app" and certificate root = H"…"   ← survives updates
 *   cdhash H"…"                                              ← dies with this binary
 *
 * Nothing in a normal build fails when it comes out the second way, which is
 * why these checks exist as a build step rather than as a habit.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const APP_ID = 'com.stone.app'

// The Info.plist keys TCC reads when it decides whether to even show the
// calendar prompt. They are only trustworthy because the signature seals them,
// which is why they are checked after signing rather than in the config.
const REQUIRED_USAGE_KEYS = [
  'NSCalendarsUsageDescription',
  'NSCalendarsFullAccessUsageDescription'
]

const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.automation.apple-events'
]

/** codesign writes most of what we want to stderr, so both streams are joined. */
function codesign(args) {
  const result = spawnSync('codesign', args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`
  }
}

/**
 * @param {string} appPath
 * @param {string} label prefix for the messages, e.g. "packaged app"
 * @returns {string[]} problems found; empty when the bundle is sound
 */
export function verifyApp(appPath, label = path.basename(appPath)) {
  const problems = []
  const note = (message) => problems.push(`${label}: ${message}`)

  if (!fs.existsSync(appPath)) return [`${label}: ${appPath} does not exist`]

  // --deep walks the helpers and frameworks; --strict rejects the loopholes
  // that let a partly-signed bundle pass.
  const verified = codesign(['--verify', '--deep', '--strict', '--verbose=2', appPath])
  if (!verified.ok) {
    note(`codesign --verify failed:\n${verified.output.trim()}`)
    // Everything below reads the signature that just failed to validate, so
    // there is nothing more to learn here.
    return problems
  }

  const described = codesign(['-dvvv', appPath]).output

  const identifier = /^Identifier=(.+)$/m.exec(described)?.[1]
  if (identifier !== APP_ID) {
    note(
      `bundle identifier is "${identifier}", expected "${APP_ID}" — the TCC grant ` +
        'would be recorded against the wrong app'
    )
  }

  // An unsealed Info.plist is exactly the state that produces a cdhash-pinned
  // grant: macOS will not trust the bundle identifier or the usage strings.
  if (described.includes('Info.plist=not bound') || !/Info\.plist entries=\d+/.test(described)) {
    note('the Info.plist is not sealed into the signature')
  }

  if (!/Sealed Resources version=\d+/.test(described)) {
    note('bundle resources are not sealed')
  }

  // Notarisation requires the hardened runtime, and the entitlements below are
  // only enforced under it.
  if (!/flags=\S*\(.*runtime.*\)/.test(described)) {
    note('the hardened runtime is not enabled')
  }

  if (!/^Authority=(.+)$/m.test(described)) {
    note('no signing authority — the bundle is unsigned or ad-hoc signed')
  }

  // The whole point of the exercise. codesign prints an *implicit* requirement
  // — the kind an ad-hoc signature gets, built from cdhashes — commented out
  // with a leading "#", so that prefix has to be tolerated here or the cdhash
  // case reads as "no requirement at all" and loses the diagnosis.
  const requirement = codesign(['-d', '-r-', appPath]).output
  const designated = /^#?\s*designated =>(.+)$/m.exec(requirement)?.[1]?.trim()
  if (!designated) {
    note('no designated requirement')
  } else if (!/certificate (root|leaf)/.test(designated)) {
    note(
      'the designated requirement does not anchor to a certificate, so calendar ' +
        `access will not survive an update:\n    ${designated}`
    )
  } else if (!designated.includes(`identifier "${APP_ID}"`)) {
    note(`the designated requirement does not name ${APP_ID}:\n    ${designated}`)
  }

  const entitlements = codesign(['-d', '--entitlements', '-', '--xml', appPath]).output
  for (const key of REQUIRED_ENTITLEMENTS) {
    if (!entitlements.includes(key)) note(`entitlement ${key} is missing from the signature`)
  }

  const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
  for (const key of REQUIRED_USAGE_KEYS) {
    try {
      // plutil reports a missing key on stderr, which is the expected path
      // here — it is turned into a message below rather than printed raw.
      const value = execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlist], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      if (!value) note(`${key} is empty; macOS refuses the request rather than prompting`)
    } catch {
      note(`${key} is missing from Info.plist; macOS refuses the request rather than prompting`)
    }
  }

  return problems
}

/**
 * Mount a dmg, hand the .app inside it to `verify`, and unmount whatever
 * happens. The dmg is the artifact that actually ships, so it is the one worth
 * checking.
 *
 * @param {string} dmgPath
 * @param {(appPath: string) => string[]} verify
 * @returns {string[]} problems found
 */
export function withMountedDmg(dmgPath, verify) {
  const name = path.basename(dmgPath)
  const mountPoint = fs.mkdtempSync(path.join(path.dirname(dmgPath), '.verify-'))

  try {
    execFileSync(
      'hdiutil',
      ['attach', dmgPath, '-nobrowse', '-readonly', '-noverify', '-mountpoint', mountPoint],
      { stdio: 'pipe' }
    )
  } catch (error) {
    fs.rmSync(mountPoint, { recursive: true, force: true })
    return [`${name}: could not be mounted: ${error.message}`]
  }

  try {
    const app = fs.readdirSync(mountPoint).find((entry) => entry.endsWith('.app'))
    if (!app) return [`${name}: contains no .app`]
    return verify(path.join(mountPoint, app))
  } finally {
    // Detaching can lose a race with Spotlight indexing the fresh mount, so the
    // forced detach is the fallback rather than the first attempt.
    const detached = spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'pipe' })
    if (detached.status !== 0) {
      spawnSync('hdiutil', ['detach', '-force', mountPoint], { stdio: 'pipe' })
    }
    fs.rmSync(mountPoint, { recursive: true, force: true })
  }
}

/**
 * Gatekeeper is a separate question from TCC: a self-signed certificate keeps
 * the calendar grant alive but will never clear Gatekeeper, which needs a real
 * Developer ID and notarisation. Reported so the difference stays visible — not
 * treated as a failure.
 */
export function gatekeeperAccepts(appPath) {
  return spawnSync('spctl', ['--assess', '--type', 'execute', '-vv', appPath]).status === 0
}

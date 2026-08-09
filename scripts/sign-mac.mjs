/**
 * Sign the packaged macOS app.
 *
 * electron-builder refuses to sign with anything it cannot validate a trust
 * chain for, which rules out a self-signed certificate — it reports "no valid
 * identity with this name" and packages the app unsigned. Unsigned is the state
 * that breaks calendar access: with no certificate to anchor to, macOS pins the
 * TCC grant to the binary's cdhash and every rebuild invalidates it.
 *
 * `@electron/osx-sign` is the layer electron-builder itself signs through, and
 * it applies no such trust check, so it is driven directly here from an
 * `afterPack` hook. It also knows the correct inside-out ordering for versioned
 * frameworks, which is fiddly to get right by hand.
 *
 * Identity resolution, in order:
 *   1. STONE_SIGN_IDENTITY, if set
 *   2. a Developer ID Application certificate, if the keychain has one
 *   3. the self-signed "Stone Local Signing" certificate
 *   4. nothing — packaged unsigned, with a warning explaining the consequence
 */

import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { signAsync } from '@electron/osx-sign'

const LOCAL_IDENTITY = 'Stone Local Signing'

function keychainIdentities() {
  try {
    // -v filters to valid identities and would hide the self-signed one, so the
    // full list is read and matched by name.
    return execFileSync('security', ['find-identity', '-p', 'codesigning'], {
      encoding: 'utf8'
    })
  } catch {
    return ''
  }
}

function resolveIdentity() {
  if (process.env.STONE_SIGN_IDENTITY) {
    return { name: process.env.STONE_SIGN_IDENTITY, kind: 'configured' }
  }

  const listed = keychainIdentities()

  const developerId = /"(Developer ID Application: [^"]+)"/.exec(listed)
  if (developerId) return { name: developerId[1], kind: 'developer-id' }

  if (listed.includes(LOCAL_IDENTITY)) return { name: LOCAL_IDENTITY, kind: 'self-signed' }

  return null
}

export default async function signMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  // A universal build packs x64 and arm64 into throwaway `*-temp` directories,
  // merges them, then packs the result — and electron-builder runs afterPack
  // on all three, not just the last one. Signing the two temp bundles gives
  // each its own _CodeSignature/CodeResources, and @electron/universal's merge
  // requires every non-binary file to be byte-identical between them, so
  // signing early breaks the merge before this hook ever sees the real app.
  if (context.appOutDir.endsWith('-temp')) return

  const identity = resolveIdentity()
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  if (!identity) {
    console.warn(
      [
        '',
        '  ⚠  No signing certificate found — packaging unsigned.',
        '',
        '     Calendar access will not survive a rebuild: with no certificate,',
        '     macOS pins the permission to this exact binary and the next build',
        '     invalidates it.',
        '',
        '     Fix with:  ./scripts/make-signing-cert.sh',
        ''
      ].join('\n')
    )
    return
  }

  console.log(`  • signing with ${identity.kind} identity: ${identity.name}`)

  await signAsync({
    app: appPath,
    identity: identity.name,
    // Skip the trust-chain check so a self-signed certificate is usable.
    identityValidation: false,
    platform: 'darwin',
    type: 'distribution',
    optionsForFile: () => ({
      // The hardened runtime is what makes the entitlements meaningful, and
      // notarisation requires it. It costs nothing on a self-signed build.
      hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist',
      signatureFlags: ['runtime']
    })
  })

  // The signature is only worth anything if the Info.plist is sealed into it —
  // that is what lets macOS trust the bundle identifier and the calendar usage
  // strings when it decides who is asking for access. An unsealed Info.plist is
  // exactly the state that produced the cdhash-pinned grant, so it fails the
  // build rather than shipping something that will misbehave months later.
  // codesign reports on stderr, so both streams are collected.
  const probe = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' })
  const described = `${probe.stdout ?? ''}${probe.stderr ?? ''}`

  if (described.includes('Info.plist=not bound')) {
    throw new Error(
      'Signing left the Info.plist unsealed; macOS would not trust the bundle identifier.'
    )
  }

  const identifier = /^Identifier=(.+)$/m.exec(described)?.[1]
  if (identifier && identifier !== context.packager.appInfo.id) {
    throw new Error(
      `Signed with identifier "${identifier}", expected "${context.packager.appInfo.id}". ` +
        'The TCC grant would be recorded against the wrong app.'
    )
  }
}

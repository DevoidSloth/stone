/**
 * Which certificate a macOS build signs with.
 *
 * Shared by the afterPack hook (scripts/sign-mac.mjs) and the build wrapper
 * (scripts/build-mac.mjs) so the wrapper can refuse to start a five-minute
 * package when the hook would end up signing with nothing.
 *
 * Resolution order:
 *   1. STONE_SIGN_IDENTITY, if set
 *   2. a Developer ID Application certificate, if the keychain has one
 *   3. the self-signed "Stone Local Signing" certificate
 *   4. nothing
 */

import { execFileSync } from 'node:child_process'

export const LOCAL_IDENTITY = 'Stone Local Signing'

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

/** @returns {{ name: string, kind: 'configured' | 'developer-id' | 'self-signed' } | null} */
export function resolveIdentity() {
  if (process.env.STONE_SIGN_IDENTITY) {
    return { name: process.env.STONE_SIGN_IDENTITY, kind: 'configured' }
  }

  const listed = keychainIdentities()

  const developerId = /"(Developer ID Application: [^"]+)"/.exec(listed)
  if (developerId) return { name: developerId[1], kind: 'developer-id' }

  if (listed.includes(LOCAL_IDENTITY)) return { name: LOCAL_IDENTITY, kind: 'self-signed' }

  return null
}

/**
 * The warning shown wherever a build is about to go out unsigned. Kept here so
 * the hook and the wrapper explain the consequence the same way.
 */
export const UNSIGNED_WARNING = [
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

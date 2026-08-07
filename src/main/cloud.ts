import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CloudTarget } from '@shared/types'

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** macOS 12+ puts every provider under ~/Library/CloudStorage/<Provider>-<account>. */
async function cloudStorageEntries(prefix: string): Promise<string[]> {
  const root = path.join(os.homedir(), 'Library', 'CloudStorage')
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((e) => path.join(root, e.name))
  } catch {
    return []
  }
}

/** Google Drive for Desktop on Windows usually mounts a lettered drive. */
async function windowsDriveLetters(): Promise<string[]> {
  const found: string[] = []
  for (let code = 68; code <= 90; code++) {
    const candidate = `${String.fromCharCode(code)}:\\My Drive`
    if (await isDir(candidate)) found.push(candidate)
  }
  return found
}

/**
 * Find the sync folders already on this machine. Stone does not implement a
 * sync protocol — it puts the vault inside a folder that iCloud or Drive is
 * already replicating, which is both simpler and far more reliable.
 */
export async function detectCloudTargets(): Promise<CloudTarget[]> {
  const home = os.homedir()
  const candidates: Omit<CloudTarget, 'exists'>[] = []

  const push = (kind: CloudTarget['kind'], label: string, p: string): void => {
    candidates.push({ kind, label, path: p })
  }

  if (process.platform === 'darwin') {
    push('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))
    for (const dir of await cloudStorageEntries('GoogleDrive')) {
      const myDrive = path.join(dir, 'My Drive')
      push('gdrive', 'Google Drive', (await isDir(myDrive)) ? myDrive : dir)
    }
    for (const dir of await cloudStorageEntries('Dropbox')) push('dropbox', 'Dropbox', dir)
    for (const dir of await cloudStorageEntries('OneDrive')) push('onedrive', 'OneDrive', dir)
    push('gdrive', 'Google Drive', path.join(home, 'Google Drive'))
    push('dropbox', 'Dropbox', path.join(home, 'Dropbox'))
  } else if (process.platform === 'win32') {
    push('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'))
    for (const drive of await windowsDriveLetters()) push('gdrive', 'Google Drive', drive)
    push('gdrive', 'Google Drive', path.join(home, 'My Drive'))
    push('gdrive', 'Google Drive', path.join(home, 'Google Drive'))
    if (process.env.OneDrive) push('onedrive', 'OneDrive', process.env.OneDrive)
    push('onedrive', 'OneDrive', path.join(home, 'OneDrive'))
    push('dropbox', 'Dropbox', path.join(home, 'Dropbox'))
  } else {
    push('gdrive', 'Google Drive', path.join(home, 'GoogleDrive'))
    push('dropbox', 'Dropbox', path.join(home, 'Dropbox'))
  }

  push('local', 'This computer', path.join(home, 'Documents'))

  const seen = new Set<string>()
  const results: CloudTarget[] = []
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (await isDir(candidate.path)) results.push({ ...candidate, exists: true })
  }
  return results
}

/**
 * Warn about setups that corrupt vaults. Real-time indexers and on-demand
 * eviction are the two things that actually break file-backed note apps.
 */
export function syncAdvice(target: CloudTarget): string[] {
  const notes: string[] = []
  if (target.kind === 'icloud') {
    notes.push('Turn off "Optimise Mac Storage" for this folder so notes are never evicted.')
  }
  if (target.kind === 'gdrive') {
    notes.push('Set the folder to "Available offline" in Drive so edits work without a connection.')
  }
  if (target.kind === 'onedrive') {
    notes.push('Right-click the folder and choose "Always keep on this device".')
  }
  if (target.kind !== 'local') {
    notes.push('Let one machine finish syncing before editing the same note on another.')
  }
  return notes
}

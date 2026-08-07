import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** Directories never worth walking, and sync-engine bookkeeping we must not touch. */
const IGNORED_DIRS = new Set([
  '.git',
  '.stone',
  '.obsidian',
  '.trash',
  '.smart-env',
  'node_modules',
  '.DS_Store',
  '__pycache__',
  '.Trash'
])

/** iCloud leaves `.foo.md.icloud` stubs for evicted files; they hold no content. */
const PLACEHOLDER_RE = /\.icloud$|^~\$|\.tmp$|\.crswap$/

export function isIgnored(name: string): boolean {
  return IGNORED_DIRS.has(name) || PLACEHOLDER_RE.test(name)
}

export function toRelPath(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join('/')
}

export function toAbsPath(vaultPath: string, relPath: string): string {
  return path.join(vaultPath, ...relPath.split('/'))
}

/** Reject paths that would escape the vault via `..` or an absolute segment. */
export function assertInsideVault(vaultPath: string, absPath: string): void {
  const resolved = path.resolve(absPath)
  const root = path.resolve(vaultPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to touch a path outside the vault: ${absPath}`)
  }
}

export interface WalkedFile {
  absPath: string
  relPath: string
  mtimeMs: number
  birthtimeMs: number
  size: number
}

/** Recursively collect markdown files, skipping ignored and placeholder entries. */
export async function walkMarkdown(vaultPath: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []

  async function visit(dir: string): Promise<void> {
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (isIgnored(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(abs)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        try {
          const st = await fs.stat(abs)
          out.push({
            absPath: abs,
            relPath: toRelPath(vaultPath, abs),
            mtimeMs: st.mtimeMs,
            birthtimeMs: st.birthtimeMs,
            size: st.size
          })
        } catch {
          // Vanished mid-walk (common in synced folders). Skip it.
        }
      }
    }
  }

  await visit(vaultPath)
  return out
}

export function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex').slice(0, 16)
}

export async function readNote(absPath: string): Promise<string> {
  return fs.readFile(absPath, 'utf8')
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export interface WriteResult {
  ok: boolean
  mtime: number
  /** Set when another process had changed the file since we last read it. */
  conflictBackup?: string
}

/**
 * Write a note atomically.
 *
 * Temp-file-plus-rename keeps a half-written file from ever being visible to a
 * sync client. When `expectedHash` is supplied and the file on disk no longer
 * matches, the remote version is preserved as a conflict copy before we write —
 * the same contract Obsidian Sync and Dropbox use, so nothing is lost silently.
 */
export async function writeNoteAtomic(
  absPath: string,
  content: string,
  expectedHash?: string
): Promise<WriteResult> {
  const dir = path.dirname(absPath)
  await ensureDir(dir)

  let conflictBackup: string | undefined

  if (expectedHash) {
    try {
      const current = await fs.readFile(absPath, 'utf8')
      if (hashContent(current) !== expectedHash) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const base = path.basename(absPath, '.md')
        conflictBackup = path.join(dir, `${base} (conflict ${stamp}).md`)
        await fs.writeFile(conflictBackup, current, 'utf8')
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
    }
  }

  const tmp = path.join(dir, `.stone-${process.pid}-${Date.now()}.tmp`)
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    // Flush before rename so a crash cannot leave an empty file in its place.
    await handle.sync()
  } finally {
    await handle.close()
  }

  await fs.rename(tmp, absPath)
  const st = await fs.stat(absPath)
  return { ok: true, mtime: st.mtimeMs, conflictBackup }
}

/**
 * Move to the vault's `.trash` rather than unlinking, so deletes stay
 * recoverable. The note's original vault-relative path is recorded in a
 * sidecar so a restore can put it back where it came from rather than dumping
 * everything at the root.
 */
export async function trashNote(vaultPath: string, absPath: string): Promise<string> {
  const trashDir = path.join(vaultPath, '.trash')
  await ensureDir(trashDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(trashDir, `${path.basename(absPath, '.md')} ${stamp}.md`)
  const origin = toRelPath(vaultPath, absPath)
  await fs.rename(absPath, target)
  try {
    await fs.writeFile(`${target}.origin`, origin, 'utf8')
  } catch {
    // Without the sidecar a restore falls back to the inbox; not worth failing over.
  }
  return target
}

export interface TrashedFile {
  relPath: string
  title: string
  deletedAt: number
  size: number
}

export async function listTrash(vaultPath: string): Promise<TrashedFile[]> {
  const trashDir = path.join(vaultPath, '.trash')
  let entries: fsSync.Dirent[]
  try {
    entries = await fs.readdir(trashDir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: TrashedFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    try {
      const st = await fs.stat(path.join(trashDir, entry.name))
      out.push({
        relPath: `.trash/${entry.name}`,
        // Strip the ` 2026-08-07T12-30-00` stamp the trash filename carries.
        title: entry.name.replace(/\.md$/i, '').replace(/\s\d{4}-\d{2}-\d{2}T[\d-]+$/, ''),
        deletedAt: st.mtimeMs,
        size: st.size
      })
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** Put a trashed note back, preferring its recorded origin path. */
export async function restoreFromTrash(
  vaultPath: string,
  trashRelPath: string,
  fallbackFolder: string
): Promise<string> {
  const source = toAbsPath(vaultPath, trashRelPath)
  assertInsideVault(vaultPath, source)

  let origin: string | null = null
  try {
    origin = (await fs.readFile(`${source}.origin`, 'utf8')).trim() || null
  } catch {
    origin = null
  }

  const base = origin
    ? path.basename(origin, '.md')
    : path.basename(trashRelPath, '.md').replace(/\s\d{4}-\d{2}-\d{2}T[\d-]+$/, '')
  const dir = origin
    ? path.dirname(toAbsPath(vaultPath, origin))
    : path.join(vaultPath, ...fallbackFolder.split('/').filter(Boolean))

  await ensureDir(dir)
  const target = await uniquePath(dir, base)
  assertInsideVault(vaultPath, target)
  await fs.rename(source, target)
  await fs.rm(`${source}.origin`, { force: true })
  return toRelPath(vaultPath, target)
}

export async function emptyTrash(vaultPath: string): Promise<number> {
  const trashDir = path.join(vaultPath, '.trash')
  let entries: string[]
  try {
    entries = await fs.readdir(trashDir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of entries) {
    try {
      await fs.rm(path.join(trashDir, name), { force: true, recursive: true })
      if (name.toLowerCase().endsWith('.md')) removed++
    } catch {
      // Locked by another process; leave it and keep going.
    }
  }
  return removed
}

// -------------------------------------------------------------- attachments

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp'
}

export function extensionForMime(mime: string): string {
  return IMAGE_EXT[mime] ?? 'bin'
}

/**
 * Write a pasted or dropped file into the vault's attachments folder.
 * Names collide constantly (`image.png` from every screenshot tool), so the
 * base name is stamped rather than deduplicated with a counter.
 */
export async function saveAttachment(
  vaultPath: string,
  folder: string,
  data: Uint8Array,
  suggestedName: string
): Promise<string> {
  const dir = path.join(vaultPath, ...folder.split('/').filter(Boolean))
  assertInsideVault(vaultPath, dir)
  await ensureDir(dir)

  const ext = path.extname(suggestedName) || '.png'
  const base = sanitizeFilename(path.basename(suggestedName, ext)) || 'attachment'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  let target = path.join(dir, `${base} ${stamp}${ext}`)
  let n = 2
  while (await exists(target)) {
    target = path.join(dir, `${base} ${stamp} ${n}${ext}`)
    n++
  }

  await fs.writeFile(target, data)
  return toRelPath(vaultPath, target)
}

// ---------------------------------------------------------------- snapshots

/**
 * Keep a rolling history of each note under `.stone/snapshots`, so an
 * accidental select-all-and-type is recoverable even after autosave has run.
 * Obsidian calls this file recovery; the mechanism is the same.
 */
const MAX_SNAPSHOTS_PER_NOTE = 25

function snapshotKey(relPath: string): string {
  return crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 12)
}

export async function writeSnapshot(
  vaultPath: string,
  relPath: string,
  content: string
): Promise<void> {
  const dir = path.join(vaultPath, '.stone', 'snapshots', snapshotKey(relPath))
  await ensureDir(dir)

  // Skip when the newest snapshot is byte-identical, so a save that changed
  // nothing does not push a real earlier version out of the window.
  const existing = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md')).sort()
  const newest = existing[existing.length - 1]
  if (newest) {
    const previous = await fs.readFile(path.join(dir, newest), 'utf8').catch(() => null)
    if (previous === content) return
  }

  await fs.writeFile(path.join(dir, `${Date.now()}.md`), content, 'utf8')
  await fs.writeFile(path.join(dir, 'path'), relPath, 'utf8').catch(() => {})

  const all = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md')).sort()
  for (const stale of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS_PER_NOTE))) {
    await fs.rm(path.join(dir, stale), { force: true }).catch(() => {})
  }
}

export async function listSnapshots(
  vaultPath: string,
  relPath: string
): Promise<{ id: string; relPath: string; savedAt: number; size: number }[]> {
  const dir = path.join(vaultPath, '.stone', 'snapshots', snapshotKey(relPath))
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const out: { id: string; relPath: string; savedAt: number; size: number }[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    try {
      const st = await fs.stat(path.join(dir, name))
      out.push({
        id: name.replace(/\.md$/, ''),
        relPath,
        savedAt: Number(name.replace(/\.md$/, '')) || st.mtimeMs,
        size: st.size
      })
    } catch {
      // Ignore.
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

export async function readSnapshot(
  vaultPath: string,
  relPath: string,
  id: string
): Promise<string | null> {
  const dir = path.join(vaultPath, '.stone', 'snapshots', snapshotKey(relPath))
  // The id is a timestamp we minted; anything else must not reach the fs.
  if (!/^\d+$/.test(id)) return null
  try {
    return await fs.readFile(path.join(dir, `${id}.md`), 'utf8')
  } catch {
    return null
  }
}

// ------------------------------------------------------------ folder shuffle

export async function listFolders(vaultPath: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnored(entry.name)) continue
      const abs = path.join(dir, entry.name)
      out.push(toRelPath(vaultPath, abs))
      await visit(abs)
    }
  }
  await visit(vaultPath)
  return out.sort()
}

/** Move a file or folder inside the vault, refusing to nest a folder in itself. */
export async function movePath(
  vaultPath: string,
  fromRel: string,
  toRel: string
): Promise<string> {
  const from = toAbsPath(vaultPath, fromRel)
  const to = toAbsPath(vaultPath, toRel)
  assertInsideVault(vaultPath, from)
  assertInsideVault(vaultPath, to)

  const resolvedFrom = path.resolve(from)
  const resolvedTo = path.resolve(to)
  if (resolvedTo === resolvedFrom || resolvedTo.startsWith(resolvedFrom + path.sep)) {
    throw new Error('A folder cannot be moved inside itself.')
  }

  await ensureDir(path.dirname(to))
  if (await exists(to)) throw new Error(`"${path.basename(toRel)}" already exists there.`)
  await fs.rename(from, to)
  return toRelPath(vaultPath, to)
}

export async function removeFolder(vaultPath: string, relPath: string): Promise<void> {
  const abs = toAbsPath(vaultPath, relPath)
  assertInsideVault(vaultPath, abs)
  if (path.resolve(abs) === path.resolve(vaultPath)) {
    throw new Error('The vault root cannot be deleted.')
  }
  const trashDir = path.join(vaultPath, '.trash')
  await ensureDir(trashDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  await fs.rename(abs, path.join(trashDir, `${path.basename(relPath)} ${stamp}`))
}

export async function readBinary(absPath: string): Promise<Buffer> {
  return fs.readFile(absPath)
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Append a line to a note, creating it (with an optional header) if absent. */
export async function appendLine(
  absPath: string,
  line: string,
  createWith?: string
): Promise<void> {
  await ensureDir(path.dirname(absPath))
  if (!(await exists(absPath))) {
    await fs.writeFile(absPath, `${createWith ?? ''}${line}\n`, 'utf8')
    return
  }
  const current = await fs.readFile(absPath, 'utf8')
  const sep = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  await fs.appendFile(absPath, `${sep}${line}\n`, 'utf8')
}

/** Turn a title into a filename that is legal on both Windows and macOS. */
export function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|#^[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Untitled'
  )
}

/** Append ` 2`, ` 3`, … until the path is free. */
export async function uniquePath(dir: string, base: string): Promise<string> {
  let candidate = path.join(dir, `${base}.md`)
  let n = 2
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base} ${n}.md`)
    n++
  }
  return candidate
}

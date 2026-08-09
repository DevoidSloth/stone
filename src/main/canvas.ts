import fs from 'node:fs/promises'
import path from 'node:path'
import type { CanvasData, CanvasFile } from '@shared/types'
import { assertInsideVault, ensureDir, exists, toAbsPath } from './vault/fs'

/**
 * Canvas files.
 *
 * A `.canvas` is JSON, not markdown, so it sits outside the note index rather
 * than being bolted into it — the indexer's whole job is parsing markdown, and
 * teaching it about a second format to gain a filename in a list would be a bad
 * trade. These are read and written directly instead.
 *
 * The writes are atomic in the same way note writes are: a canvas lives in a
 * synced folder like everything else, and a half-written JSON file is worse
 * than a half-written note because it will not parse at all.
 */

const EMPTY: CanvasData = { nodes: [], edges: [] }

/** Every canvas in the vault, newest first. */
export async function listCanvases(vaultPath: string): Promise<CanvasFile[]> {
  const out: CanvasFile[] = []

  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // The same exclusions the note walk uses: Stone's own state, the trash,
        // and anything a sync client keeps to itself.
        if (entry.name.startsWith('.')) continue
        await walk(abs)
        continue
      }
      if (!entry.name.toLowerCase().endsWith('.canvas')) continue
      const stat = await fs.stat(abs).catch(() => null)
      if (!stat) continue
      out.push({
        relPath: path.relative(vaultPath, abs).split(path.sep).join('/'),
        name: entry.name.replace(/\.canvas$/i, ''),
        mtime: stat.mtimeMs
      })
    }
  }

  await walk(vaultPath)
  return out.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Read a canvas, tolerating a file that is not one.
 *
 * A malformed canvas returns empty rather than throwing, because the alternative
 * is a screen that cannot open at all — and the file is still on disk, unharmed,
 * for the user to look at.
 */
export async function readCanvas(vaultPath: string, relPath: string): Promise<CanvasData> {
  const abs = toAbsPath(vaultPath, relPath)
  assertInsideVault(vaultPath, abs)
  try {
    const parsed = JSON.parse(await fs.readFile(abs, 'utf8')) as Partial<CanvasData>
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    }
  } catch {
    return { ...EMPTY }
  }
}

export async function writeCanvas(
  vaultPath: string,
  relPath: string,
  data: CanvasData
): Promise<void> {
  const abs = toAbsPath(vaultPath, relPath)
  assertInsideVault(vaultPath, abs)
  await ensureDir(path.dirname(abs))

  const tmp = path.join(path.dirname(abs), `.stone-${process.pid}-${Date.now()}.tmp`)
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, abs)
}

export async function createCanvas(
  vaultPath: string,
  folder: string,
  name: string
): Promise<{ relPath: string }> {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Canvas'
  const dir = folder ? path.join(vaultPath, folder) : vaultPath
  assertInsideVault(vaultPath, dir)
  await ensureDir(dir)

  let candidate = path.join(dir, `${clean}.canvas`)
  let n = 2
  while (await exists(candidate)) {
    candidate = path.join(dir, `${clean} ${n}.canvas`)
    n++
  }

  await writeCanvas(vaultPath, path.relative(vaultPath, candidate).split(path.sep).join('/'), EMPTY)
  return { relPath: path.relative(vaultPath, candidate).split(path.sep).join('/') }
}

export async function deleteCanvas(vaultPath: string, relPath: string): Promise<void> {
  const abs = toAbsPath(vaultPath, relPath)
  assertInsideVault(vaultPath, abs)
  await fs.rm(abs, { force: true })
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import MiniSearch from 'minisearch'
import type { DocumentKind, LibraryDoc, LibraryFolder } from '@shared/types'
import { extractPdfText } from './lib/pdf-text'

/**
 * The document library.
 *
 * Notes are markdown and Stone owns them. Documents are not: a PDF is somebody
 * else's file, already sitting in iCloud where its own app put it. So the
 * library is a separate index rather than a second kind of note — it watches
 * folders you name, reads what it can out of each file, and makes them
 * searchable and linkable without moving or rewriting anything.
 *
 * Extraction is expensive — reading a 200MB PDF's text is not something to
 * repeat on every launch — so results are cached under `userData` and keyed on
 * the file's size and mtime. A file that has not changed is never read twice.
 *
 * iCloud is the complication that shapes the rest. A folder that has been
 * offloaded contains `.name.ext.icloud` placeholders rather than files, and the
 * bytes are simply not on the machine. Those are indexed as evicted and
 * reported as such, because silently omitting half a library is the worst
 * possible behaviour.
 */

const DOC_EXTENSIONS: Record<string, DocumentKind> = {
  '.pdf': 'pdf',
  '.epub': 'epub'
}

/** iCloud's placeholder for a file whose contents have been evicted. */
const PLACEHOLDER_RE = /^\.(.+)\.icloud$/

interface CacheEntry {
  /** Size and mtime, which together are enough to notice a change. */
  stamp: string
  text: string
  pageCount: number | null
  warning: string | null
}

interface Extracted {
  text: string
  pageCount: number | null
  warning: string | null
}

/**
 * True for an iCloud file whose contents are not on this machine.
 *
 * This matters more than it sounds. macOS materialises a dataless file on first
 * read, transparently and *synchronously* — opening one during a scan blocks
 * until the download finishes, which on a folder of documents means the app
 * hangs for minutes and then fills the disk. Measured on a real library: two
 * minutes for a single 13MB file.
 *
 * `st_blocks` is the tell. A dataless file reports its full logical size but
 * has no blocks allocated, and Node surfaces that on `Stats.blocks` — so the
 * check costs nothing and, crucially, never touches the file's contents.
 */
function isDataless(stat: import('node:fs').Stats): boolean {
  return stat.size > 0 && stat.blocks === 0
}

let cache = new Map<string, CacheEntry>()
let docs: LibraryDoc[] = []
let index: MiniSearch<{ id: string; name: string; body: string }> | null = null

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'library-cache.json')
}

export async function loadCache(): Promise<void> {
  try {
    const raw = await fs.readFile(cacheFile(), 'utf8')
    cache = new Map(Object.entries(JSON.parse(raw) as Record<string, CacheEntry>))
  } catch {
    cache = new Map()
  }
}

async function saveCache(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cacheFile()), { recursive: true })
    await fs.writeFile(cacheFile(), JSON.stringify(Object.fromEntries(cache)), 'utf8')
  } catch {
    // A cache that cannot be written costs time on next launch, nothing more.
  }
}

function kindOf(name: string): DocumentKind | null {
  return DOC_EXTENSIONS[path.extname(name).toLowerCase()] ?? null
}

async function extract(absPath: string, kind: DocumentKind): Promise<Extracted> {
  if (kind === 'pdf') {
    const data = await fs.readFile(absPath)
    const pdf = extractPdfText(data)
    return {
      text: pdf.text,
      pageCount: pdf.pages || null,
      warning: pdf.text
        ? null
        : 'No text could be read from this PDF — it is probably scanned. It is searchable by name only.'
    }
  }

  return { text: '', pageCount: null, warning: null }
}

/** Walk one watched folder, skipping the places nothing useful ever lives. */
async function walk(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const out: string[] = []
  for (const entry of entries) {
    const abs = path.join(root, entry.name)

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      out.push(...(await walk(abs, depth + 1)))
      continue
    }

    if (PLACEHOLDER_RE.test(entry.name)) {
      const real = PLACEHOLDER_RE.exec(entry.name)![1]
      if (kindOf(real)) out.push(path.join(root, real))
      continue
    }

    if (kindOf(entry.name)) out.push(abs)
  }
  return out
}

export async function scanLibrary(folders: LibraryFolder[]): Promise<LibraryDoc[]> {
  const found: LibraryDoc[] = []
  let cacheDirty = false

  for (const folder of folders) {
    for (const absPath of await walk(folder.path)) {
      const kind = kindOf(absPath)
      if (!kind) continue

      let stat: import('node:fs').Stats | null = null
      try {
        stat = await fs.stat(absPath)
      } catch {
        stat = null
      }

      const dir = path.dirname(path.relative(folder.path, absPath))
      const folderPath = dir === '.' || dir.startsWith('..') ? '' : dir.split(path.sep).join('/')

      // Either the placeholder is all that exists, or the file is dataless —
      // present in the listing, but with its contents still in iCloud. Both are
      // listed and neither is opened: reading one would block the whole scan
      // while macOS downloads it.
      if (!stat || isDataless(stat)) {
        const cached = stat ? cache.get(absPath) : undefined
        found.push({
          id: absPath,
          path: absPath,
          name: path.basename(absPath, path.extname(absPath)),
          kind,
          folderId: folder.id,
          relPath: null,
          folderPath,
          size: stat?.size ?? 0,
          mtime: stat?.mtimeMs ?? 0,
          // Anything read before it was evicted is still worth showing.
          pageCount: cached?.pageCount ?? null,
          evicted: true,
          warning:
            'Not downloaded from iCloud. Open it once on this Mac, or use Download, to read it.',
          hasText: (cached?.text.length ?? 0) > 0,
          renderable: false
        })
        continue
      }

      const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`
      let entry = cache.get(absPath)

      if (!entry || entry.stamp !== stamp) {
        try {
          const extracted = await extract(absPath, kind)
          entry = { stamp, ...extracted }
        } catch (err) {
          entry = {
            stamp,
            text: '',
            pageCount: null,
            warning: (err as Error).message
          }
        }
        cache.set(absPath, entry)
        cacheDirty = true
      }

      found.push({
        id: absPath,
        path: absPath,
        name: path.basename(absPath, path.extname(absPath)),
        kind,
        folderId: folder.id,
        relPath: null,
        folderPath,
        size: stat.size,
        mtime: stat.mtimeMs,
        pageCount: entry.pageCount,
        evicted: false,
        warning: entry.warning,
        hasText: entry.text.length > 0,
        renderable: kind === 'pdf'
      })
    }
  }

  if (cacheDirty) await saveCache()

  docs = found.sort((a, b) => b.mtime - a.mtime)
  rebuildIndex()
  return docs
}

function rebuildIndex(): void {
  index = new MiniSearch({
    fields: ['name', 'body'],
    storeFields: ['id'],
    searchOptions: { boost: { name: 3 }, prefix: true, fuzzy: 0.2 }
  })
  index.addAll(
    docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      body: cache.get(doc.id)?.text ?? ''
    }))
  )
}

export function listDocuments(): LibraryDoc[] {
  return docs
}

export function documentText(id: string): string {
  return cache.get(id)?.text ?? ''
}

/**
 * The file to point a viewer at.
 *
 * A PDF renders from where it lies. Anything else is listed and searchable by
 * name, but there is nothing here that can draw it.
 */
export async function renderablePath(id: string): Promise<string | null> {
  const doc = docs.find((d) => d.id === id)
  if (!doc || doc.evicted || doc.kind !== 'pdf') return null
  return doc.path
}

/**
 * Pull an evicted file down from iCloud, on request.
 *
 * `fs.open` is what triggers materialisation, and it is deliberately only ever
 * called from here — never from a scan — so the block happens when the user
 * asked for this one document and is waiting for it.
 */
export async function downloadDocument(absPath: string): Promise<void> {
  const handle = await fs.open(absPath, 'r')
  try {
    // One byte is enough to make macOS fetch the whole file.
    await handle.read(Buffer.alloc(1), 0, 1, 0)
  } finally {
    await handle.close()
  }
}

export interface DocHit {
  doc: LibraryDoc
  score: number
  /** A line of context around the first match, when the text held one. */
  excerpt: string
}

export function searchDocuments(query: string, limit = 30): DocHit[] {
  if (!index || !query.trim()) return []
  const byId = new Map(docs.map((d) => [d.id, d]))

  return index
    .search(query, { prefix: true, fuzzy: 0.2 })
    .slice(0, limit)
    .flatMap((result) => {
      const doc = byId.get(result.id as string)
      if (!doc) return []
      const text = cache.get(doc.id)?.text ?? ''
      const needle = query.trim().split(/\s+/)[0].toLowerCase()
      const at = text.toLowerCase().indexOf(needle)
      const excerpt =
        at === -1
          ? text.slice(0, 160)
          : text.slice(Math.max(0, at - 60), Math.min(text.length, at + 120))
      return [{ doc, score: result.score, excerpt: excerpt.replace(/\s+/g, ' ').trim() }]
    })
}

/**
 * Copy a document into the vault.
 *
 * Used by `copy` folders and by an explicit import. The file keeps its name
 * unless that would collide, because the name is how the user will look for it.
 */
export async function importDocument(
  vaultPath: string,
  attachmentsFolder: string,
  absPath: string
): Promise<{ relPath: string }> {
  const dir = path.join(vaultPath, attachmentsFolder)
  await fs.mkdir(dir, { recursive: true })

  const ext = path.extname(absPath)
  const base = path.basename(absPath, ext)
  let target = path.join(dir, `${base}${ext}`)
  let n = 2
  while (
    await fs
      .access(target)
      .then(() => true)
      .catch(() => false)
  ) {
    target = path.join(dir, `${base} ${n}${ext}`)
    n++
  }

  await fs.copyFile(absPath, target)
  return { relPath: path.relative(vaultPath, target).split(path.sep).join('/') }
}

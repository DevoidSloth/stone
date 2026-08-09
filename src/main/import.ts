import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { ensureDir, sanitizeFilename, uniquePath } from './vault/fs'
import { htmlToMarkdown as convertHtml } from './html-markdown'

/**
 * Importers.
 *
 * Adoption depends on these more than on any feature — a vault you have to
 * retype is a vault nobody moves to. Each importer's job is the same: get the
 * content in as markdown Stone already understands, and convert the source's
 * idea of metadata into frontmatter and Stone's task tokens.
 *
 * Nothing here writes outside the chosen destination folder, and every file is
 * read defensively: a single malformed export must not abort the run.
 */

export type ImportKind = 'notion' | 'evernote' | 'appleNotes' | 'markdown'

export interface ImportResult {
  imported: number
  skipped: number
  folder: string
  warnings: string[]
}

/** Notion exports append a 32-character hash to every file and folder name. */
const NOTION_HASH_RE = /\s+[0-9a-f]{32}(?=$|\.)/i

function stripNotionHash(name: string): string {
  return name.replace(NOTION_HASH_RE, '')
}

async function walk(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  async function visit(current: string): Promise<void> {
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(abs)
      else if (entry.isFile() && match(entry.name)) out.push(abs)
    }
  }
  await visit(dir)
  return out
}

/**
 * Notion's markdown export is already markdown, but its conventions differ:
 * a leading `# Title` duplicating the filename, a `Property: value` block under
 * it instead of frontmatter, and hashed filenames that break every link.
 */
function convertNotionNote(raw: string, title: string): string {
  const lines = raw.split(/\r?\n/)
  let cursor = 0

  // Drop the H1 that repeats the filename.
  while (cursor < lines.length && !lines[cursor].trim()) cursor++
  if (cursor < lines.length && lines[cursor].startsWith('# ')) {
    const heading = lines[cursor].slice(2).trim()
    if (heading.toLowerCase() === title.toLowerCase()) cursor++
  }

  // Notion writes properties as `Key: value` lines directly beneath the title.
  const props: string[] = []
  let scan = cursor
  while (scan < lines.length && !lines[scan].trim()) scan++
  while (scan < lines.length) {
    const line = lines[scan]
    if (!line.trim()) break
    const prop = /^([A-Za-z][A-Za-z0-9 _-]{0,40}):\s*(.*)$/.exec(line)
    if (!prop) break
    const key = prop[1].trim().toLowerCase().replace(/\s+/g, '-')
    const value = prop[2].trim()
    if (value) props.push(`${key}: ${quoteIfNeeded(value)}`)
    scan++
  }
  if (props.length > 0) cursor = scan

  let body = lines.slice(cursor).join('\n').trimStart()

  // Rewrite Notion's hashed relative links into wikilinks.
  body = body.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/g, (_whole, label: string, href: string) => {
    const target = stripNotionHash(decodeURIComponent(path.basename(href, '.md')))
    return label === target ? `[[${target}]]` : `[[${target}|${label}]]`
  })

  // Notion's todo blocks are already `- [ ]`, but its checked form uses `[x]`
  // with a leading bullet character on some exports.
  body = body.replace(/^\s*[•‣]\s*\[( |x)\]/gim, (m) => m.replace(/[•‣]\s*/, '- '))

  const frontmatter = props.length > 0 ? `---\n${props.join('\n')}\n---\n\n` : ''
  return `${frontmatter}${body}\n`
}

function quoteIfNeeded(value: string): string {
  return /^[\d.]+$/.test(value) || /[:#[\]{},]/.test(value) ? `"${value.replace(/"/g, "'")}"` : value
}

/** Strip HTML to text, preserving paragraph and list structure. */
function htmlToMarkdown(html: string): string {
  return convertHtml(html, { evernoteTodos: true })
}

/** Evernote `.enex` is XML holding one `<note>` per exported note. */
function parseEnex(xml: string): { title: string; body: string; created: string | null; tags: string[] }[] {
  const notes: { title: string; body: string; created: string | null; tags: string[] }[] = []
  const noteRe = /<note>([\s\S]*?)<\/note>/g
  let m: RegExpExecArray | null

  while ((m = noteRe.exec(xml)) !== null) {
    const block = m[1]
    const title = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1]?.trim() ?? 'Untitled'
    const content = /<content>([\s\S]*?)<\/content>/.exec(block)?.[1] ?? ''
    const created = /<created>(\d{8})T/.exec(block)?.[1] ?? null
    const tags = [...block.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map((t) => t[1].trim())

    const inner = content.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')
    notes.push({
      title: decodeEntities(title),
      body: htmlToMarkdown(inner),
      created: created ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}` : null,
      tags: tags.map((t) => t.replace(/\s+/g, '-'))
    })
  }
  return notes
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function chooseSource(kind: ImportKind): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const wantsFile = kind === 'evernote'
  const options: Electron.OpenDialogOptions = wantsFile
    ? {
        title: 'Choose an Evernote export',
        properties: ['openFile'],
        filters: [{ name: 'Evernote export', extensions: ['enex'] }]
      }
    : {
        title:
          kind === 'notion'
            ? 'Choose the unzipped Notion export folder'
            : kind === 'appleNotes'
              ? 'Choose the exported Apple Notes folder'
              : 'Choose a folder of markdown files',
        properties: ['openDirectory'],
        buttonLabel: 'Import from here'
      }

  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/**
 * Run an import into `<vault>/<destination>`. Attachments referenced by the
 * source are copied alongside so images survive the move.
 */
export async function runImport(
  kind: ImportKind,
  vaultPath: string,
  destination: string,
  attachmentsFolder: string
): Promise<ImportResult | null> {
  const source = await chooseSource(kind)
  if (!source) return null

  const targetDir = path.join(vaultPath, ...destination.split('/').filter(Boolean))
  await ensureDir(targetDir)

  const warnings: string[] = []
  let imported = 0
  let skipped = 0

  const write = async (title: string, body: string): Promise<void> => {
    const absPath = await uniquePath(targetDir, sanitizeFilename(title))
    await fs.writeFile(absPath, body, 'utf8')
    imported++
  }

  if (kind === 'evernote') {
    let xml: string
    try {
      xml = await fs.readFile(source, 'utf8')
    } catch {
      return { imported: 0, skipped: 0, folder: destination, warnings: ['That export could not be read.'] }
    }
    for (const note of parseEnex(xml)) {
      const front: string[] = []
      if (note.created) front.push(`date: ${note.created}`)
      if (note.tags.length > 0) front.push(`tags: [${note.tags.join(', ')}]`)
      const body = front.length > 0 ? `---\n${front.join('\n')}\n---\n\n${note.body}\n` : `${note.body}\n`
      await write(note.title, body)
    }
    return { imported, skipped, folder: destination, warnings }
  }

  const files = await walk(source, (name) =>
    /\.(md|markdown|txt|html?|csv)$/i.test(name)
  )
  if (files.length === 0) {
    return {
      imported: 0,
      skipped: 0,
      folder: destination,
      warnings: ['No importable files were found in that folder.']
    }
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    // Notion ships a CSV beside every database; the pages themselves carry the
    // same rows, so importing both would duplicate everything.
    if (ext === '.csv') {
      skipped++
      continue
    }

    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      skipped++
      warnings.push(`Could not read ${path.basename(file)}.`)
      continue
    }

    const title = stripNotionHash(path.basename(file, ext)).trim() || 'Untitled'
    let body: string
    if (ext === '.html' || ext === '.htm') body = `${htmlToMarkdown(raw)}\n`
    else if (kind === 'notion') body = convertNotionNote(raw, title)
    else body = raw.endsWith('\n') ? raw : `${raw}\n`

    await write(title, body)
  }

  // Copy any images the export carried, so the links keep working.
  const assets = await walk(source, (name) => /\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(name))
  if (assets.length > 0) {
    const assetDir = path.join(vaultPath, ...attachmentsFolder.split('/').filter(Boolean))
    await ensureDir(assetDir)
    for (const asset of assets) {
      try {
        await fs.copyFile(asset, path.join(assetDir, stripNotionHash(path.basename(asset))))
      } catch {
        warnings.push(`Could not copy ${path.basename(asset)}.`)
      }
    }
  }

  return { imported, skipped, folder: destination, warnings }
}

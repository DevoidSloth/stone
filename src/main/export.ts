import { BrowserWindow, app, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { markdownToHtml, escapeHtml, stripFrontmatter } from '@shared/markdown-html'
import { MARKER_RE } from '@shared/print-markers'
import type { Note, PdfExportOptions, PrintPayload } from '@shared/types'
import { pathToFileURL } from 'node:url'
import { pageTexts } from './lib/pdf-pages'
import { renderToPdf } from './print'
import { loadSettings } from './settings'

/**
 * Export.
 *
 * Markdown is already the storage format, so exporting it is a copy. HTML and
 * PDF need the note rendered, and the rendering itself lives in two other
 * places: `@shared/markdown-html` turns markdown into HTML, and the print
 * window turns that HTML into pages. What is left here is the part that is
 * genuinely about exporting — where the file goes, what paper it is for, and
 * how the contents page learns its page numbers.
 *
 * Rendering deliberately does not depend on which note is open, or on the
 * editor's live-preview decorations. An export reads the vault.
 */

/** A small sheet for the standalone HTML export, which has no app around it. */
const HTML_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 48px 32px; max-width: 46rem;
    font: 16px/1.6 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #37352f; background: #fff;
  }
  h1 { font-size: 2.2rem; letter-spacing: -0.02em; margin: 0 0 .3em; }
  h2 { font-size: 1.45rem; letter-spacing: -0.015em; margin: 1.6em 0 .35em; }
  h3 { font-size: 1.15rem; margin: 1.4em 0 .3em; }
  h4, h5, h6 { font-size: 1rem; margin: 1.2em 0 .3em; }
  p, li { margin: 0 0 .55em; }
  ul, ol { padding-left: 1.4em; margin: 0 0 .8em; }
  li.task { list-style: none; }
  li.task--done { color: rgb(55 53 47 / 45%); text-decoration: line-through; }
  .task__box { display: inline-block; width: .8em; height: .8em; margin-right: .4em;
               border: 1px solid rgb(55 53 47 / 36%); border-radius: 2px; }
  .task__box--done { background: rgb(55 53 47 / 65%); }
  code { background: #f4f4f2; border-radius: 3px; padding: .12em .3em; font-size: .88em;
         font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  pre { background: #f7f7f5; border: 1px solid rgb(55 53 47 / 9%); border-radius: 6px;
        padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0 0 .8em; padding-left: 14px; border-left: 3px solid rgb(55 53 47 / 16%);
               color: rgb(55 53 47 / 72%); }
  .callout { background: #f7f7f5; border-left: 3px solid rgb(55 53 47 / 24%);
             border-radius: 0 4px 4px 0; padding: 8px 12px; margin: 0 0 .9em; }
  .callout p:last-child { margin-bottom: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: .94em; }
  th, td { border: 1px solid rgb(55 53 47 / 14%); padding: 6px 10px; text-align: left; }
  th { background: #f7f7f5; font-weight: 600; }
  hr { border: 0; border-top: 1px solid rgb(55 53 47 / 14%); margin: 1.6em 0; }
  img { max-width: 100%; }
  a { color: #337ea9; }
  figure { margin: 1.2em 0; text-align: center; }
  figure figcaption { font-size: .78rem; color: rgb(55 53 47 / 55%); margin-top: .4em; }
  .md-pdf img { border: 1px solid rgb(55 53 47 / 14%); }
  .md-media { max-width: 100%; }
  .wikilink { color: #337ea9; border-bottom: 1px solid rgb(51 126 169 / 30%); }
  .md-embed { border-left: 2px solid rgb(55 53 47 / 14%); padding-left: 14px; }
  .md-embed__from { font-size: .74rem; text-transform: uppercase; letter-spacing: .06em;
                    color: rgb(55 53 47 / 50%); margin: 0 0 .4em; }
  .md-math--block { text-align: center; margin: 1em 0; }
  .meta { color: rgb(55 53 47 / 50%); font-size: .82rem; margin: 0 0 2em; }
  @page { margin: 18mm; }
`

/**
 * An exported HTML file is one file, so the pictures have to travel inside it.
 *
 * A `src` pointing at the vault would work on this machine until the note was
 * moved or sent to anyone, which is the only reason to export HTML in the first
 * place. Images are inlined as data URIs; anything larger than the cap, and
 * anything that is not an image, keeps a `file://` URL that at least opens
 * locally rather than bloating the document to no purpose.
 */
const MAX_INLINE_BYTES = 8 * 1024 * 1024

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

async function inlineAsset(vaultPath: string, relPath: string): Promise<string> {
  const absolute = path.resolve(vaultPath, ...relPath.split('/'))
  const local = pathToFileURL(absolute).toString()
  const mime = MIME[path.extname(absolute).toLowerCase()]
  if (!mime) return local
  try {
    const stat = await fs.stat(absolute)
    if (stat.size > MAX_INLINE_BYTES) return local
    const data = await fs.readFile(absolute)
    return `data:${mime};base64,${data.toString('base64')}`
  } catch {
    return local
  }
}

export async function noteToHtmlDocument(note: Note): Promise<string> {
  const edited = new Date(note.mtime).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const settings = await loadSettings()
  const attachmentsFolder = settings.attachmentsFolder

  // Two passes, because reading a file is asynchronous and `resolveUrl` is not.
  // The first learns which assets the note refers to; the second renders with
  // them already read. Rendering twice costs nothing next to the file reads.
  const wanted = new Set<string>()
  markdownToHtml(note.content, {
    attachmentsFolder,
    resolveUrl: (relPath) => {
      wanted.add(relPath)
      return relPath
    }
  })

  const resolved = new Map<string, string>()
  if (settings.vaultPath) {
    for (const relPath of wanted) {
      resolved.set(relPath, await inlineAsset(settings.vaultPath, relPath))
    }
  }

  const { html } = markdownToHtml(note.content, {
    attachmentsFolder,
    resolveUrl: (relPath) => resolved.get(relPath) ?? relPath
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(note.title)}</title>
<style>${HTML_CSS}</style>
</head>
<body>
<h1>${note.icon ? `${escapeHtml(note.icon)} ` : ''}${escapeHtml(note.title)}</h1>
<p class="meta">${escapeHtml(note.relPath)} · edited ${escapeHtml(edited)}</p>
${html}
</body>
</html>`
}

async function askWhereToSave(
  defaultName: string,
  filters: Electron.FileFilter[]
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: 'Export',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export async function exportMarkdown(note: Note): Promise<string | null> {
  const target = await askWhereToSave(`${note.title}.md`, [
    { name: 'Markdown', extensions: ['md'] }
  ])
  if (!target) return null
  await fs.writeFile(target, note.content, 'utf8')
  return target
}

export async function exportHtml(note: Note): Promise<string | null> {
  const target = await askWhereToSave(`${note.title}.html`, [
    { name: 'HTML', extensions: ['html'] }
  ])
  if (!target) return null
  await fs.writeFile(target, await noteToHtmlDocument(note), 'utf8')
  return target
}

/** Millimetres to inches, which is the only unit `printToPDF` margins speak. */
const MM_PER_INCH = 25.4

/**
 * Where each heading marker ended up, or `null` if the answer is not credible.
 *
 * Page attribution is read back out of the PDF, which is a best-effort business
 * — so the result is checked before it is trusted: every heading accounted for,
 * numbered contiguously from zero, and running forwards through the document.
 * A contents page with no numbers is a small disappointment; one with wrong
 * numbers is a bug the reader discovers on someone else's desk.
 */
async function pagesForMarkers(
  pdf: Buffer,
  headingCount: number
): Promise<Record<number, number> | null> {
  if (headingCount === 0) return null

  let pages: string[]
  try {
    pages = await pageTexts(pdf)
  } catch {
    // The document is already rendered and correct; only the numbers are at
    // stake, so a reader that cannot read it back costs the numbers and
    // nothing else.
    return null
  }
  if (pages.length === 0) return null

  const found: Record<number, number> = {}
  pages.forEach((text, index) => {
    for (const match of text.matchAll(MARKER_RE)) {
      const heading = Number(match[1])
      if (found[heading] === undefined) found[heading] = index + 1
    }
  })

  const seen = Object.keys(found).map(Number).sort((a, b) => a - b)
  if (seen.length !== headingCount) return null
  if (seen.some((heading, i) => heading !== i)) return null
  // Headings appear in document order, so their pages must not go backwards.
  for (let i = 1; i < headingCount; i++) {
    if (found[i] < found[i - 1]) return null
  }
  return found
}

/**
 * Render to PDF through the hidden print window.
 *
 * Two passes, when there is a contents page to number. Chromium supports
 * neither `target-counter()` nor page-margin boxes, so the only way to know
 * which page a heading landed on is to lay the document out and look. The first
 * pass draws the contents with fixed-width placeholders — so the second pass
 * paginates identically — and stamps an invisible marker beside each heading;
 * the second pass draws the real numbers in their place.
 *
 * If the markers cannot be read back, the first pass is what gets saved. It is
 * a complete document either way; only the page numbers are missing.
 */
export async function exportPdf(note: Note, options: PdfExportOptions): Promise<string | null> {
  const target = await askWhereToSave(`${note.title}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
  if (!target) return null

  const pdf = await renderPdf(note, options)
  await fs.writeFile(target, pdf)
  return target
}

async function renderPdf(note: Note, options: PdfExportOptions): Promise<Buffer> {
  const payload = await buildPayload(note, options)
  const print = printer(note.title, options)

  const first = await renderToPdf(payload, print)
  if (!options.toc) return first.pdf

  const pages = await pagesForMarkers(first.pdf, first.headings.length)
  if (!pages) return first.pdf

  const pageNumbers: Record<string, number> = {}
  first.headings.forEach((heading, i) => {
    if (pages[i] !== undefined) pageNumbers[heading.id] = pages[i]
  })

  const second = await renderToPdf({ ...payload, pageNumbers }, print)
  return second.pdf
}

/**
 * The `printToPDF` call, with the page furniture.
 *
 * The header and footer land on every page, the cover included. Chromium draws
 * them into the printer's margin box and offers no way to address one page, so
 * short of printing the cover separately and joining two PDFs — which needs a
 * PDF writer this app does not carry — a title line on the cover is the cost of
 * having page numbers on the other forty.
 */
function printer(
  title: string,
  options: PdfExportOptions
): (contents: Electron.WebContents) => Promise<Buffer> {
  const inches = options.margin / MM_PER_INCH
  // Templates inherit nothing from the page, down to the font size — left
  // unset, Chromium renders them at a default that is far too small to read.
  const chrome = `
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 8px; color: #8a8880; width: 100%;
    padding: 0 ${options.margin}mm;
  `
  return (contents) =>
    contents.printToPDF({
      printBackground: true,
      pageSize: options.pageSize,
      margins: {
        top: inches,
        bottom: inches,
        left: inches,
        right: inches
      },
      displayHeaderFooter: options.headerFooter,
      headerTemplate: `<div style="${chrome} text-align: right;">${escapeHtml(title)}</div>`,
      footerTemplate: `<div style="${chrome} text-align: center;"><span class="pageNumber"></span></div>`,
      // Real sidebar bookmarks, built from the document's headings.
      generateDocumentOutline: true
    })
}

/**
 * Everything the print window needs, resolved here.
 *
 * Embeds are pulled in main because only main can see the vault — the print
 * window is given the markdown it needs and no way to ask for more.
 */
async function buildPayload(note: Note, options: PdfExportOptions): Promise<PrintPayload> {
  const frontmatter = note.frontmatter as Record<string, unknown>
  const subtitle = frontmatter.subtitle ?? frontmatter.description ?? frontmatter.summary

  return {
    title: note.title,
    icon: note.icon,
    relPath: note.relPath,
    markdown: note.content,
    embeds: await resolveEmbeds(note),
    attachmentsFolder: (await loadSettings()).attachmentsFolder,
    subtitle: typeof subtitle === 'string' && subtitle.trim() ? subtitle.trim() : null,
    author: options.author || (typeof frontmatter.author === 'string' ? frontmatter.author : ''),
    vaultName: vaultLabel(),
    edited: new Date(note.mtime).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    options
  }
}

/** Set by `registerIpc`, which owns the vault this module must not import. */
let embedSource: ((target: string) => Promise<string | null>) | null = null
let vaultLabel: () => string = () => 'Stone'

export function configureExport(deps: {
  readEmbed: (target: string) => Promise<string | null>
  vaultName: () => string
}): void {
  embedSource = deps.readEmbed
  vaultLabel = deps.vaultName
}

async function resolveEmbeds(note: Note): Promise<Record<string, string>> {
  if (!embedSource) return {}
  const out: Record<string, string> = {}
  for (const target of note.embeds) {
    const key = target.split('#')[0]
    if (out[key] !== undefined) continue
    const content = await embedSource(key)
    if (content !== null) out[key] = stripFrontmatter(content)
  }
  return out
}

/** Export the whole vault as a folder of markdown, preserving the tree. */
export async function exportVault(
  vaultPath: string,
  notes: { relPath: string; path: string }[]
): Promise<{ folder: string; count: number } | null> {
  const win = BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Choose a folder to export into',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export here'
      })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null

  const stamp = new Date().toISOString().slice(0, 10)
  const folder = path.join(result.filePaths[0], `${path.basename(vaultPath)} ${stamp}`)
  await fs.mkdir(folder, { recursive: true })

  let count = 0
  for (const note of notes) {
    const target = path.join(folder, ...note.relPath.split('/'))
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(note.path, target)
      count++
    } catch {
      // One unreadable note should not abandon the rest of the export.
    }
  }
  return { folder, count }
}

export async function revealExport(filePath: string): Promise<void> {
  shell.showItemInFolder(filePath)
}

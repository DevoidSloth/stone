import { BrowserWindow, app, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Note } from '@shared/types'

/**
 * Export.
 *
 * Markdown is already the storage format, so exporting it is a copy. HTML and
 * PDF need the note rendered, and that rendering happens here in main using an
 * offscreen window rather than in the renderer, so an export never depends on
 * which note happens to be open or on the editor's live-preview decorations.
 *
 * The markdown-to-HTML pass is deliberately small: this is for printing a note,
 * not for publishing a site, and a full CommonMark implementation in main would
 * be a second parser to keep in step with the editor's.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '<em>[embedded: $1]</em>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      `<span class="wikilink">${alias ?? target}</span>`
    )
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
}

/** Render a subset of markdown to HTML — enough for a faithful printed page. */
export function markdownToHtml(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split(/\r?\n/)
  const out: string[] = []

  let inFence = false
  let listKind: 'ul' | 'ol' | null = null
  let inQuote = false
  let tableRows: string[][] = []

  const closeList = (): void => {
    if (listKind) {
      out.push(`</${listKind}>`)
      listKind = null
    }
  }
  const closeQuote = (): void => {
    if (inQuote) {
      out.push('</blockquote>')
      inQuote = false
    }
  }
  const flushTable = (): void => {
    if (tableRows.length === 0) return
    const [head, ...rest] = tableRows
    out.push('<table><thead><tr>')
    for (const cell of head) out.push(`<th>${inline(cell)}</th>`)
    out.push('</tr></thead><tbody>')
    for (const row of rest) {
      out.push('<tr>')
      for (const cell of row) out.push(`<td>${inline(cell)}</td>`)
      out.push('</tr>')
    }
    out.push('</tbody></table>')
    tableRows = []
  }

  for (const line of lines) {
    const fence = /^\s*(```|~~~)(.*)$/.exec(line)
    if (fence) {
      if (inFence) {
        out.push('</code></pre>')
        inFence = false
      } else {
        closeList()
        closeQuote()
        flushTable()
        out.push(`<pre><code class="lang-${escapeHtml(fence[2].trim())}">`)
        inFence = true
      }
      continue
    }
    if (inFence) {
      out.push(escapeHtml(line))
      continue
    }

    // Tables: a row of pipes, with the alignment row dropped.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) tableRows.push(cells)
      continue
    }
    flushTable()

    if (!line.trim()) {
      closeList()
      closeQuote()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      closeQuote()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      closeList()
      closeQuote()
      out.push('<hr />')
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      if (!inQuote) {
        out.push('<blockquote>')
        inQuote = true
      }
      const callout = /^\[!(\w+)\]\s*(.*)$/.exec(quote[1])
      out.push(
        callout
          ? `<p class="callout callout--${callout[1].toLowerCase()}"><strong>${inline(callout[2] || callout[1])}</strong></p>`
          : `<p>${inline(quote[1])}</p>`
      )
      continue
    }
    closeQuote()

    const task = /^(\s*)[-*+]\s+\[([ xX/-])\]\s+(.*)$/.exec(line)
    if (task) {
      if (listKind !== 'ul') {
        closeList()
        out.push('<ul class="tasks">')
        listKind = 'ul'
      }
      const done = task[2].toLowerCase() === 'x'
      out.push(
        `<li class="task${done ? ' task--done' : ''}"><input type="checkbox" disabled${done ? ' checked' : ''} /> ${inline(task[3])}</li>`
      )
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (listKind !== 'ul') {
        closeList()
        out.push('<ul>')
        listKind = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      if (listKind !== 'ol') {
        closeList()
        out.push('<ol>')
        listKind = 'ol'
      }
      out.push(`<li>${inline(numbered[1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  if (inFence) out.push('</code></pre>')
  flushTable()
  closeList()
  closeQuote()
  return out.join('\n')
}

/** Print stylesheet, matching the app's measure and warm greys. */
const PAGE_CSS = `
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
  ul.tasks { list-style: none; padding-left: .2em; }
  li.task--done { color: rgb(55 53 47 / 45%); text-decoration: line-through; }
  code { background: #f4f4f2; border-radius: 3px; padding: .12em .3em; font-size: .88em;
         font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  pre { background: #f7f7f5; border: 1px solid rgb(55 53 47 / 9%); border-radius: 6px;
        padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0 0 .8em; padding-left: 14px; border-left: 3px solid rgb(55 53 47 / 16%);
               color: rgb(55 53 47 / 72%); }
  .callout { background: #f7f7f5; border-radius: 4px; padding: 8px 12px; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: .94em; }
  th, td { border: 1px solid rgb(55 53 47 / 14%); padding: 6px 10px; text-align: left; }
  th { background: #f7f7f5; font-weight: 600; }
  hr { border: 0; border-top: 1px solid rgb(55 53 47 / 14%); margin: 1.6em 0; }
  img { max-width: 100%; }
  a { color: #337ea9; }
  .wikilink { color: #337ea9; border-bottom: 1px solid rgb(51 126 169 / 30%); }
  .meta { color: rgb(55 53 47 / 50%); font-size: .82rem; margin: 0 0 2em; }
  @page { margin: 18mm; }
`

export function noteToHtmlDocument(note: Note): string {
  const edited = new Date(note.mtime).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(note.title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<h1>${note.icon ? `${escapeHtml(note.icon)} ` : ''}${escapeHtml(note.title)}</h1>
<p class="meta">${escapeHtml(note.relPath)} · edited ${escapeHtml(edited)}</p>
${markdownToHtml(note.content)}
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
  await fs.writeFile(target, noteToHtmlDocument(note), 'utf8')
  return target
}

/**
 * Render to PDF through an offscreen BrowserWindow.
 *
 * The window loads a data URL, which keeps it from touching the filesystem or
 * the network — the same posture the main renderer runs under.
 */
export async function exportPdf(note: Note): Promise<string | null> {
  const target = await askWhereToSave(`${note.title}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
  if (!target) return null

  const printer = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    const html = noteToHtmlDocument(note)
    await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await printer.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' },
      pageSize: 'A4'
    })
    await fs.writeFile(target, pdf)
    return target
  } finally {
    printer.destroy()
  }
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

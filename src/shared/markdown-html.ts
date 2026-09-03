/**
 * Markdown to HTML, for print and for exported HTML.
 *
 * This lives in `@shared` because two places need it and they must not drift:
 * `main`'s HTML export, which writes the string straight to disk, and the print
 * window, which takes the same string and upgrades the pieces that need a real
 * browser — math, diagrams, syntax highlighting.
 *
 * It is deliberately a subset, not a CommonMark implementation. The editor
 * parses markdown with Lezer and never rewrites the document; a second full
 * parser here would be a second thing to keep in step. What it does cover is
 * everything the editor draws a widget for, because anything it drops is
 * something the user can see on screen and cannot find in the PDF.
 *
 * The pattern for the browser-dependent parts is the same throughout: emit
 * semantic markup carrying the source in a `data-` attribute, with a readable
 * fallback inside it. A consumer that can do better replaces the contents; one
 * that cannot still prints something honest.
 */

import { alignmentsOf, splitRow, TABLE_RULE_RE, type CellAlign } from './table-model'

import { assetPathOf, isExternalUrl, parseEmbed, type EmbedSpec } from './attachments'
import { vizKind } from './viz-langs'

export interface Heading {
  level: number
  text: string
  id: string
}

export interface MarkdownOptions {
  /**
   * Turns a vault-relative asset path into something the consumer can load.
   * Left alone when absent, which is what the HTML export wants.
   */
  resolveUrl?: (relPath: string) => string
  /**
   * Where a bare filename lives. `![[shot.png]]` is not a path — paste and drop
   * put the file in this folder, and without it the export looks for the image
   * at the vault root and finds nothing.
   */
  attachmentsFolder?: string
  /**
   * Markdown for `![[note]]` embeds, keyed by the target as written. Resolved
   * by the caller, since only main can see the vault.
   */
  embeds?: Record<string, string>
  /** Guards against an embed cycle. Internal. */
  depth?: number
}

export interface MarkdownResult {
  html: string
  headings: Heading[]
}

const MAX_EMBED_DEPTH = 3

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Strip a leading YAML frontmatter block. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/** A stable, readable anchor for a heading, unique within one document. */
function slugify(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[`*_~[\]()$]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

/**
 * An embed's URL, given the options in force.
 *
 * The attachments-folder rule has to match the editor's or an image that draws
 * on screen goes missing the moment the note is printed.
 */
function assetUrl(target: string, options: MarkdownOptions): string {
  if (isExternalUrl(target)) return target
  if (!options.resolveUrl) return target
  return options.resolveUrl(assetPathOf(target, options.attachmentsFolder ?? 'Attachments'))
}

/**
 * The HTML for an embedded asset.
 *
 * A picture is drawn. A PDF becomes a placeholder the print window fills in
 * with the page itself — see `renderPdfEmbeds` — and which degrades to a link
 * anywhere that step does not run. Everything else is a link, because there is
 * nothing honest to draw for a .zip.
 */
function assetHtml(spec: EmbedSpec, options: MarkdownOptions, block: boolean): string {
  const src = escapeHtml(assetUrl(spec.target, options))
  const label = escapeHtml(spec.label)

  if (spec.kind === 'image') {
    const size = `${spec.width ? ` width="${spec.width}"` : ''}${spec.height ? ` height="${spec.height}"` : ''}`
    const img = `<img alt="${label}" src="${src}"${size} />`
    return block ? `<figure class="md-figure">${img}</figure>` : img
  }

  if (spec.kind === 'video' || spec.kind === 'audio') {
    const tag = spec.kind
    return `<${tag} class="md-media" controls src="${src}"></${tag}>`
  }

  if (spec.kind === 'pdf' && block) {
    // The caption is a link as well as a label: wherever the page cannot be
    // drawn — an exported HTML file, say — that link is the whole embed.
    return (
      `<figure class="md-pdf" data-pdf="${src}" data-page="${spec.page}">` +
      `<figcaption><a href="${src}">${label}</a></figcaption></figure>`
    )
  }

  return `<a class="md-file" href="${src}">${label}</a>`
}

/**
 * Sentinels around a held span. Private-use code points: they cannot occur in a
 * note, and none of the inline patterns can match across one, so a span that has
 * been pulled out is untouchable until it goes back in.
 */
const HOLD_OPEN = '\u{E000}'
const HOLD_CLOSE = '\u{E001}'
const HELD_RE = /\u{E000}(\d+)\u{E001}/gu

/**
 * Inline spans.
 *
 * Code and math come out first and go back in last. Both can hold characters
 * the emphasis and link patterns would happily chew through — a `$` inside a
 * code span, an underscore inside a LaTeX subscript — and pulling them out of
 * the string is the only reliable way to keep those patterns off them.
 */
function inline(text: string, options: MarkdownOptions): string {
  const held: string[] = []
  const hold = (html: string): string => `${HOLD_OPEN}${held.push(html) - 1}${HOLD_CLOSE}`

  let work = text

  // Code spans first: nothing inside one is markup.
  work = work.replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`))

  // Inline math. `\$` is an escaped dollar, and a lone `$` is just a dollar.
  work = work.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_, tex: string) =>
    hold(`<span class="md-math" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</span>`)
  )

  work = escapeHtml(work)

  work = work
    // `![[image.png]]` — an embedded asset mid-sentence. A note embed is left
    // alone: the block pass inlines it, and there is nowhere to put a page here.
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (whole, target: string, alias?: string) => {
      const spec = parseEmbed(target, alias)
      return spec.kind === 'note' ? whole : assetHtml(spec, options, false)
    })
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => {
      const [page, anchor] = target.split('#')
      return `<span class="wikilink">${escapeHtml(alias ?? (anchor ? `${page} › ${anchor}` : page))}</span>`
    })
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_, alt: string, src: string) => assetHtml(parseEmbed(src, alt), options, false)
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_, label: string, href: string) => `<a href="${escapeHtml(href)}">${label}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    // `<u>` is the only markup the editor writes as a tag, so it comes back
    // through the escaping as itself rather than as visible angle brackets.
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, '<u>$1</u>')
    // A bare URL still deserves to be a link on paper.
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>')
    // The escape has done its job of keeping the maths pattern away; the
    // backslash itself is not something the reader should ever see.
    .replace(/\\\$/g, '$')

  return work.replace(HELD_RE, (_, i: string) => held[Number(i)])
}

/** Callout kinds the editor knows, mapped to the tone the print sheet paints. */
const CALLOUT_TONES: Record<string, string> = {
  note: 'info',
  info: 'info',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  check: 'tip',
  question: 'info',
  warning: 'warn',
  caution: 'warn',
  attention: 'warn',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  example: 'info',
  quote: 'quote',
  abstract: 'info',
  summary: 'info',
  todo: 'info'
}

interface ListFrame {
  kind: 'ul' | 'ol'
  indent: number
  /** An `<li>` still waiting to be closed — a nested list goes inside it. */
  liOpen: boolean
}

export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): MarkdownResult {
  const depth = options.depth ?? 0
  const lines = stripFrontmatter(markdown).split(/\r?\n/)
  const out: string[] = []
  const headings: Heading[] = []
  const slugs = new Set<string>()

  let fenceMark: string | null = null
  let fenceLang = ''
  let fenceBody: string[] = []
  let mathBody: string[] | null = null
  const lists: ListFrame[] = []
  let quote: { tone: string; body: string[] } | null = null
  let table: { rows: string[][]; align: CellAlign[] } | null = null
  let paragraph: string[] = []

  const closeLists = (toIndent = -1): void => {
    while (lists.length && lists[lists.length - 1].indent > toIndent) {
      const frame = lists.pop()!
      if (frame.liOpen) out.push('</li>')
      out.push(`</${frame.kind}>`)
    }
  }

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    out.push(`<p>${inline(paragraph.join(' '), options)}</p>`)
    paragraph = []
  }

  const flushTable = (): void => {
    if (!table) return
    const { rows, align } = table
    const [head, ...body] = rows
    const cellAlign = (i: number): string =>
      align[i] && align[i] !== 'left' ? ` style="text-align:${align[i]}"` : ''
    out.push('<table><thead><tr>')
    head.forEach((cell, i) => out.push(`<th${cellAlign(i)}>${inline(cell, options)}</th>`))
    out.push('</tr></thead><tbody>')
    for (const row of body) {
      out.push('<tr>')
      row.forEach((cell, i) => out.push(`<td${cellAlign(i)}>${inline(cell, options)}</td>`))
      out.push('</tr>')
    }
    out.push('</tbody></table>')
    table = null
  }

  const flushQuote = (): void => {
    if (!quote) return
    const inner = markdownToHtml(quote.body.join('\n'), { ...options, depth: depth + 1 })
    out.push(
      quote.tone === 'plain'
        ? `<blockquote>${inner.html}</blockquote>`
        : `<div class="callout callout--${quote.tone}">${inner.html}</div>`
    )
    quote = null
  }

  /** Everything that has to end before a new block can start. */
  const closeBlocks = (): void => {
    flushParagraph()
    flushTable()
    flushQuote()
    closeLists()
  }

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ')

    // ---- fenced code, and `$$` display math, which fences the same way
    if (fenceMark !== null) {
      if (line.trimStart().startsWith(fenceMark)) {
        const body = fenceBody.join('\n')
        // A diagram or a drawing goes out as escaped source in a data
        // attribute, to be drawn by whoever renders this: Mermaid needs a DOM
        // to lay out in, and an SVG block has to be scrubbed before it can be
        // trusted. Emitting either as live markup here would hand unchecked
        // content to every consumer of this function at once.
        out.push(
          fenceLang === 'mermaid'
            ? `<figure class="md-mermaid" data-src="${escapeHtml(body)}"><pre>${escapeHtml(body)}</pre></figure>`
            : fenceLang === 'svg'
              ? `<figure class="md-svg" data-src="${escapeHtml(body)}"><pre>${escapeHtml(body)}</pre></figure>`
            // A program figure — a memory diagram, a tree, an algorithm run.
            // Same reasoning: the source travels, and whoever has a DOM draws it.
            : vizKind(fenceLang)
              ? `<figure class="md-viz" data-kind="${escapeHtml(vizKind(fenceLang) ?? '')}" data-src="${escapeHtml(body)}"><pre>${escapeHtml(body)}</pre></figure>`
            // A ```math fence is display maths, the same as `$$`. The editor
            // has always drawn it that way; printing it as a code block was
            // the one place the two disagreed.
            : fenceLang === 'math' || fenceLang === 'latex'
              ? `<div class="md-math md-math--block" data-tex="${escapeHtml(body)}">${escapeHtml(body)}</div>`
              : `<pre class="md-code"${fenceLang ? ` data-lang="${escapeHtml(fenceLang)}"` : ''}><code>${escapeHtml(body)}</code></pre>`
        )
        fenceMark = null
        fenceBody = []
      } else {
        fenceBody.push(line)
      }
      continue
    }
    if (mathBody !== null) {
      if (line.trim().startsWith('$$')) {
        const tex = mathBody.join('\n')
        out.push(
          `<div class="md-math md-math--block" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</div>`
        )
        mathBody = null
      } else {
        mathBody.push(line)
      }
      continue
    }

    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line)
    if (fence) {
      closeBlocks()
      fenceMark = fence[1]
      fenceLang = fence[2].toLowerCase()
      continue
    }
    // `$$…$$` written on one line, which is how most display maths gets typed.
    const oneLineMath = /^\s*\$\$(?!\s*$)([\s\S]+?)\$\$\s*$/.exec(line)
    if (oneLineMath) {
      closeBlocks()
      const tex = oneLineMath[1]
      out.push(`<div class="md-math md-math--block" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</div>`)
      continue
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      closeBlocks()
      mathBody = []
      continue
    }

    // ---- blockquotes and callouts, gathered whole and rendered as a unit
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      flushTable()
      closeLists()
      if (!quote) {
        const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(quoted[1])
        if (callout) {
          const kind = callout[1].toLowerCase()
          quote = { tone: CALLOUT_TONES[kind] ?? 'info', body: [] }
          const title = callout[2].trim() || kind.charAt(0).toUpperCase() + kind.slice(1)
          quote.body.push(`**${title}**`, '')
          continue
        }
        quote = { tone: 'plain', body: [] }
      }
      quote.body.push(quoted[1])
      continue
    }
    flushQuote()

    // ---- tables
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph()
      closeLists()
      const cells = splitRow(line)
      if (TABLE_RULE_RE.test(line.trim())) {
        if (table) table.align = alignmentsOf(line)
      } else if (table) {
        table.rows.push(cells)
      } else {
        table = { rows: [cells], align: [] }
      }
      continue
    }
    flushTable()

    if (!line.trim()) {
      flushParagraph()
      closeLists()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeBlocks()
      const level = heading[1].length
      const html = inline(heading[2], options)
      const text = heading[2].replace(/[`*_~]/g, '').trim()
      const id = slugify(text, slugs)
      if (depth === 0) headings.push({ level, text, id })
      out.push(`<h${level} id="${id}">${html}</h${level}>`)
      continue
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      closeBlocks()
      out.push('<hr />')
      continue
    }

    // ---- an embed on a line of its own: a note is inlined, a file is a figure
    const embed = /^\s*!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/.exec(line)
    const mdEmbed = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line)
    const spec = embed
      ? parseEmbed(embed[1], embed[2])
      : mdEmbed
        ? parseEmbed(mdEmbed[2], mdEmbed[1])
        : null

    if (spec && spec.kind !== 'note') {
      closeBlocks()
      out.push(assetHtml(spec, options, true))
      continue
    }

    if (embed) {
      const source = options.embeds?.[embed[1].split('#')[0]]
      if (source !== undefined && depth < MAX_EMBED_DEPTH) {
        closeBlocks()
        const inner = markdownToHtml(source, { ...options, depth: depth + 1 })
        out.push(
          `<section class="md-embed"><p class="md-embed__from">${escapeHtml(embed[1])}</p>${inner.html}</section>`
        )
        continue
      }
    }

    // ---- lists, nested by indent
    const item = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line)
    if (item) {
      flushParagraph()
      const indent = item[1].length
      const kind: 'ul' | 'ol' = item[2] ? 'ul' : 'ol'
      const open = kind === 'ul' ? '<ul>' : `<ol start="${item[3] ?? 1}">`

      closeLists(indent)
      const top = lists[lists.length - 1]

      if (!top || top.indent < indent) {
        // A deeper list belongs *inside* the item above it, so that item's
        // `<li>` is left open rather than closed — `<ul>` as a direct child of
        // `<ul>` is invalid, and browsers only paper over it by accident.
        out.push(open)
        lists.push({ kind, indent, liOpen: false })
      } else {
        if (top.liOpen) out.push('</li>')
        top.liOpen = false
        if (top.kind !== kind) {
          out.push(`</${top.kind}>`)
          lists.pop()
          out.push(open)
          lists.push({ kind, indent, liOpen: false })
        }
      }

      const task = /^\[([ xX/\-])\]\s+(.*)$/.exec(item[4])
      if (task) {
        const state = task[1].toLowerCase().trim() || 'open'
        const done = state === 'x'
        out.push(
          `<li class="task${done ? ' task--done' : ''}" data-state="${state}">` +
            `<span class="task__box${done ? ' task__box--done' : ''}" aria-hidden="true"></span>` +
            inline(task[2], options)
        )
      } else {
        out.push(`<li>${inline(item[4], options)}`)
      }
      lists[lists.length - 1].liOpen = true
      continue
    }

    // ---- a continuation line of the list item above, or a paragraph
    if (lists.length && lists[lists.length - 1].liOpen && /^\s{2,}\S/.test(line)) {
      out.push(` ${inline(line.trim(), options)}`)
      continue
    }
    closeLists()
    paragraph.push(line.trim())
  }

  if (fenceMark !== null && fenceBody.length) {
    out.push(`<pre class="md-code"><code>${escapeHtml(fenceBody.join('\n'))}</code></pre>`)
  }
  if (mathBody !== null && mathBody.length) {
    const tex = mathBody.join('\n')
    out.push(`<div class="md-math md-math--block" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</div>`)
  }
  closeBlocks()

  return { html: out.join('\n'), headings }
}


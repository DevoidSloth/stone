/**
 * HTML to markdown, without a DOM.
 *
 * The importer needs this for Evernote and saved web pages; the clipper needs
 * it for whatever a browser hands over. Neither runs in a window, so there is
 * no `document` to parse with, and pulling in a full HTML parser to convert
 * what is usually one article's worth of markup is not worth the dependency.
 *
 * The rewrites run in a fixed order because they are not independent: block
 * structure has to be resolved before inline marks, and every tag-eating rule
 * has to come after the rules that read attributes off those tags.
 */

const BLOCK_JUNK = /<(script|style|noscript|svg|iframe|form|nav|footer|aside)[\s\S]*?<\/\1>/gi

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // Ampersand last, so a doubly-encoded entity does not decode twice.
    .replace(/&amp;/g, '&')
}

/**
 * Nested lists, flattened to indentation.
 *
 * Depth is tracked by counting how many list tags are open rather than by
 * recursing, which keeps this a single pass and degrades sanely on the
 * unbalanced markup that real pages are full of.
 */
function convertLists(html: string): string {
  let depth = -1
  return html.replace(
    /<(\/?)(ul|ol|li)[^>]*>/gi,
    (_match, closing: string, tag: string) => {
      const name = tag.toLowerCase()
      if (name === 'ul' || name === 'ol') {
        depth += closing ? -1 : 1
        return '\n'
      }
      if (closing) return '\n'
      return `${'  '.repeat(Math.max(depth, 0))}- `
    }
  )
}

export interface HtmlToMarkdownOptions {
  /** Rewrite a resolved image or link URL, e.g. to a vault-relative path. */
  rewriteUrl?: (url: string, kind: 'image' | 'link') => string
  /** Evernote's checkbox element, which only the importer sees. */
  evernoteTodos?: boolean
}

export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const rewrite = options.rewriteUrl ?? ((url: string) => url)

  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(BLOCK_JUNK, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')

  if (options.evernoteTodos) {
    out = out
      .replace(/<en-todo[^>]*checked="true"[^>]*\/?>/gi, '- [x] ')
      .replace(/<en-todo[^>]*\/?>/gi, '- [ ] ')
  }

  // Fenced code first: everything below would otherwise chew up the markup
  // that happens to be *inside* a code sample.
  out = out.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_m, inner: string) =>
      `\n\n\`\`\`\n${decodeEntities(inner.replace(/<[^>]+>/g, '')).trim()}\n\`\`\`\n\n`
  )
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ''))
    return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
  })

  // Attribute-reading rules, before anything strips tags.
  out = out.replace(
    /<img[^>]*?src=["']([^"']+)["'][^>]*?>/gi,
    (match, src: string) => {
      const alt = /alt=["']([^"']*)["']/i.exec(match)?.[1] ?? ''
      return `\n![${alt}](${rewrite(src, 'image')})\n`
    }
  )
  out = out.replace(
    /<a[^>]*?href=["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      if (!text) return ''
      // A link whose text is its own URL reads better bare.
      return text === href ? href : `[${text}](${rewrite(href, 'link')})`
    }
  )

  out = out
    .replace(/<hr[^>]*>/gi, '\n\n---\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) =>
      `\n\n${inner
        .replace(/<[^>]+>/g, '')
        .trim()
        .split('\n')
        .map((line) => `> ${line.trim()}`)
        .join('\n')}\n\n`
    )

  out = convertLists(out)

  out = out
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      return text ? `\n\n${'#'.repeat(Number(level))} ${text}\n\n` : '\n'
    })
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      return text ? `**${text}**` : ''
    })
    .replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      return text ? `*${text}*` : ''
    })
    .replace(/<(s|del|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      return text ? `~~${text}~~` : ''
    })

  out = out
    .replace(/<\/(p|div|section|article|h[1-6]|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')

  return decodeEntities(out)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

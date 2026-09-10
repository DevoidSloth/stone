import matter from 'gray-matter'
import path from 'node:path'
import type { BlockAnchor, Heading, NoteMeta, Task } from '@shared/types'
import { parseTaskLine } from '@shared/task-syntax'

/**
 * A leading `!` makes the link an embed rather than a reference. Both are
 * captured by the same expression so the two can never drift apart.
 */
const WIKILINK_RE = /(!)?\[\[([^\]|#^]+)(?:[#^][^\]|]+)?(?:\|[^\]]+)?\]\]/g
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+\.md)\)/g
const INLINE_TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu
const HEADING_RE = /^(#{1,6})\s+(.*)$/
/** A trailing `^id` marks the line as a linkable block. */
const BLOCK_ID_RE = /\s\^([A-Za-z0-9-]+)\s*$/
const DAILY_NAME_RE = /(\d{4}-\d{2}-\d{2})/
const FENCE_RE = /^\s*(```|~~~)/
/** `%%` alone on a line, opening or closing a comment block. */
const COMMENT_FENCE_RE = /^\s*%%\s*$/
/** `%%an aside%%` inside a line. */
const INLINE_COMMENT_RE = /%%[\s\S]*?%%/g

export interface ParsedNote {
  meta: NoteMeta
  tasks: Task[]
  content: string
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean)
  }
  return []
}

/**
 * Page icons are not only emoji: a chapter number or a monogram is a valid
 * icon. Stone quotes them on write, but a hand-edited `icon: 7` reaches YAML
 * as a number, and dropping it would silently erase the icon on save.
 */
function resolveIcon(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Frontmatter `date:` wins; otherwise a `YYYY-MM-DD` in the filename. */
function resolveDate(frontmatter: Record<string, unknown>, relPath: string): string | null {
  const fm = frontmatter.date ?? frontmatter.day
  if (fm instanceof Date) {
    const y = fm.getUTCFullYear()
    const m = String(fm.getUTCMonth() + 1).padStart(2, '0')
    const d = String(fm.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof fm === 'string' && DAILY_NAME_RE.test(fm)) return DAILY_NAME_RE.exec(fm)![1]

  const base = path.basename(relPath, '.md')
  const inName = DAILY_NAME_RE.exec(base)
  return inName ? inName[1] : null
}

function firstHeadingOrName(body: string, relPath: string): string {
  for (const line of body.split('\n')) {
    const h = HEADING_RE.exec(line)
    if (h && h[1].length === 1) return h[2].trim()
  }
  return path.basename(relPath, '.md')
}

function buildExcerpt(body: string): string {
  const cleaned = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX/\-]\]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 220)
}

/**
 * Parse raw file contents into everything the index needs.
 * Fenced code blocks are skipped so `# comments` and `- [ ]` inside snippets
 * do not become headings and tasks.
 */
export function parseNote(
  relPath: string,
  absPath: string,
  raw: string,
  stat: { mtimeMs: number; birthtimeMs: number; size: number }
): ParsedNote {
  let frontmatter: Record<string, unknown> = {}
  let body = raw
  try {
    const parsed = matter(raw)
    frontmatter = (parsed.data ?? {}) as Record<string, unknown>
    body = parsed.content
  } catch {
    // Malformed YAML: treat the whole file as body rather than losing the note.
  }

  // gray-matter strips the frontmatter block, which shifts line numbers.
  // Recover the offset so task line numbers point at the real file lines.
  const frontmatterLines =
    body === raw ? 0 : raw.slice(0, raw.length - body.length).split('\n').length - 1

  const lines = body.split('\n')
  const tasks: Task[] = []
  const headings: Heading[] = []
  const blocks: BlockAnchor[] = []
  const links = new Set<string>()
  const embeds = new Set<string>()
  const tags = new Set<string>(asStringArray(frontmatter.tags))
  const today = new Date()
  let inFence = false
  let inComment = false

  for (let i = 0; i < lines.length; i++) {
    const source = lines[i]

    if (FENCE_RE.test(source)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    /*
     * `%%` … `%%` is commented out, and commenting a line out has to mean it
     * stops counting. A task inside one that still turned up in the Tasks view
     * and on the calendar would make the comment syntax useless for the thing
     * people reach for it first: parking something without deleting it.
     */
    if (COMMENT_FENCE_RE.test(source)) {
      inComment = !inComment
      continue
    }
    if (inComment) continue

    const line = source.replace(INLINE_COMMENT_RE, '')
    const absLine = i + frontmatterLines

    // Links and tags are collected from task lines too — a task that links to a
    // project note should still show up in that note's backlinks.
    WIKILINK_RE.lastIndex = 0
    let wl: RegExpExecArray | null
    while ((wl = WIKILINK_RE.exec(line)) !== null) {
      const target = wl[2].trim()
      if (wl[1]) embeds.add(target)
      else links.add(target)
    }

    MD_LINK_RE.lastIndex = 0
    let ml: RegExpExecArray | null
    while ((ml = MD_LINK_RE.exec(line)) !== null) {
      links.add(decodeURIComponent(ml[1]).replace(/\.md$/, ''))
    }

    const block = BLOCK_ID_RE.exec(line)
    if (block) {
      blocks.push({
        id: block[1],
        line: absLine,
        text: line.slice(0, block.index).trim()
      })
    }

    const task = parseTaskLine(line, relPath, absLine, today)
    if (task) {
      tasks.push(task)
      for (const t of task.tags) tags.add(t)
      continue
    }

    const h = HEADING_RE.exec(line)
    if (h) headings.push({ level: h[1].length, text: h[2].trim(), line: absLine })

    INLINE_TAG_RE.lastIndex = 0
    let tm: RegExpExecArray | null
    while ((tm = INLINE_TAG_RE.exec(line)) !== null) tags.add(tm[1])
  }

  const title =
    (typeof frontmatter.title === 'string' && frontmatter.title.trim()) ||
    firstHeadingOrName(body, relPath)

  const meta: NoteMeta = {
    path: absPath,
    relPath,
    title,
    mtime: stat.mtimeMs,
    ctime: stat.birthtimeMs,
    size: stat.size,
    frontmatter,
    tags: [...tags],
    links: [...links],
    embeds: [...embeds],
    headings,
    blocks,
    aliases: asStringArray(frontmatter.aliases ?? frontmatter.alias),
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => t.status === 'done').length,
    excerpt: buildExcerpt(body),
    date: resolveDate(frontmatter, relPath),
    icon: resolveIcon(frontmatter.icon),
    cover: typeof frontmatter.cover === 'string' ? frontmatter.cover.trim() || null : null,
    words: countWords(raw)
  }

  return { meta, tasks, content: raw }
}

/** Word count that ignores frontmatter, code fences, and markup punctuation. */
export function countWords(raw: string): number {
  const text = raw
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_`>[\]()|-]/g, ' ')
  const words = text.match(/[\p{L}\p{N}''-]+/gu)
  return words ? words.length : 0
}

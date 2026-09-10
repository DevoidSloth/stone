/**
 * Naming a part of a note, and cutting it out.
 *
 * `[[Note#Heading]]` and `[[Note#^block-id]]` have always resolved to a *line*
 * — that is all a link needs, because scrolling there is the whole job. An
 * embed needs more: `![[Note#Heading]]` promises the section and nothing else,
 * and handing back the whole page instead is not a smaller version of that
 * promise, it is a different one.
 *
 * So the slicing lives here, in shared, because three callers need identical
 * answers: the editor's embed widget, the exporter that inlines embeds into a
 * PDF, and main's link resolver. A section that reads one way on screen and
 * another on paper is the drift keeping one copy prevents.
 */

export interface Target {
  /** The note, without any fragment. */
  name: string
  /** `#Heading`, or `#A#B` for a subheading, as written. Null when absent. */
  heading: string | null
  /** `^block-id`, without the caret. */
  block: string | null
}

/** `^block-id` at the end of a line — the anchor, not prose. */
const BLOCK_ID_RE = /\s*\^([A-Za-z0-9-]+)\s*$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/

/** Split `Note#Heading#Sub^block` into its three parts. */
export function splitTarget(target: string): Target {
  const block = /\^([A-Za-z0-9-]+)\s*$/.exec(target)
  const withoutBlock = block ? target.slice(0, block.index) : target
  const hash = withoutBlock.indexOf('#')
  return {
    name: (hash === -1 ? withoutBlock : withoutBlock.slice(0, hash)).trim(),
    heading: hash === -1 ? null : withoutBlock.slice(hash + 1).trim() || null,
    block: block ? block[1] : null
  }
}

/** True when a target names part of a note rather than the whole of it. */
export function isSectionTarget(target: string): boolean {
  const parts = splitTarget(target)
  return parts.heading !== null || parts.block !== null
}

/**
 * Heading text as it should be compared: markup off, trailing anchors off.
 *
 * `## The **plan** ^plan` and `[[Note#The plan]]` have to meet somewhere, and
 * the only fair place is the words themselves.
 */
function headingText(raw: string): string {
  return raw
    .replace(BLOCK_ID_RE, '')
    .replace(/[*_`~]/g, '')
    .trim()
}

interface HeadingLine {
  index: number
  level: number
  text: string
}

function headingsOf(lines: string[]): HeadingLine[] {
  const found: HeadingLine[] = []
  let fence: string | null = null
  lines.forEach((line, index) => {
    const mark = /^\s*(```|~~~)/.exec(line)
    if (mark) {
      if (fence === null) fence = mark[1]
      else if (line.trimStart().startsWith(fence)) fence = null
      return
    }
    // A `# comment` inside a code block is not a heading, and treating one as
    // a section boundary would cut an embed off in the middle of a snippet.
    if (fence !== null) return
    const heading = HEADING_RE.exec(line)
    if (heading) found.push({ index, level: heading[1].length, text: headingText(heading[2]) })
  })
  return found
}

/**
 * The lines under a heading: the heading itself, then everything down to the
 * next heading at the same level or above it.
 */
function headingSection(lines: string[], path: string[]): string[] | null {
  const headings = headingsOf(lines)

  let from = 0
  let searchFrom = 0
  let bound = lines.length
  let level = 0

  for (const step of path) {
    const needle = step.trim().toLowerCase()
    const hit = headings.find(
      (h) => h.index >= searchFrom && h.index < bound && h.text.toLowerCase() === needle
    )
    if (!hit) return null

    from = hit.index
    level = hit.level
    searchFrom = hit.index + 1

    const next = headings.find((h) => h.index > hit.index && h.level <= hit.level)
    bound = next ? next.index : lines.length
  }

  if (level === 0) return null
  return lines.slice(from, bound)
}

/**
 * The block an `^id` marks.
 *
 * The id sits at the end of the block it names, which is either the last line
 * of a paragraph or a line of its own after one — so the block is found by
 * walking back from the id to the nearest blank line or heading. A list item
 * keeps the run of items it belongs to, because half a list is not a block
 * anybody meant to point at.
 */
function blockSection(lines: string[], id: string): string[] | null {
  const at = lines.findIndex((line) => BLOCK_ID_RE.exec(line)?.[1] === id)
  if (at === -1) return null

  // An id alone on its line labels the block above it rather than itself.
  const onOwnLine = lines[at].replace(BLOCK_ID_RE, '').trim() === ''
  let last = onOwnLine ? at - 1 : at
  while (last > 0 && !lines[last].trim()) last--
  if (last < 0) return null

  let first = last
  while (first > 0) {
    const above = lines[first - 1]
    if (!above.trim() || HEADING_RE.test(above)) break
    first--
  }

  return lines.slice(first, last + 1).map((line) => line.replace(BLOCK_ID_RE, ''))
}

/**
 * The part of `markdown` a fragment names, or null when nothing answers to it.
 *
 * Null rather than the whole note on purpose: an embed that quietly widens to
 * the entire page when a heading is renamed is a silent wrong answer, and the
 * widget that shows this can say so instead.
 */
export function sliceSection(
  markdown: string,
  heading: string | null,
  block: string | null
): string | null {
  if (!heading && !block) return markdown

  const lines = markdown.split(/\r?\n/)
  const found = block
    ? blockSection(lines, block)
    : headingSection(lines, heading!.split('#').filter((part) => part.trim()))
  if (!found) return null

  // Trailing blank lines belong to the gap before the next section, not here.
  let end = found.length
  while (end > 0 && !found[end - 1].trim()) end--
  return found.slice(0, end).join('\n')
}

/** `Note › Heading` — what an embed of part of a note should call itself. */
export function sectionLabel(title: string, heading: string | null, block: string | null): string {
  if (heading) return `${title} › ${heading.split('#').filter(Boolean).join(' › ')}`
  if (block) return `${title} › ^${block}`
  return title
}

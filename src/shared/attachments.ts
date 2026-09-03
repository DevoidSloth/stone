/**
 * The `stone-file://` URL for a vault-relative path.
 *
 * Shared rather than owned by main because the editor has to build these
 * synchronously — an image decoration cannot wait on an IPC round trip while
 * the user is typing, and the format is fixed by the protocol handler anyway.
 */
export const STONE_PROTOCOL = 'stone-file'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
const VIDEO_RE = /\.(mp4|webm|ogv|mov)$/i
const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac)$/i
const PDF_RE = /\.pdf$/i

/** The host segment that resolves a path against the watched library folders. */
export const DOC_HOST = 'doc'

export function toProtocolUrl(relPath: string): string {
  const encoded = relPath
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  return `${STONE_PROTOCOL}://vault/${encoded}`
}

/**
 * The URL for a library document, which is an absolute path outside the vault.
 *
 * Main re-checks it against the watched folders on every request — this only
 * builds the URL, it does not grant anything.
 */
export function toDocumentUrl(absPath: string): string {
  const encoded = absPath
    .split(/[\\/]/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return `${STONE_PROTOCOL}://${DOC_HOST}/${encoded}`
}

/** True for anything that is already a URL and must be left alone. */
export function isExternalUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}

export type EmbedKind = 'image' | 'video' | 'audio' | 'pdf' | 'note' | 'file'

export function embedKind(target: string): EmbedKind {
  const clean = target.split(/[?#]/)[0]
  if (IMAGE_RE.test(clean)) return 'image'
  if (VIDEO_RE.test(clean)) return 'video'
  if (AUDIO_RE.test(clean)) return 'audio'
  if (PDF_RE.test(clean)) return 'pdf'
  if (/\.md$/i.test(clean) || !/\.[a-z0-9]{1,5}$/i.test(clean)) return 'note'
  return 'file'
}

/**
 * The vault-relative path an embed target names.
 *
 * A bare filename means the attachments folder — that is where paste and drop
 * put things, so `![[screenshot.png]]` has to find them there. Anything with a
 * slash is taken from the vault root, and a leading slash says so explicitly.
 */
export function resolveAssetPath(target: string, attachmentsFolder: string): string {
  const clean = target.trim()
  if (clean.startsWith('/')) return clean.slice(1)
  if (clean.includes('/')) return clean
  return `${attachmentsFolder}/${clean}`
}

/**
 * The on-disk path an embed target names.
 *
 * Markdown link targets are percent-encoded — `saveAttachment` writes them that
 * way, because a filename with a space in it is the normal case. Decoding here
 * means every consumer works in real path segments and encodes once, on the way
 * back out; a path decoded twice or encoded twice is a file that is not found.
 */
export function assetPathOf(target: string, attachmentsFolder: string): string {
  const relative = resolveAssetPath(target.trim(), attachmentsFolder)
  try {
    return decodeURIComponent(relative)
  } catch {
    // A stray `%` is not an escape; take the path as written.
    return relative
  }
}

/** Resolve an embed target to a URL the renderer is allowed to load. */
export function resolveAssetUrl(target: string, attachmentsFolder: string): string {
  const clean = target.trim()
  if (isExternalUrl(clean)) return clean
  return toProtocolUrl(assetPathOf(clean, attachmentsFolder))
}

/** `300` or `300x200` in the alias slot is a size, not a caption. */
const SIZE_RE = /^(\d+)(?:\s*[x×]\s*(\d+))?$/

/**
 * Split an alias into its caption and its size.
 *
 * The size is the last `|`-separated piece when it looks like one, so both
 * `![[a.png|300]]` and `![[a.png|A caption|300]]` work and a caption that
 * happens to contain a pipe is not mistaken for a measurement.
 */
function splitAlias(alias: string): { label: string; width: number | null; height: number | null } {
  const parts = alias.split('|')
  const last = parts[parts.length - 1].trim()
  const size = SIZE_RE.exec(last)
  if (!size) return { label: alias.trim(), width: null, height: null }
  parts.pop()
  return {
    label: parts.join('|').trim(),
    width: Number(size[1]),
    height: size[2] ? Number(size[2]) : null
  }
}

export interface EmbedSpec {
  /** The target with any `#fragment` stripped — except on a note, where the
   * heading is part of what is being embedded. */
  target: string
  kind: EmbedKind
  /** `![[report.pdf#page=4]]`, defaulting to the first page. */
  page: number
  width: number | null
  height: number | null
  /** What to show as alt text or a caption; never the size. */
  label: string
}

/**
 * Read an embed's target and alias into everything the widgets need.
 *
 * Both syntaxes end up here — `![[a.png|300]]` and `![300](a.png)` — because
 * the sizing and page rules should not differ by which one the user typed.
 */
export function parseEmbed(rawTarget: string, rawAlias?: string): EmbedSpec {
  let target = rawTarget.trim()
  const kind = embedKind(target)

  const { label, width, height } = splitAlias(rawAlias ?? '')

  let page = 1
  // A note embed keeps its `#heading`: the fragment names the part being
  // transcluded, and cutting it off would silently embed the whole page.
  if (kind !== 'note') {
    const hash = target.indexOf('#')
    if (hash !== -1) {
      const found = /^page=(\d+)$/i.exec(target.slice(hash + 1))
      if (found) page = Math.max(1, Number(found[1]))
      target = target.slice(0, hash)
    }
  }

  return { target, kind, page, width, height, label: label || target }
}

/**
 * A block embed on its own line, split so its alias can be replaced.
 *
 * Resizing writes back into the document — the picture on screen and the text
 * in the file must not disagree — and that means editing the one piece of
 * syntax that holds the size while leaving the target, the caption and the page
 * fragment exactly as the user typed them.
 */
const WIKI_EMBED_LINE = /^(\s*!\[\[)([^\]|]+)(?:\|([^\]]*))?(\]\]\s*)$/
const MD_EMBED_LINE = /^(\s*!\[)([^\]]*)(\]\([^)\s]+(?:\s+"[^"]*")?\)\s*)$/

/** Put `width` into an alias, replacing any size already in it. */
function aliasWithWidth(alias: string, width: number | null): string {
  const { label } = splitAlias(alias)
  if (width === null) return label
  return label ? `${label}|${width}` : String(width)
}

/**
 * The same line with the embed resized to `width`, or null if the line is not a
 * block embed. Pass null for `width` to go back to the picture's own size.
 */
export function withEmbedWidth(lineText: string, width: number | null): string | null {
  const wiki = WIKI_EMBED_LINE.exec(lineText)
  if (wiki) {
    const alias = aliasWithWidth(wiki[3] ?? '', width)
    return `${wiki[1]}${wiki[2]}${alias ? `|${alias}` : ''}${wiki[4]}`
  }

  const md = MD_EMBED_LINE.exec(lineText)
  if (md) return `${md[1]}${aliasWithWidth(md[2], width)}${md[3]}`

  return null
}

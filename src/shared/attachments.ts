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

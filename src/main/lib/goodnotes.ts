import { ZipArchive } from './zip'
import { extractPdfText } from './pdf-text'

/**
 * Reading a GoodNotes document.
 *
 * GoodNotes has never published its format, so everything here is inference
 * from the files themselves, and it is written to degrade rather than to be
 * right. A document Stone cannot decompose still appears in the library with
 * its name, its date, and a working "open in GoodNotes" — that is the floor.
 * Anything above it (a thumbnail, a page count, the recognised text) is a
 * bonus that a future GoodNotes release is allowed to take away.
 *
 * What the packages have in common, across the versions seen in the wild:
 *
 *   - the document is a zip, whatever the extension says (`.goodnotes`, and
 *     the older `.note`);
 *   - there is usually a thumbnail somewhere, named for what it is;
 *   - a document built by importing a PDF keeps that PDF inside the package,
 *     which is the single most valuable thing in here — it means an annotated
 *     paper is as searchable as the paper was;
 *   - handwriting recognition results, when the user has enabled it, live in
 *     JSON or plist blobs that can be scraped for strings.
 *
 * None of that is guaranteed. Every step is individually optional and failure
 * of one never aborts the others.
 */

export interface GoodNotesDocument {
  /** Recognised or embedded text, empty when none could be read. */
  text: string
  pageCount: number | null
  /** PNG or JPEG bytes for the cover, when the package carried one. */
  thumbnail: Buffer | null
  thumbnailType: string | null
  /** True when the package held an imported PDF, which is where text came from. */
  fromEmbeddedPdf: boolean
  /** Set when the package could not be decomposed at all. */
  warning: string | null
}

const THUMBNAIL_RE = /(thumbnail|snapshot|preview|cover)[^/]*\.(png|jpe?g)$/i
const PAGE_IMAGE_RE = /\.(png|jpe?g)$/i
const PDF_RE = /\.pdf$/i
const TEXT_BLOB_RE = /\.(json|plist|txt|xml)$/i

/**
 * Printable runs out of a binary blob.
 *
 * Binary plists hold their strings as length-prefixed runs with no separator a
 * parser could rely on, so this does what `strings(1)` does: take every run of
 * printable characters past a length worth having. Short runs are dropped
 * because a plist is full of two-letter keys that would swamp the real text.
 */
function scrapeStrings(buffer: Buffer, minLength = 4): string[] {
  const out: string[] = []
  let current = ''

  for (const byte of buffer) {
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte)
      continue
    }
    if (current.length >= minLength) out.push(current)
    current = ''
  }
  if (current.length >= minLength) out.push(current)

  return out
}

/**
 * Keep the runs that read as prose.
 *
 * A scraped plist is mostly identifiers — `NSKeyedArchiver`, UUIDs, class
 * names, key paths. They are all distinguishable from handwriting by shape: no
 * spaces, or camelCase, or hex. This is a heuristic and it will occasionally
 * drop a real one-word note; the alternative is a search index full of
 * `$objects` and every UUID in the file.
 */
function looksLikeProse(value: string): boolean {
  if (value.length < 4) return false
  if (/^[0-9a-f-]{8,}$/i.test(value)) return false
  if (/^(NS|GN|UI|CF|kGN)[A-Za-z]+$/.test(value)) return false
  if (/^[A-Za-z]+([A-Z][a-z]+)+$/.test(value)) return false
  if (/^[$_./\\{}[\]<>:;#@%^*+=|~-]+$/.test(value)) return false
  if (/^[A-Za-z0-9_.-]+\.(plist|json|png|jpg|jpeg|pdf|data|zip)$/i.test(value)) return false
  // Real writing has spaces or is at least a plausible standalone word.
  return /\s/.test(value) || /^[A-Za-z][a-z]{3,}$/.test(value)
}

export async function readGoodNotes(filePath: string): Promise<GoodNotesDocument> {
  const empty: GoodNotesDocument = {
    text: '',
    pageCount: null,
    thumbnail: null,
    thumbnailType: null,
    fromEmbeddedPdf: false,
    warning: null
  }

  let archive: ZipArchive
  try {
    archive = await ZipArchive.open(filePath)
  } catch (err) {
    return {
      ...empty,
      warning: `Could not open this as a package (${(err as Error).message}). It is listed by name only.`
    }
  }

  try {
    const result: GoodNotesDocument = { ...empty }

    // 1. Thumbnail. A dedicated one if the package names it, otherwise the
    //    first page image, which is the same picture by another route.
    const thumbEntry =
      archive.find((name) => THUMBNAIL_RE.test(name)) ??
      archive.entries
        .filter((e) => PAGE_IMAGE_RE.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))[0]

    if (thumbEntry) {
      try {
        result.thumbnail = await archive.read(thumbEntry, 12 * 1024 * 1024)
        result.thumbnailType = /\.png$/i.test(thumbEntry.name) ? 'image/png' : 'image/jpeg'
      } catch {
        // A cover is the most expendable thing here.
      }
    }

    // 2. An imported PDF, which carries real text and a real page count.
    const pdfEntry = archive.entries
      .filter((e) => PDF_RE.test(e.name))
      .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0]

    if (pdfEntry) {
      try {
        const pdf = extractPdfText(await archive.read(pdfEntry))
        if (pdf.text) {
          result.text = pdf.text
          result.fromEmbeddedPdf = true
        }
        if (pdf.pages) result.pageCount = pdf.pages
      } catch {
        // Fall through to the handwriting scrape below.
      }
    }

    // 3. Handwriting recognition, when there was no PDF to lean on.
    if (!result.text) {
      const scraped: string[] = []
      for (const entry of archive.entries) {
        if (!TEXT_BLOB_RE.test(entry.name) && !/\.data$/i.test(entry.name)) continue
        if (entry.uncompressedSize > 8 * 1024 * 1024) continue
        try {
          const blob = await archive.read(entry)
          for (const run of scrapeStrings(blob)) {
            if (looksLikeProse(run)) scraped.push(run)
          }
        } catch {
          continue
        }
        if (scraped.length > 4000) break
      }
      result.text = [...new Set(scraped)].join(' ').slice(0, 200_000)
    }

    // 4. Page count from the number of page images, when nothing better said.
    if (result.pageCount === null) {
      const pageImages = archive.entries.filter((e) => PAGE_IMAGE_RE.test(e.name)).length
      result.pageCount = pageImages > 0 ? pageImages : null
    }

    if (!result.text && !result.thumbnail) {
      result.warning =
        'This package opened but held nothing Stone could read. GoodNotes may have changed its format; the document is listed by name.'
    }

    return result
  } finally {
    await archive.close()
  }
}

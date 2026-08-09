import zlib from 'node:zlib'

/**
 * Pulling readable text out of a PDF.
 *
 * Rendering is Chromium's job — it has a PDF viewer and Stone just points an
 * iframe at the file. What Chromium will not give the main process is the text,
 * and without text a PDF is invisible to search, which is most of what putting
 * documents in a vault is *for*.
 *
 * This is deliberately a text scraper and not a PDF implementation. It finds
 * content streams, inflates the ones that are deflated, and reads the string
 * arguments of the text-showing operators. That gets usable text out of the
 * overwhelming majority of documents that were produced digitally.
 *
 * What it does not do, stated plainly so nobody debugs it expecting otherwise:
 * no glyph-level positioning, so column order can be wrong on complex layouts;
 * no CID font decoding, so some documents with subsetted fonts yield gibberish
 * that is filtered out rather than indexed; no OCR, so a scanned page has no
 * text and never will here. Each of those is a reason a document may be found
 * by name but not by content, which is the failure this degrades to.
 */

const MAX_STREAMS = 4000

/** PDF escapes inside a literal `(string)`. */
function decodeLiteral(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[++i]
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'b':
      case 'f':
        out += ' '
        break
      case '(':
      case ')':
      case '\\':
        out += next
        break
      case '\n':
        // A backslash at end of line is a continuation, contributing nothing.
        break
      default:
        if (next >= '0' && next <= '7') {
          let octal = next
          while (octal.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') octal += raw[++i]
          out += String.fromCharCode(parseInt(octal, 8))
        } else {
          out += next ?? ''
        }
    }
  }
  return out
}

function decodeHex(raw: string): string {
  const clean = raw.replace(/[^0-9a-f]/gi, '')
  let out = ''
  // UTF-16BE is announced by a byte-order mark, and is common for anything
  // that was not pure ASCII to begin with.
  if (/^feff/i.test(clean)) {
    for (let i = 4; i + 3 < clean.length; i += 4) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16))
    }
    return out
  }
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
  }
  return out
}

/**
 * True when a decoded run looks like language rather than font-subset noise.
 *
 * A subsetted CID font maps glyphs to arbitrary codes, so decoding its bytes as
 * characters yields something that is *shaped* like text — letters, accents,
 * punctuation — but is not. The giveaway is control characters: real extracted
 * text has essentially none, while glyph indices are full of them because the
 * low byte values are perfectly ordinary glyph numbers.
 *
 * An earlier version of this counted any byte in the Latin-1 range as readable,
 * which let a 180MB manual contribute 370KB of noise to the search index. The
 * test now has to be passed twice: here, per run, and again over the assembled
 * document by `isProse`.
 */
function looksLikeText(value: string): boolean {
  if (!value) return false

  const chars = [...value]
  let controls = 0
  let letters = 0

  for (const ch of chars) {
    const code = ch.codePointAt(0)!
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || (code >= 0x7f && code <= 0x9f)) controls++
    else if (/\p{L}|\p{N}/u.test(ch)) letters++
  }

  // One control character in a hundred is already more than real text carries.
  if (controls > 0 && controls / chars.length > 0.01) return false
  return letters / chars.length > 0.5
}

/**
 * A last gate over the whole document.
 *
 * Individual runs can each look plausible while the document as a whole is
 * clearly not language — a page of glyph indices that happen to land on letters
 * produces exactly that. Prose has spaces at a fairly stable rate and words of
 * ordinary length; noise has neither.
 *
 * Returning nothing is the right answer when this fails. A document that is
 * findable by name and honest about having no text beats one that matches
 * searches for `Ôuuáv`.
 */
function isProse(text: string): boolean {
  if (text.length < 24) return false

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 8) return false

  // Real writing runs about one space in every five to eight characters.
  const spaceRatio = (text.length - text.replace(/\s/g, '').length) / text.length
  if (spaceRatio < 0.06) return false

  // And its words are short. Glyph noise produces very long unbroken runs.
  const typical = words.filter((w) => w.length <= 18).length / words.length
  if (typical < 0.8) return false

  // Finally, a real document contains real words.
  const wordLike = words.filter((w) => /^[\p{L}][\p{L}'’-]{2,}[.,;:!?)"']?$/u.test(w)).length
  return wordLike / words.length > 0.4
}

/** Every stream in the file, inflated where possible. */
function extractStreams(data: Buffer): string[] {
  const out: string[] = []
  let cursor = 0
  let found = 0

  while (found < MAX_STREAMS) {
    const start = data.indexOf('stream', cursor, 'latin1')
    if (start === -1) break

    // Skip the EOL that must follow the keyword.
    let dataStart = start + 6
    if (data[dataStart] === 0x0d) dataStart++
    if (data[dataStart] === 0x0a) dataStart++

    const end = data.indexOf('endstream', dataStart, 'latin1')
    if (end === -1) break

    const chunk = data.subarray(dataStart, end)
    cursor = end + 9
    found++

    // The dictionary immediately before the keyword says how it was encoded.
    const header = data.toString('latin1', Math.max(0, start - 400), start)
    if (/\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(header)) continue

    if (/\/FlateDecode/.test(header)) {
      try {
        out.push(zlib.inflateSync(chunk).toString('latin1'))
      } catch {
        try {
          // Some producers omit the zlib header entirely.
          out.push(zlib.inflateRawSync(chunk).toString('latin1'))
        } catch {
          // An unreadable stream is one page's worth of text, not a failure.
        }
      }
      continue
    }

    if (!/\/[A-Za-z0-9]*Decode/.test(header)) out.push(chunk.toString('latin1'))
  }

  return out
}

/** Read the text-showing operators out of one content stream. */
function textFromStream(stream: string): string[] {
  const pieces: string[] = []

  // `(text) Tj`, `[(a) -20 (b)] TJ`, and the quote operators that also move the
  // line. Strings are collected wherever they appear before a show operator,
  // which is looser than parsing properly but survives malformed streams.
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bTJ\b|\bTj\b|\bT\*\b|\bTD\b|\bTd\b|'|"/g

  let pending: string[] = []
  let match: RegExpExecArray | null

  const flush = (breakLine: boolean): void => {
    if (pending.length > 0) {
      const joined = pending.join('')
      if (looksLikeText(joined)) pieces.push(joined)
      pending = []
    }
    if (breakLine) pieces.push('\n')
  }

  while ((match = re.exec(stream)) !== null) {
    const token = match[0]
    if (token.startsWith('(')) {
      pending.push(decodeLiteral(token.slice(1, -1)))
    } else if (token.startsWith('<')) {
      pending.push(decodeHex(token.slice(1, -1)))
    } else if (token === 'Tj' || token === 'TJ') {
      flush(false)
    } else if (token === "'" || token === '"' || token === 'T*' || token === 'TD' || token === 'Td') {
      flush(true)
    }
  }
  flush(false)

  return pieces
}

export interface PdfText {
  text: string
  /** Best-effort page count, from the page tree rather than from the text. */
  pages: number
  title: string | null
}

export function extractPdfText(data: Buffer, limit = 400_000): PdfText {
  const head = data.toString('latin1', 0, Math.min(data.length, 4_000_000))

  // `/Count n` on the page tree root is the reliable figure; counting `/Type
  // /Page` misses documents that share page objects.
  const counts = [...head.matchAll(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1])
  )
  const pages = counts.length > 0 ? Math.max(...counts) : (head.match(/\/Type\s*\/Page[^s]/g) ?? []).length

  const titleMatch = /\/Title\s*\((?:\\.|[^\\()])*\)/.exec(head)
  const title = titleMatch ? decodeLiteral(titleMatch[0].slice(titleMatch[0].indexOf('(') + 1, -1)).trim() : null

  const chunks: string[] = []
  let total = 0
  for (const stream of extractStreams(data)) {
    for (const piece of textFromStream(stream)) {
      chunks.push(piece)
      total += piece.length
      // A long document only needs enough text to be findable; indexing an
      // 800-page manual in full would cost far more than it returns.
      if (total > limit) break
    }
    if (total > limit) break
  }

  const text = chunks
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text: isProse(text) ? text : '', pages: pages || 0, title: title || null }
}

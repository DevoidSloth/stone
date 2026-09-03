/**
 * The syntax that ties a line of notes to a moment in a recording.
 *
 * A stamped line opens with an ordinary markdown link to the audio file
 * carrying a media fragment:
 *
 *     [12:04](lecture 2026-08-27.webm#t=724) Eigenvalues are the fixed axes
 *
 * Nothing here is a private format. The link works in any markdown reader, the
 * `#t=` fragment is the W3C media fragment every browser already honours, and
 * a vault opened in some other app still shows a clickable time next to the
 * note it belongs to. Stone only draws it more nicely: live preview replaces
 * the link with a chip in the gutter and wires it to the player.
 *
 * Shared rather than owned by the editor because both sides need it — the
 * recorder writes stamps, live preview reads them, the player builds a seek
 * index from them, and the Claude context strips them back out.
 */

/** `12:04` and `1:02:04`, so an hour-long lecture reads the way a clock does. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** The inverse, for a clock a person typed or Claude cited. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null
  return parts.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1]
}

/**
 * The link target that names an audio file from inside a note.
 *
 * A file in the attachments folder is written as a bare name, because that is
 * where `resolveAssetPath` looks first and a bare name keeps the raw markdown
 * readable — a stamp on every paragraph is a lot of path to repeat otherwise.
 * Anything else keeps its vault-rooted path, which is unambiguous.
 */
export function stampTarget(audioRelPath: string, attachmentsFolder: string): string {
  const folder = attachmentsFolder.replace(/^\/+|\/+$/g, '')
  const prefix = folder ? `${folder}/` : ''
  const bare =
    prefix && audioRelPath.startsWith(prefix) ? audioRelPath.slice(prefix.length) : null
  const path = bare && !bare.includes('/') ? bare : `/${audioRelPath}`
  return path.split('/').map(encodeURIComponent).join('/')
}

/** The marker that goes at the head of a line, trailing space included. */
export function stampMarkdown(seconds: number, target: string): string {
  // Whole seconds: sub-second precision is noise against a person deciding
  // when a thought started, and it doubles the width of every marker.
  return `[${formatClock(seconds)}](${target}#t=${Math.max(0, Math.round(seconds))}) `
}

/**
 * A stamp at the very start of a line.
 *
 * Anchored deliberately. A time link *inside* a sentence is a citation the
 * reader wrote on purpose and should stay visible as a link; only the leading
 * one is the recorder's own bookkeeping, and only that one is pulled out into
 * the gutter.
 */
const STAMP_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\(([^)\s]+?)#t=(\d+(?:\.\d+)?)\)[ \t]?/

export interface Stamp {
  /** Seconds into the recording. */
  seconds: number
  /** The `#t=`-less link target, still percent-encoded. */
  target: string
  clock: string
  /** Characters the marker occupies, from the start of the line. */
  length: number
}

export function readStamp(lineText: string): Stamp | null {
  const found = STAMP_RE.exec(lineText)
  if (!found) return null
  return {
    clock: found[1],
    target: found[2],
    seconds: Number(found[3]),
    length: found[0].length
  }
}

/** True when a stamp would be redundant — the line already carries one. */
export function hasStamp(lineText: string): boolean {
  return STAMP_RE.test(lineText)
}

/**
 * A line's stamp goes after its list marker, not before it.
 *
 * `- [12:04](…) point` keeps the bullet a bullet; putting the link first turns
 * the line into a paragraph that happens to start with a dash, and the outline,
 * the folding and the task parser all stop recognising it.
 */
const LEAD_RE = /^(\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX~/>!-]\]\s+)?|>\s+)?)/

export function stampInsertPoint(lineText: string): number {
  return LEAD_RE.exec(lineText)?.[1].length ?? 0
}

/** The note as prose, with the recorder's markers taken back out. */
export function stripStamps(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const at = stampInsertPoint(line)
      const stamp = readStamp(line.slice(at))
      return stamp ? line.slice(0, at) + line.slice(at + stamp.length) : line
    })
    .join('\n')
}

/**
 * Every stamped line in a note, in document order.
 *
 * This is what "follow along" runs on: given the player's position, the line
 * to highlight is the last one whose stamp has already passed.
 */
export interface StampEntry {
  /** One-based, to match how CodeMirror numbers lines. */
  line: number
  seconds: number
  target: string
}

export function stampIndex(text: string): StampEntry[] {
  const out: StampEntry[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const stamp = readStamp(lines[i].slice(stampInsertPoint(lines[i])))
    if (stamp) out.push({ line: i + 1, seconds: stamp.seconds, target: stamp.target })
  }
  return out
}

/** The last entry at or before `seconds`, by binary search. */
export function stampAt(index: StampEntry[], seconds: number): StampEntry | null {
  let lo = 0
  let hi = index.length - 1
  let found: StampEntry | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (index[mid].seconds <= seconds) {
      found = index[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * `[12:04]` and `(1:02:04)` in a block of prose — how Claude cites a moment.
 *
 * Loose on purpose: the model is told to write bare clock times and mostly
 * does, but a stray bracket should still land the reader in the right place
 * rather than being printed as literal punctuation.
 */
export const CITATION_RE = /[[(]?\b(\d{1,2}:\d{2}(?::\d{2})?)\b[\])]?/g

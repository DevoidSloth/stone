/**
 * Minimal, surgical frontmatter editing.
 *
 * Page icons and covers are stored as ordinary YAML keys so the note stays
 * portable. Rewriting the block with a YAML serialiser would reformat and
 * reorder everything the user wrote, so these helpers touch one line and leave
 * the rest of the file byte-for-byte intact.
 */

const BLOCK_RE = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/

function keyLineRe(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
}

/**
 * Values YAML would read as something other than the text that was typed: a
 * number (`icon: 7`), a boolean, or a line starting with an indicator such as
 * `#`, `>` or `*`. Page icons run straight into all three, and an unquoted one
 * comes back from the indexer as 7, as null, or as a parse error.
 */
const YAML_INDICATOR_RE = /^[-?:,[\]{}#&*!|>'"%@`]/
const YAML_NUMBER_RE = /^[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$|^0[xob]/i
const YAML_KEYWORD_RE = /^(?:true|false|yes|no|on|off|null|~)$/i

/** Quote a scalar when plain YAML would misread it; otherwise leave it bare. */
export function yamlScalar(value: string): string {
  const bare =
    value.length > 0 &&
    value === value.trim() &&
    !YAML_INDICATOR_RE.test(value) &&
    !YAML_NUMBER_RE.test(value) &&
    !YAML_KEYWORD_RE.test(value) &&
    !value.includes(': ') &&
    !/\s#/.test(value)
  return bare ? value : `'${value.replace(/'/g, "''")}'`
}

/** Undo `yamlScalar`, and the plain quoting a hand-edited note might use. */
function unquote(value: string): string {
  const quote = value[0]
  if ((quote === "'" || quote === '"') && value.length > 1 && value.endsWith(quote)) {
    const inner = value.slice(1, -1)
    return quote === "'" ? inner.replace(/''/g, "'") : inner
  }
  return value
}

/** Read a single scalar key, or null when absent. */
export function readFrontmatterKey(raw: string, key: string): string | null {
  const m = BLOCK_RE.exec(raw)
  if (!m) return null
  for (const line of m[2].split(/\r?\n/)) {
    if (keyLineRe(key).test(line)) {
      return unquote(line.slice(line.indexOf(':') + 1).trim()) || null
    }
  }
  return null
}

/**
 * Set or remove a scalar key. Creates the frontmatter block when the note has
 * none, and removes the block entirely when the last key is cleared.
 */
export function setFrontmatterKey(raw: string, key: string, value: string | null): string {
  const m = BLOCK_RE.exec(raw)

  if (!m) {
    if (value === null) return raw
    return `---\n${key}: ${value}\n---\n\n${raw}`
  }

  const [full, open, block, close] = m
  const rest = raw.slice(full.length)
  const lines = block.split(/\r?\n/)
  const index = lines.findIndex((line) => keyLineRe(key).test(line))

  if (value === null) {
    if (index === -1) return raw
    lines.splice(index, 1)
  } else if (index >= 0) {
    lines[index] = `${key}: ${value}`
  } else {
    lines.push(`${key}: ${value}`)
  }

  const next = lines.join('\n')
  // An empty block would leave a bare `---` pair, which markdown reads as a rule.
  if (!next.trim()) return rest.replace(/^\r?\n/, '')
  return `${open}${next}${close}${rest}`
}

/**
 * Read a key that may hold a list, in either YAML shape:
 *
 *   tags: [a, b]        tags:
 *                         - a
 *                         - b
 */
export function readFrontmatterList(raw: string, key: string): string[] {
  const m = BLOCK_RE.exec(raw)
  if (!m) return []
  const lines = m[2].split(/\r?\n/)
  const index = lines.findIndex((line) => keyLineRe(key).test(line))
  if (index === -1) return []

  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim()
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const out: string[] = []
  for (let i = index + 1; i < lines.length; i++) {
    const item = /^\s*-\s+(.*)$/.exec(lines[i])
    if (!item) break
    out.push(item[1].trim().replace(/^["']|["']$/g, ''))
  }
  return out
}

/** Write a list key in the inline `[a, b]` form, or remove it when empty. */
export function setFrontmatterList(raw: string, key: string, values: string[]): string {
  const cleaned = values.map((v) => v.trim()).filter(Boolean)
  const existing = readFrontmatterList(raw, key)

  // Drop any block-form items first, so we never leave orphaned `- ` lines.
  let working = raw
  if (existing.length > 0) {
    const m = BLOCK_RE.exec(working)
    if (m) {
      const lines = m[2].split(/\r?\n/)
      const index = lines.findIndex((line) => keyLineRe(key).test(line))
      if (index >= 0) {
        let end = index + 1
        while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++
        lines.splice(index, end - index)
        const next = lines.join('\n')
        const rest = working.slice(m[0].length)
        working = next.trim() ? `${m[1]}${next}${m[3]}${rest}` : rest.replace(/^\r?\n/, '')
      }
    }
  }

  if (cleaned.length === 0) return working
  return setFrontmatterKey(working, key, `[${cleaned.join(', ')}]`)
}

/** Every key present in the block, in file order. */
export function listFrontmatterKeys(raw: string): string[] {
  const m = BLOCK_RE.exec(raw)
  if (!m) return []
  const keys: string[] = []
  for (const line of m[2].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+)\s*:/.exec(line)
    if (k) keys.push(k[1])
  }
  return keys
}

/** True when the raw text of a frontmatter value looks like a YAML list. */
export function isListValue(raw: string, key: string): boolean {
  const m = BLOCK_RE.exec(raw)
  if (!m) return false
  const lines = m[2].split(/\r?\n/)
  const index = lines.findIndex((line) => keyLineRe(key).test(line))
  if (index === -1) return false
  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim()
  if (inline.startsWith('[')) return true
  return index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])
}

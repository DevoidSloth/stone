/**
 * What a block of code defines, read off the source.
 *
 * This is what the Code panel shows: a name, what kind of thing it is, and the
 * shortest true answer to "as what?" — a signature for a function, the
 * right-hand side for a variable, the base class for a class. It is the view a
 * debugger gives you of a frame, for a program that has not been run.
 *
 * It is emphatically not a parser, and does not pretend to be. Sixteen
 * languages each with a real grammar is an order of magnitude more machinery
 * than a side panel can justify, and would still be wrong on the one dialect
 * the user cares about. What is here is a line-oriented reading: comments and
 * string bodies are blanked first — with every index left where it was, so line
 * numbers stay true — and then each language's declarations are matched against
 * what is left. The failure mode is a missed declaration or an extra one, never
 * a wrong line number or a name that is not in the file.
 *
 * Nesting is tracked by indentation rather than by braces for the same reason:
 * it is the one signal every language in the table agrees on, and it is enough
 * to tell a top-level definition from a method inside a class, which is the
 * only distinction the panel draws.
 */

export type SymbolKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'constant'
  | 'type'
  | 'import'
  | 'field'

export interface CodeSymbol {
  name: string
  kind: SymbolKind
  /** What it is, in the language's own words. Empty when the name says it all. */
  detail: string
  /** Line within the block, counting the first line of code as 1. */
  line: number
  /** Whether it sits at the outermost level — a member rather than a local. */
  top: boolean
}

/**
 * Comments and string bodies, replaced by spaces.
 *
 * Every index is preserved, so a match found in the blanked copy can be sliced
 * out of the original: the panel shows what the person wrote, not this. The
 * point is that `# class Foo` in a comment and `"def x"` in a string are not
 * declarations, and a regex over raw source cannot tell.
 */
function blank(code: string, comments: string[]): string {
  const out = code.split('')
  let i = 0
  const at = (n: number): string => code[n] ?? ''

  while (i < code.length) {
    const c = code[i]
    const next = at(i + 1)

    // Line comments, in whichever markers this language uses.
    if (comments.some((marker) => code.startsWith(marker, i))) {
      while (i < code.length && code[i] !== '\n') out[i++] = ' '
      continue
    }

    // Block comments. Newlines inside are kept so line numbers survive.
    if (c === '/' && next === '*') {
      out[i++] = ' '
      out[i++] = ' '
      while (i < code.length && !(code[i] === '*' && at(i + 1) === '/')) {
        if (code[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < code.length) {
        out[i++] = ' '
        out[i++] = ' '
      }
      continue
    }

    // Strings, in all four quotes the table's languages use. An unterminated
    // one runs to the end of the line rather than eating the rest of the block.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\n' && quote !== '`') break
        if (code[i] === '\\') {
          if (code[i] !== '\n') out[i] = ' '
          i++
          if (i < code.length && code[i] !== '\n') out[i] = ' '
          i++
          continue
        }
        if (code[i] !== '\n') out[i] = ' '
        i++
      }
      i++
      continue
    }

    i++
  }

  return out.join('')
}

/** The right-hand side of an assignment, trimmed to something a panel can show. */
function value(raw: string): string {
  const text = raw.trim().replace(/[;,]\s*$/, '').replace(/\s+/g, ' ')
  if (text.length <= 44) return text
  return `${text.slice(0, 43)}…`
}

/** A quoted module path, as the person wrote it minus the quotes. */
function unquote(raw: string): string {
  return raw.trim().replace(/[;,]$/, '').replace(/^['"`]|['"`]$/g, '')
}

/** A parameter list, collapsed to just its shape. */
function signature(raw: string): string {
  const inner = raw.trim().replace(/\s+/g, ' ')
  return inner.length <= 40 ? `(${inner})` : `(${inner.slice(0, 39)}…)`
}

/**
 * The capture groups of a match, sliced out of the *original* line.
 *
 * Matching happens against the blanked copy, so that a `#` inside a string
 * cannot start a comment and a brace inside one cannot close a block. But the
 * text shown to the reader has to be what they wrote, and the blanked copy has
 * `"hello"` in it as two quotes around three spaces. Blanking preserves every
 * index, so the match's own group offsets read straight out of the real line.
 */
type Groups = string[]

interface Rule {
  re: RegExp
  kind: SymbolKind
  /** Builds the name and the detail from the match. */
  read: (m: Groups) => { name: string; detail: string } | null
}

const fn = (name: string, args: string): { name: string; detail: string } => ({
  name,
  detail: signature(args)
})

/**
 * The rules, per language family.
 *
 * Each is matched against one blanked line at a time, so `^` means the start of
 * a line and leading whitespace has already been measured off for the nesting
 * flag. Order matters only where two rules could both fire; the first wins.
 */
const RULES: Record<string, Rule[]> = {
  javascript: [
    // The module path is a string, so by the time this runs it is a run of
    // spaces: nothing inside the quotes can be matched on, only its extent.
    {
      re: /^import\s+(.+?)\s+from\s+(.+)$/,
      kind: 'import',
      read: (m) => ({ name: m[1].replace(/\s+/g, ' ').trim(), detail: unquote(m[2]) })
    },
    {
      re: /^import\s+(.+)$/,
      kind: 'import',
      read: (m) => ({ name: unquote(m[1]), detail: '' })
    },
    {
      re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
      kind: 'function',
      read: (m) => fn(m[1], m[2])
    },
    {
      re: /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([\w$.]+))?/,
      kind: 'class',
      read: (m) => ({ name: m[1], detail: m[2] ? `extends ${m[2]}` : '' })
    },
    {
      re: /^(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*(.+))?/,
      kind: 'type',
      read: (m) => ({ name: m[1], detail: m[2] ? value(m[2]) : '' })
    },
    // An arrow or a function expression is a function however it was bound.
    {
      re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/,
      kind: 'function',
      read: (m) => fn(m[1], m[2] ?? m[3] ?? '')
    },
    {
      re: /^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w${[\]}]*)\s*(?::\s*([^=]+?))?\s*=\s*(.+)/,
      kind: 'variable',
      read: (m) => ({
        name: m[2],
        detail: m[3] ? `${m[3].trim()} = ${value(m[4])}` : value(m[4])
      })
    },
    {
      // A method inside a class, which is the one shape not caught above.
      re: /^(?:static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/,
      kind: 'function',
      read: (m) => (m[1] === 'if' || m[1] === 'for' || m[1] === 'while' || m[1] === 'switch' || m[1] === 'catch' ? null : fn(m[1], m[2]))
    }
  ],

  python: [
    {
      re: /^(?:from\s+([\w.]+)\s+)?import\s+(.+)/,
      kind: 'import',
      read: (m) => ({ name: m[2].trim(), detail: m[1] ?? '' })
    },
    {
      re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?/,
      kind: 'function',
      read: (m) => ({ name: m[1], detail: `${signature(m[2])}${m[3] ? ` → ${m[3].trim()}` : ''}` })
    },
    {
      re: /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/,
      kind: 'class',
      read: (m) => ({ name: m[1], detail: m[2]?.trim() ? `(${m[2].trim()})` : '' })
    },
    {
      re: /^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=\s*(.+)/,
      kind: 'variable',
      read: (m) => ({
        name: m[1],
        detail: m[2] ? `${m[2].trim()} = ${value(m[3])}` : value(m[3])
      })
    }
  ],

  java: [
    { re: /^import\s+(?:static\s+)?([\w.*]+)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^(?:(?:public|private|protected|static|final|abstract|sealed)\s+)*(class|interface|enum|record)\s+(\w+)(?:\s*\([^)]*\))?(?:\s+extends\s+([\w.<>]+))?(?:\s+implements\s+([\w.,<>\s]+))?/,
      kind: 'class',
      read: (m) => ({
        name: m[2],
        detail: [
          m[1] === 'class' ? '' : m[1],
          m[3] ? `extends ${m[3]}` : '',
          m[4] ? `implements ${m[4].trim()}` : ''
        ]
          .filter(Boolean)
          .join(' ')
      })
    },
    {
      re: /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*([\w.<>,\[\]?\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws [\w.,\s]+)?\{?\s*$/,
      kind: 'function',
      read: (m) => {
        const type = m[1].trim()
        if (/^(if|for|while|switch|catch|return|new)$/.test(type)) return null
        return { name: m[2], detail: `${signature(m[3])} → ${type}` }
      }
    },
    {
      re: /^(?:(?:public|private|protected|static|final|volatile|transient)\s+)*([\w.<>,\[\]]+)\s+(\w+)\s*=\s*(.+?);?\s*$/,
      kind: 'variable',
      read: (m) => ({ name: m[2], detail: `${m[1]} = ${value(m[3])}` })
    },
    {
      re: /^(?:(?:public|private|protected|static|final)\s+)+([\w.<>,\[\]]+)\s+(\w+)\s*;/,
      kind: 'field',
      read: (m) => ({ name: m[2], detail: m[1] })
    }
  ],

  go: [
    { re: /^import\s+(?:\(|"([^"]*)")/, kind: 'import', read: (m) => (m[1] ? { name: m[1], detail: '' } : null) },
    {
      re: /^func\s*(?:\(([^)]*)\)\s*)?(\w+)\s*\(([^)]*)\)\s*([\w.*\[\]]+)?/,
      kind: 'function',
      read: (m) => ({
        name: m[2],
        detail: `${signature(m[3])}${m[4] ? ` → ${m[4]}` : ''}${m[1] ? `  on ${m[1].trim()}` : ''}`
      })
    },
    {
      re: /^type\s+(\w+)\s+(.+)/,
      kind: 'type',
      read: (m) => ({ name: m[1], detail: value(m[2].replace(/\{\s*$/, '')) })
    },
    {
      re: /^(?:var|const)\s+(\w+)(?:\s+([\w.*\[\]]+))?\s*(?:=\s*(.+))?/,
      kind: 'variable',
      read: (m) => ({ name: m[1], detail: [m[2], m[3] ? `= ${value(m[3])}` : ''].filter(Boolean).join(' ') })
    },
    {
      re: /^(\w+)\s*:=\s*(.+)/,
      kind: 'variable',
      read: (m) => ({ name: m[1], detail: value(m[2]) })
    }
  ],

  rust: [
    { re: /^use\s+(.+?);/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^{;]+))?/,
      kind: 'function',
      read: (m) => ({ name: m[1], detail: `${signature(m[2])}${m[3] ? ` → ${m[3].trim()}` : ''}` })
    },
    {
      re: /^(?:pub\s+)?(struct|enum|trait|union)\s+(\w+)/,
      kind: 'class',
      read: (m) => ({ name: m[2], detail: m[1] })
    },
    { re: /^impl(?:<[^>]*>)?\s+(.+?)\s*\{/, kind: 'type', read: (m) => ({ name: m[1], detail: 'impl' }) },
    { re: /^(?:pub\s+)?type\s+(\w+)\s*=\s*(.+?);/, kind: 'type', read: (m) => ({ name: m[1], detail: value(m[2]) }) },
    {
      re: /^(?:pub\s+)?(?:const|static)\s+(?:mut\s+)?(\w+)\s*:\s*([^=]+)=\s*(.+?);/,
      kind: 'constant',
      read: (m) => ({ name: m[1], detail: `${m[2].trim()} = ${value(m[3])}` })
    },
    {
      re: /^let\s+(?:mut\s+)?(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(.+)/,
      kind: 'variable',
      read: (m) => ({ name: m[1], detail: m[2] ? `${m[2].trim()} = ${value(m[3])}` : value(m[3]) })
    }
  ],

  c: [
    { re: /^#include\s*[<"]([^>"]+)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    // Two rules rather than one optional group: a macro that takes arguments is
    // a function, and telling it from `#define N 40` is what the parens say.
    {
      re: /^#define\s+(\w+)\(([^)]*)\)\s*(.*)/,
      kind: 'function',
      read: (m) => ({ name: m[1], detail: signature(m[2]) })
    },
    {
      re: /^#define\s+(\w+)\s+(.*)/,
      kind: 'constant',
      read: (m) => ({ name: m[1], detail: value(m[2]) })
    },
    {
      re: /^(?:(?:static|inline|extern|const|unsigned|virtual)\s+)*([\w:<>,\s*&]+?)\s+\*?(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?\{?\s*$/,
      kind: 'function',
      read: (m) => {
        const type = m[1].trim()
        if (/^(if|for|while|switch|return|else)$/.test(type)) return null
        return { name: m[2], detail: `${signature(m[3])} → ${type}` }
      }
    },
    {
      re: /^(?:typedef\s+)?(struct|class|union|enum)\s+(\w+)/,
      kind: 'class',
      read: (m) => ({ name: m[2], detail: m[1] })
    },
    {
      re: /^(?:(?:static|const|unsigned|extern)\s+)*([\w:<>,\s*]+?)\s+\*?(\w+)\s*=\s*(.+?);/,
      kind: 'variable',
      read: (m) => ({ name: m[2], detail: `${m[1].trim()} = ${value(m[3])}` })
    }
  ],

  ruby: [
    { re: /^require(?:_relative)?\s+['"]?([^'"]*)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^def\s+(?:self\.)?([\w?!=]+)\s*(?:\(([^)]*)\))?/,
      kind: 'function',
      read: (m) => fn(m[1], m[2] ?? '')
    },
    {
      re: /^(class|module)\s+([\w:]+)(?:\s*<\s*([\w:]+))?/,
      kind: 'class',
      read: (m) => ({
        name: m[2],
        detail: [m[1] === 'class' ? '' : m[1], m[3] ? `< ${m[3]}` : ''].filter(Boolean).join(' ')
      })
    },
    {
      re: /^(@{0,2}[A-Za-z_]\w*)\s*=\s*(.+)/,
      kind: 'variable',
      read: (m) => ({ name: m[1], detail: value(m[2]) })
    }
  ],

  php: [
    { re: /^(?:use|require|include)(?:_once)?\s+['"]?([^'";]+)/, kind: 'import', read: (m) => ({ name: m[1].trim(), detail: '' }) },
    {
      re: /^(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(\w+)\s*\(([^)]*)\)/,
      kind: 'function',
      read: (m) => fn(m[1], m[2])
    },
    {
      re: /^(?:abstract\s+|final\s+)?(class|interface|trait)\s+(\w+)(?:\s+extends\s+(\w+))?/,
      kind: 'class',
      read: (m) => ({
        name: m[2],
        detail: [m[1] === 'class' ? '' : m[1], m[3] ? `extends ${m[3]}` : ''].filter(Boolean).join(' ')
      })
    },
    { re: /^\$(\w+)\s*=\s*(.+?);?\s*$/, kind: 'variable', read: (m) => ({ name: `$${m[1]}`, detail: value(m[2]) }) }
  ],

  lua: [
    {
      re: /^(?:local\s+)?function\s+([\w.:]+)\s*\(([^)]*)\)/,
      kind: 'function',
      read: (m) => fn(m[1], m[2])
    },
    {
      re: /^(?:local\s+)?([\w.]+)\s*=\s*function\s*\(([^)]*)\)/,
      kind: 'function',
      read: (m) => fn(m[1], m[2])
    },
    { re: /^local\s+([\w,\s]+?)\s*=\s*(.+)/, kind: 'variable', read: (m) => ({ name: m[1].trim(), detail: value(m[2]) }) }
  ],

  r: [
    { re: /^library\(([^)]*)\)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^([\w.]+)\s*(?:<-|=)\s*function\s*\(([^)]*)\)/,
      kind: 'function',
      read: (m) => fn(m[1], m[2])
    },
    { re: /^([\w.]+)\s*(?:<-|=)\s*(.+)/, kind: 'variable', read: (m) => ({ name: m[1], detail: value(m[2]) }) }
  ],

  bash: [
    {
      re: /^(?:function\s+)?([\w-]+)\s*\(\s*\)\s*\{?/,
      kind: 'function',
      read: (m) => ({ name: m[1], detail: '()' })
    },
    {
      re: /^(?:(export|local|declare|readonly)\s+)?([A-Za-z_]\w*)=(.*)/,
      kind: 'variable',
      read: (m) => ({ name: m[2], detail: [m[1], value(m[3])].filter(Boolean).join(' ') })
    }
  ],

  swift: [
    { re: /^import\s+(\w+)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^(?:(?:public|private|internal|fileprivate|static|final|override|mutating)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*(?:async\s*)?(?:throws\s*)?->\s*(.+))?/,
      kind: 'function',
      read: (m) => ({ name: m[1], detail: `${signature(m[2])}${m[3] ? ` → ${m[3].trim()}` : ''}` })
    },
    {
      re: /^(?:(?:public|private|internal|final)\s+)*(class|struct|enum|protocol|extension|actor)\s+(\w+)(?:\s*:\s*(.+))?/,
      kind: 'class',
      read: (m) => ({
        name: m[2],
        detail: [m[1] === 'class' ? '' : m[1], m[3] ? `: ${m[3].trim()}` : ''].filter(Boolean).join(' ')
      })
    },
    {
      re: /^(?:(?:public|private|static|lazy)\s+)*(let|var)\s+(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/,
      kind: 'variable',
      read: (m) => ({
        name: m[2],
        detail: [m[3]?.trim(), m[4] ? `= ${value(m[4])}` : ''].filter(Boolean).join(' ')
      })
    }
  ],

  powershell: [
    { re: /^function\s+([\w-]+)/, kind: 'function', read: (m) => ({ name: m[1], detail: '' }) },
    { re: /^\$(\w+)\s*=\s*(.+)/, kind: 'variable', read: (m) => ({ name: `$${m[1]}`, detail: value(m[2]) }) }
  ],

  perl: [
    { re: /^use\s+([\w:]+)/, kind: 'import', read: (m) => ({ name: m[1], detail: '' }) },
    { re: /^sub\s+(\w+)/, kind: 'function', read: (m) => ({ name: m[1], detail: '' }) },
    {
      re: /^(?:my|our|local)\s+([$@%]\w+)\s*=\s*(.+?);?\s*$/,
      kind: 'variable',
      read: (m) => ({ name: m[1], detail: value(m[2]) })
    }
  ]
}

/** Languages that share a table, and the `#`-comment fact `blank` needs. */
const SLASH = ['//']
const HASH = ['#']

const FAMILY: Record<string, { rules: string; comments: string[] }> = {
  javascript: { rules: 'javascript', comments: SLASH },
  typescript: { rules: 'javascript', comments: SLASH },
  python: { rules: 'python', comments: HASH },
  java: { rules: 'java', comments: SLASH },
  go: { rules: 'go', comments: SLASH },
  rust: { rules: 'rust', comments: SLASH },
  c: { rules: 'c', comments: SLASH },
  cpp: { rules: 'c', comments: SLASH },
  ruby: { rules: 'ruby', comments: HASH },
  // PHP writes all three, and a block often opens with a `//` line.
  php: { rules: 'php', comments: ['#', '//'] },
  lua: { rules: 'lua', comments: ['--'] },
  r: { rules: 'r', comments: HASH },
  bash: { rules: 'bash', comments: HASH },
  zsh: { rules: 'bash', comments: HASH },
  swift: { rules: 'swift', comments: SLASH },
  powershell: { rules: 'powershell', comments: HASH },
  perl: { rules: 'perl', comments: HASH }
}

/**
 * The rules for a family, with `d` added so a match reports its group offsets.
 *
 * Compiled once and kept: the panel re-reads every block on every keystroke,
 * and rebuilding twenty regexes each time is work for nothing.
 */
const CACHE = new Map<string, Rule[]>()

function compiled(family: string): Rule[] {
  const ready = CACHE.get(family)
  if (ready) return ready
  const built = RULES[family].map((rule) => ({
    ...rule,
    re: new RegExp(rule.re.source, `${rule.re.flags}d`)
  }))
  CACHE.set(family, built)
  return built
}

/**
 * A match's groups, taken from the untouched line rather than the blanked one.
 *
 * A group that did not participate comes back as `''` rather than undefined, so
 * a rule can test it for emptiness without every one of them having to say so.
 */
function groupsOf(match: RegExpExecArray, raw: string): Groups {
  const spans = match.indices
  return match.map((group, i) => {
    const span = spans?.[i]
    return span ? raw.slice(span[0], span[1]) : (group ?? '')
  })
}

/** Whether anything is known about a language's shape at all. */
export function readsSymbols(languageId: string): boolean {
  return languageId in FAMILY
}

/**
 * The declarations in a block, in the order they are written.
 *
 * A name declared twice keeps its last line, which is what a debugger would
 * show: the binding in force at the bottom of the block is the one the next
 * block in the session will see.
 */
export function symbolsIn(languageId: string, code: string): CodeSymbol[] {
  const family = FAMILY[languageId]
  if (!family) return []

  const rules = compiled(family.rules)
  const source = code.split('\n')
  const lines = blank(code, family.comments).split('\n')
  const found: CodeSymbol[] = []
  const seen = new Map<string, number>()

  lines.forEach((line, index) => {
    // Trailing whitespace in the blanked line is where a trailing comment used
    // to be, so cutting both lines there keeps `x = 42  # why` out of the value.
    const body = line.trimStart().trimEnd()
    if (!body) return
    const indent = line.length - line.trimStart().length
    const raw = (source[index] ?? '').slice(indent, indent + body.length)

    for (const rule of rules) {
      const match = rule.re.exec(body)
      if (!match) continue
      const read = rule.read(groupsOf(match, raw))
      if (!read || !read.name) continue

      const symbol: CodeSymbol = {
        name: read.name,
        kind: rule.kind,
        detail: read.detail,
        line: index + 1,
        top: indent === 0
      }

      const key = `${symbol.kind}:${symbol.name}`
      const at = seen.get(key)
      if (at === undefined) {
        seen.set(key, found.length)
        found.push(symbol)
      } else {
        found[at] = symbol
      }
      break
    }
  })

  return found
}

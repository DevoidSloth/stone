/**
 * The languages a fenced block can be run as.
 *
 * A "runner" is a shell command line, not an argv: the block is written to a
 * scratch file and the line is handed to the user's login shell. That is what
 * lets a language whose runner is really two steps — rustc then the binary —
 * sit in the same table as `python3 {file}`, and it is also how a command finds
 * its interpreter at all, since an app launched from the Finder inherits a PATH
 * with none of the places a version manager installs to.
 *
 * Placeholders, each substituted already quoted:
 *   {file}  the scratch file holding the block
 *   {dir}   the scratch directory it sits in, for compilers that emit a binary
 *   {name}  the file's base name without its extension
 */
export interface CodeLanguage {
  id: string
  label: string
  /** Extension the block is written under, so tools that switch on it agree. */
  ext: string
  /** The command line, run through the login shell. */
  command: string
  /** Used instead of `command` on Windows, where the names differ. */
  windows?: string
  /** Info strings that mean this language, `id` included. */
  aliases: string[]
  /**
   * How one particular block of this language runs, where a single command line
   * cannot say it. Java is the only one here that needs it, and needs all three
   * parts: the file name is part of the program, since `java Foo.java` runs the
   * class called `Foo`; a block with no `main` in it is compiled or handed to
   * jshell rather than launched; and the jshell path has a `/exit` appended to
   * close the session. The command a plan carries is still only a default — an
   * override in Settings is the user saying what to run, and wins.
   */
  plan?: (code: string, platform: string) => RunPlan
}

/** What a block turns into on disk, and the line that runs it there. */
export interface RunPlan {
  /** Base name for the scratch file, without its extension. */
  name: string
  /** What to write into it — the block itself, unless the language adds to it. */
  text: string
  /** The command line, in the same placeholders as the table's. */
  command: string
}

/**
 * Java's shape, as far as running a block needs to know it: what the block
 * declares at the top level, whether anything in it is an entry point, and
 * whether it is a compilation unit at all.
 *
 * These are questions about position rather than spelling — a type is top-level
 * only outside every brace, a `main` inside a nested class is not an entry
 * point the launcher will find, and the word `class` inside a string or a
 * comment is not a declaration. So literals and comments are blanked first,
 * every index left where it was, and everything after asks its question of that
 * copy. Indentation, which a snippet pasted out of a book or a slide always
 * has, then costs nothing.
 */
interface JavaType {
  name: string
  /** The keyword. */
  index: number
  /** Where the declaration starts, modifiers and annotations included. */
  from: number
  /** Just past its closing brace. */
  end: number
  isPublic: boolean
}

export interface JavaShape {
  types: JavaType[]
  /** Where a `main` is declared, or -1 when the block has no entry point. */
  mainAt: number
  /** Whether that `main` takes the `String[]`, which decides how to call it. */
  mainTakesArgs: boolean
  /** The package it declares, which decides where the file may sit. */
  packageName: string | null
  /**
   * Whether anything sits at the top level that is not a declaration — an
   * assignment, a call, a bare expression. javac rejects a file like that
   * whatever it is named; jshell is what runs it.
   */
  looseCode: boolean
}

/** Comments and literals, blanked to spaces so every other index still holds. */
function blankJavaLiterals(code: string): string {
  const out = code.split('')
  let i = 0
  const hide = (end: number): void => {
    for (; i < end && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '
  }

  while (i < code.length) {
    const two = code.slice(i, i + 2)
    if (two === '//') {
      const line = code.indexOf('\n', i)
      hide(line === -1 ? code.length : line)
    } else if (two === '/*') {
      const close = code.indexOf('*/', i + 2)
      hide(close === -1 ? code.length : close + 2)
    } else if (code.startsWith('"""', i)) {
      const close = code.indexOf('"""', i + 3)
      hide(close === -1 ? code.length : close + 3)
    } else if (code[i] === '"' || code[i] === "'") {
      const quote = code[i]
      let j = i + 1
      while (j < code.length && code[j] !== quote && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      hide(Math.min(j + 1, code.length))
    } else {
      i++
    }
  }
  return out.join('')
}

/**
 * Brace depth before each character, which is where `top-level` is decided.
 *
 * Braces inside parentheses are not scope: `@SuppressWarnings({"raw"})` above a
 * class would otherwise bury the class one level down and hide it, and the same
 * goes for a lambda body passed to a call.
 */
function javaDepths(code: string): Int32Array {
  const depth = new Int32Array(code.length)
  let level = 0
  let parens = 0
  for (let i = 0; i < code.length; i++) {
    depth[i] = level
    const char = code[i]
    if (char === '(') parens++
    else if (char === ')') parens = Math.max(0, parens - 1)
    else if (parens > 0) continue
    else if (char === '{') level++
    else if (char === '}') level = Math.max(0, level - 1)
  }
  return depth
}

/** Past a declaration's closing brace — or its semicolon, for a bodiless record. */
function javaTypeEnd(text: string, depth: Int32Array, at: number): number {
  for (let i = at; i < text.length; i++) {
    if (depth[i] === 0 && text[i] === ';') return i + 1
    if (depth[i] === 0 && text[i] === '{') {
      for (let j = i + 1; j < text.length; j++) if (depth[j] === 1 && text[j] === '}') return j + 1
      return text.length
    }
  }
  return text.length
}

const JAVA_TYPE_RE = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g
const JAVA_PACKAGE_RE = /(?:^|\n)\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/
const JAVA_IMPORT_RE = /\b(?:package|import)\s[^;]*;/g
/** A `main`, however declared — `static void main(String[])`, or Java 25's bare `void main()`. */
const JAVA_MAIN_RE = /\bvoid\s+main\s*\(/g

function scanJava(code: string): JavaShape {
  const text = blankJavaLiterals(code)
  const depth = javaDepths(text)
  const types: JavaType[] = []

  JAVA_TYPE_RE.lastIndex = 0
  for (let match = JAVA_TYPE_RE.exec(text); match; match = JAVA_TYPE_RE.exec(text)) {
    const at = match.index
    // Nested and local types are somebody else's members; `Foo.class` is a
    // value, not a declaration.
    if (depth[at] !== 0 || text[at - 1] === '.') continue
    // Modifiers and annotations keep their own lines often enough that the
    // declaration has to be taken as starting wherever the last one ended.
    const from = Math.max(
      0,
      text.lastIndexOf('}', at) + 1,
      text.lastIndexOf('{', at) + 1,
      text.lastIndexOf(';', at) + 1
    )
    types.push({
      name: match[1],
      index: at,
      from,
      end: javaTypeEnd(text, depth, at),
      isPublic: /\bpublic\b/.test(text.slice(from, at))
    })
  }

  let mainAt = -1
  let mainTakesArgs = false
  JAVA_MAIN_RE.lastIndex = 0
  for (let match = JAVA_MAIN_RE.exec(text); match; match = JAVA_MAIN_RE.exec(text)) {
    // Depth 0 is a compact source file's own `main`, depth 1 a method of a
    // top-level class. Deeper is a nested class's, which nothing launches.
    if (depth[match.index] <= 1) {
      mainAt = match.index
      const close = text.indexOf(')', match.index)
      mainTakesArgs = close > 0 && text.slice(text.indexOf('(', match.index) + 1, close).trim() !== ''
      break
    }
  }

  // What is left once the declarations and the package and import lines are
  // taken out. Anything still there — bar a stray semicolon, which is legal
  // after a class body and means nothing — is a statement someone means to run.
  const rest = text.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < rest.length; i++) if (rest[i] !== '\n') rest[i] = ' '
  }
  for (const type of types) blank(type.from, type.end)
  for (const match of text.matchAll(JAVA_IMPORT_RE)) blank(match.index, match.index + match[0].length)

  return {
    types,
    mainAt,
    mainTakesArgs,
    packageName: JAVA_PACKAGE_RE.exec(text)?.[1] ?? null,
    looseCode: /[^\s;]/.test(rest.join(''))
  }
}

export { scanJava as javaShape }

/** The type whose `main` will run: the last one opened before it. */
function javaEntry(shape: JavaShape): string | null {
  if (shape.mainAt < 0) return null
  return shape.types.filter((type) => type.index < shape.mainAt).pop()?.name ?? null
}

/**
 * The call that runs a block's `main`, for a session that has just declared it.
 *
 * jshell declares what it is given and runs what it is asked to; a class with a
 * `main` in it is only a declaration, so a block that is plainly a program —
 * the shape half a page of Java notes has — would otherwise light up green and
 * print nothing. Null when the block has no entry point, or when its own
 * statements already run something and nothing needs adding.
 */
export function javaEntryCall(code: string): string | null {
  const shape = scanJava(code)
  if (shape.mainAt < 0 || shape.looseCode) return null
  const args = shape.mainTakesArgs ? 'new String[0]' : ''
  const entry = javaEntry(shape)
  return entry ? `${entry}.main(${args});` : `main(${args});`
}

/**
 * Whether a block is a whole number of Java snippets.
 *
 * A session is fed over a pipe, and jshell answers an unclosed brace by waiting
 * for the rest of it — which would swallow the marker that says the block is
 * done and hang the session until the time limit. A block that does not balance
 * is handed to the one-shot runner instead, where javac says what is wrong with
 * it far better than Stone could.
 */
export function javaComplete(code: string): boolean {
  const text = blankJavaLiterals(code)
  let braces = 0
  let parens = 0
  let brackets = 0
  for (const char of text) {
    if (char === '{') braces++
    else if (char === '}') braces--
    else if (char === '(') parens++
    else if (char === ')') parens--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    if (braces < 0 || parens < 0 || brackets < 0) return false
  }
  return braces === 0 && parens === 0 && brackets === 0
}

/**
 * What to call the file, for the paths that are handed to javac.
 *
 * javac — unlike the launcher, which waives it — insists that a public type
 * live in a file of its own name. A block with no type at all keeps `main`:
 * a compact source file's implicit class takes the file's name, and that is
 * as good a name as any.
 */
function javaFileName(shape: JavaShape): string {
  if (shape.types.length === 0) return 'main'
  return (shape.types.find((type) => type.isPublic) ?? shape.types[0]).name
}

/**
 * How a Java block runs, which depends on what kind of thing it is.
 *
 * A block with a `main` is a program. The source-file launcher runs it with no
 * javac step and no class files left behind, and on Java 25 that includes a
 * compact source file — a bare `void main()` with no class around it. The
 * launcher picks the class by file name, so the file is named for whichever
 * type declares `main` rather than always `main`; otherwise a program whose
 * entry point is not the first thing it declares fails with `can't find class:
 * main`. A package is the one thing the launcher will not have, since it wants
 * the file to sit in a folder matching it, so those are compiled into the
 * scratch directory and started by qualified name instead.
 *
 * A block without a `main` is not a program, and notes are full of them. Where
 * it is only declarations — a couple of classes off a slide — it is compiled,
 * which says whether it is right and says nothing ran. Where statements sit
 * loose among the declarations, the way a textbook example puts a class next to
 * the few lines that exercise it, it is a script: javac would refuse the file
 * whatever it were named, so jshell runs it, which is what jshell is for. The
 * `/exit` is appended to end the session that the load leaves open; jshell does
 * not echo the value of an expression loaded from a file, so a script that
 * wants to show something prints it.
 */
export function javaPlan(code: string, platform: string): RunPlan {
  const shape = scanJava(code)
  const entry = javaEntry(shape)

  if (shape.mainAt >= 0) {
    if (shape.packageName && entry) {
      return {
        name: javaFileName(shape),
        text: code,
        command: `javac -d {dir} {file} && java -cp {dir} ${shape.packageName}.${entry}`
      }
    }
    return { name: entry ?? javaFileName(shape), text: code, command: 'java {file}' }
  }

  if (shape.looseCode) {
    return {
      name: javaFileName(shape),
      text: `${code}\n/exit\n`,
      // Its own VM would be a second startup for nothing; the run is already
      // its own process group, so a loop that will not end is still killable.
      command: 'jshell -q --execution local {file}'
    }
  }

  const note = 'Compiled cleanly. Nothing ran: the block declares no main method.'
  return {
    name: javaFileName(shape),
    text: code,
    command:
      platform === 'win32'
        ? `javac -d {dir} {file} && echo ${note}`
        : `javac -d {dir} {file} && echo ${JSON.stringify(note)}`
  }
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    // .mjs rather than .js: modules and top-level await work without the block
    // having to know what the nearest package.json says about them.
    ext: 'mjs',
    command: 'node {file}',
    aliases: ['javascript', 'js', 'node', 'mjs']
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    // Node strips types itself from 22.6 on. Older ones say so plainly, and
    // Settings is where a `tsx` or `bun` line goes instead.
    ext: 'ts',
    command: 'node --experimental-strip-types {file}',
    aliases: ['typescript', 'ts']
  },
  {
    id: 'python',
    label: 'Python',
    ext: 'py',
    command: 'python3 {file}',
    windows: 'python {file}',
    aliases: ['python', 'py', 'python3']
  },
  {
    id: 'bash',
    label: 'Bash',
    ext: 'sh',
    command: 'bash {file}',
    aliases: ['bash', 'sh', 'shell']
  },
  {
    id: 'zsh',
    label: 'Zsh',
    ext: 'sh',
    command: 'zsh {file}',
    aliases: ['zsh']
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    ext: 'ps1',
    command: 'pwsh -NoProfile -File {file}',
    windows: 'powershell -NoProfile -ExecutionPolicy Bypass -File {file}',
    aliases: ['powershell', 'pwsh', 'ps1']
  },
  {
    id: 'ruby',
    label: 'Ruby',
    ext: 'rb',
    command: 'ruby {file}',
    aliases: ['ruby', 'rb']
  },
  {
    id: 'php',
    label: 'PHP',
    ext: 'php',
    command: 'php {file}',
    aliases: ['php']
  },
  {
    id: 'perl',
    label: 'Perl',
    ext: 'pl',
    command: 'perl {file}',
    aliases: ['perl', 'pl']
  },
  {
    id: 'lua',
    label: 'Lua',
    ext: 'lua',
    command: 'lua {file}',
    aliases: ['lua']
  },
  {
    id: 'r',
    label: 'R',
    ext: 'R',
    command: 'Rscript {file}',
    aliases: ['r', 'rscript']
  },
  {
    id: 'go',
    label: 'Go',
    ext: 'go',
    command: 'go run {file}',
    aliases: ['go', 'golang']
  },
  {
    id: 'rust',
    label: 'Rust',
    ext: 'rs',
    command: 'rustc -o {dir}/{name} {file} && {dir}/{name}',
    windows: 'rustc -o {dir}/{name}.exe {file} && {dir}/{name}.exe',
    aliases: ['rust', 'rs']
  },
  {
    id: 'c',
    label: 'C',
    ext: 'c',
    command: 'cc -o {dir}/{name} {file} && {dir}/{name}',
    windows: 'cc -o {dir}/{name}.exe {file} && {dir}/{name}.exe',
    aliases: ['c']
  },
  {
    id: 'cpp',
    label: 'C++',
    ext: 'cpp',
    command: 'c++ -o {dir}/{name} {file} && {dir}/{name}',
    windows: 'c++ -o {dir}/{name}.exe {file} && {dir}/{name}.exe',
    aliases: ['cpp', 'c++', 'cxx']
  },
  {
    id: 'swift',
    label: 'Swift',
    ext: 'swift',
    command: 'swift {file}',
    aliases: ['swift']
  },
  {
    id: 'java',
    label: 'Java',
    ext: 'java',
    // A Java block is a program, a set of declarations, or a script, and the
    // three do not run the same way; `javaPlan` is where that is worked out.
    // This line is the program case, and what Settings shows as the default.
    command: 'java {file}',
    aliases: ['java'],
    plan: javaPlan
  }
]

const BY_ALIAS = new Map<string, CodeLanguage>()
for (const language of CODE_LANGUAGES) {
  for (const alias of language.aliases) BY_ALIAS.set(alias, language)
}

/**
 * The language a fence's info string names, or null when nothing runs it.
 *
 * `overrides` is the user's table from Settings, keyed by language id. It also
 * carries languages Stone ships no runner for at all: an entry under a name
 * that is not in the table above makes that name runnable, which is the whole
 * extension mechanism.
 */
export function languageFor(
  info: string,
  overrides: Record<string, string> = {}
): CodeLanguage | null {
  const name = info.trim().toLowerCase().split(/[\s,{]/)[0]
  if (!name) return null

  const known = BY_ALIAS.get(name)
  if (known) return known

  const custom = overrides[name]?.trim()
  if (custom) return { id: name, label: name, ext: name, command: custom, aliases: [name] }
  return null
}

/**
 * The command line for a language, after the user's override and platform.
 *
 * `plan` is what the block about to run turned into, and is left out where
 * there is no block — Settings shows the default line for a language, not the
 * line for anything in particular.
 */
export function commandFor(
  language: CodeLanguage,
  overrides: Record<string, string>,
  platform: string,
  plan?: RunPlan
): string {
  const override = overrides[language.id]?.trim()
  if (override) return override
  if (plan) return plan.command
  return platform === 'win32' && language.windows ? language.windows : language.command
}

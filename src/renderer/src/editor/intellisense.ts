import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorSelection, type EditorState, type Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import katex from 'katex'
import { fenceInfo, languageFor } from '@shared/code-langs'
import { vizKind } from '@shared/viz-langs'
import {
  CARET,
  environmentSnippet,
  findEnvironment,
  findLatex,
  latexSample,
  latexSnippet,
  type LatexCommand
} from '../lib/latex'
import { symbolsIn, type CodeSymbol } from '../lib/symbols'
import { vocabFor } from '../lib/vocab'
import { useStone } from '../store'

/**
 * Suggestions inside the two places a note stops being prose: an equation and
 * a code block.
 *
 * The rest of the editor's menus are triggered by a character that means
 * nothing else — `/`, `[[`, `#`, `:` — so they can fire anywhere and be right.
 * These two cannot. `\` is an escape in prose and a line continuation in shell;
 * a bare word is a word everywhere. So the first thing this file does, and the
 * reason both sources live in it, is work out where the caret actually is:
 * inside maths, inside a fence and which language, or in the prose where
 * neither belongs.
 *
 * What is offered is deliberately not a language server. There is no
 * toolchain, no project, no types — a note is not a repository, and a block in
 * one is usually twenty lines that will never be compiled. What a list here can
 * honestly know is the language's own vocabulary (`lib/vocab`) and the names
 * the note itself has declared above the caret (`lib/symbols`), and those two
 * cover the great majority of what typing in a code block is: recalling the
 * name of a builtin, and recalling what you called something four lines up.
 *
 * A block can opt out. `` ```!python `` is Python in every other respect and
 * gets no suggestions — see `fenceInfo`.
 */

// --------------------------------------------------------------- the context

const FENCE_RE = /^\s*(```|~~~)\s*(\S*)/
/** `$$` alone on a line, which opens and closes display maths the way ``` does. */
const MATH_FENCE_RE = /^\s*\$\$\s*$/

/** Fence languages that are display maths rather than code. */
const MATH_FENCES = new Set(['math', 'latex', 'katex', 'tex'])
/** Fence languages drawn as something else: a diagram, a query, a figure. */
const DRAWN_FENCES = new Set(['mermaid', 'svg', 'stone', 'query', 'toc', 'contents'])

export interface CodeBlock {
  /** The info string as written, `!` and all. */
  info: string
  /** The language name alone, lowercased and unmarked. */
  name: string
  /** Whether the block asked for suggestions. */
  hints: boolean
  /** The language Stone would run it as, where it knows one. */
  languageId: string | null
  /** The block's own text, without either fence line. */
  code: string
  startLine: number
  /** 0 while the fence is still open at the end of the document. */
  endLine: number
}

export type WriteContext =
  /** Ordinary text. Inline maths is still possible — see `inInlineMath`. */
  | { kind: 'prose' }
  /** Display maths: a `$$` region, or a ```math fence. */
  | { kind: 'math' }
  /**
   * A fence drawn as something else — a figure, a diagram, a query. The block
   * comes with it, because those fences have grammars of their own and
   * `block-complete` needs to know which one it is looking at.
   */
  | { kind: 'drawn'; block: CodeBlock }
  /**
   * The fence line itself, where the language is named rather than written in.
   * `opening` separates ```` ```py ```` from the ``` that closes it — only one
   * of the two is a place to suggest a language.
   */
  | { kind: 'fence'; block: CodeBlock; opening: boolean }
  | { kind: 'code'; block: CodeBlock; earlier: CodeBlock[] }

/**
 * Every fenced region in the document, in order.
 *
 * Scanned from the top rather than from the caret, for the reason every other
 * fence scan in the editor is: which side of a fence a line falls on is decided
 * by all the backticks above it, and a block half off the screen is still the
 * block the caret is in.
 */
function scanBlocks(doc: Text): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let mark = ''
  let open: CodeBlock | null = null
  const body: string[] = []
  const table = useStone.getState().settings?.codeRunners ?? {}

  const close = (endLine: number): void => {
    if (!open) return
    open.endLine = endLine
    open.code = body.join('\n')
    blocks.push(open)
    open = null
    body.length = 0
    mark = ''
  }

  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text

    if (!mark) {
      const fence = FENCE_RE.exec(text)
      if (!fence && !MATH_FENCE_RE.test(text)) continue

      const info = fence ? (fence[2] ?? '') : '$$'
      const read = fenceInfo(info)
      mark = fence ? fence[1] : '$$'
      open = {
        info,
        name: read.name,
        hints: read.hints,
        languageId: fence ? (languageFor(info, table)?.id ?? null) : null,
        code: '',
        startLine: n,
        endLine: 0
      }
      continue
    }

    const fence = FENCE_RE.exec(text)
    if (mark === '$$' ? MATH_FENCE_RE.test(text) : fence !== null && fence[1] === mark) {
      close(n)
      continue
    }
    body.push(text)
  }

  // An unclosed fence at the end of the document is someone still typing, and
  // is exactly the block a suggestion is most wanted in. It keeps `endLine: 0`.
  if (open) {
    open.code = body.join('\n')
    blocks.push(open)
  }
  return blocks
}

/**
 * One result kept, because six completion sources ask the same question on the
 * same keystroke and the answer is a scan of the whole document.
 */
let cache: { doc: Text; pos: number; context: WriteContext } | null = null

/** Where the caret is, as far as anything that suggests a word is concerned. */
export function contextAt(state: EditorState, pos: number): WriteContext {
  const doc = state.doc
  if (cache && cache.doc === doc && cache.pos === pos) return cache.context

  const line = doc.lineAt(pos).number
  const blocks = scanBlocks(doc)
  let context: WriteContext = { kind: 'prose' }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const end = block.endLine === 0 ? doc.lines : block.endLine
    if (line < block.startLine || line > end) continue

    // The two fence lines belong to the fence, not to what is inside it: the
    // caret sitting on ```` ```py ```` is naming the language, not writing
    // Python — which is a place worth suggesting in, just not the same one.
    if (line === block.startLine) {
      context = { kind: 'fence', block, opening: true }
      break
    }
    if (block.endLine !== 0 && line === block.endLine) {
      context = { kind: 'fence', block, opening: false }
      break
    }

    context =
      block.name === '$$' || MATH_FENCES.has(block.name)
        ? { kind: 'math' }
        : DRAWN_FENCES.has(block.name) || vizKind(block.name)
          ? { kind: 'drawn', block }
          : { kind: 'code', block, earlier: blocks.slice(0, i) }
    break
  }

  cache = { doc, pos, context }
  return context
}

/** Whether the caret is in ordinary prose, where the note's own menus belong. */
export function inProse(state: EditorState, pos: number): boolean {
  return contextAt(state, pos).kind === 'prose'
}

/**
 * Whether an odd number of `$` marks stands between the start of the line and
 * the caret — which is to say, whether an inline equation is open.
 *
 * `\$` is an escaped dollar and does not count, and `$$` written on one line is
 * a single mark rather than two, so display maths typed inline works as well.
 *
 * The one thing a leading `$$` might be instead is the fence around a display
 * block, and a fence opens no equation of its own — the equation is on the next
 * line, where `contextAt` finds it. So a line that starts `$$` and has no
 * second `$$` to close it is read as that fence and nothing else. `$$a+b$$`
 * written on one line still has its pair, and still counts.
 */
function inInlineMath(line: string, upto: number): boolean {
  const start = line.length - line.trimStart().length
  if (line.startsWith('$$', start) && !line.includes('$$', start + 2)) return false

  let open = false
  for (let i = 0; i < upto; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] !== '$') continue
    if (line[i + 1] === '$') i++
    open = !open
  }
  return open
}

// --------------------------------------------------------------------- LaTeX

/** Insert a snippet, `CARET` marking where the caret should end up. */
function applySnippet(view: EditorView, from: number, to: number, text: string): void {
  const caret = text.indexOf(CARET)
  const insert = caret === -1 ? text : text.slice(0, caret) + text.slice(caret + 1)
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + (caret === -1 ? insert.length : caret)),
    scrollIntoView: true
  })
}

/**
 * The command, drawn.
 *
 * The point of a preview is that `\succeq` and `\preceq` are indistinguishable
 * as words and obvious as pictures, and that `\binom{n}{k}` means nothing at
 * all until you have seen one. KaTeX is already loaded — the editor renders
 * every equation in the note with it — so this costs a call, not a download.
 */
function latexPreview(command: LatexCommand): Node | null {
  const el = document.createElement('div')
  el.className = 'cm-latex-preview'
  try {
    el.innerHTML = katex.renderToString(latexSample(command), {
      // Display mode, not inline: it is where `\tag` is legal at all, and it
      // is the only way `\sum` shows its limits above and below the sign —
      // which for half this table is the difference being previewed.
      displayMode: true,
      throwOnError: false,
      output: 'html',
      strict: 'ignore'
    })
  } catch {
    return null
  }
  return el
}

/**
 * LaTeX commands, inside maths.
 *
 * Fires on the backslash, and only where a backslash could start one: an
 * equation. In prose `\` is an escape, and a menu of three hundred Greek
 * letters over someone typing a Windows path would be a bug.
 */
export function latexComplete(context: CompletionContext): CompletionResult | null {
  const where = contextAt(context.state, context.pos)
  if (where.kind !== 'math' && where.kind !== 'prose') return null
  if (where.kind === 'prose') {
    const line = context.state.doc.lineAt(context.pos)
    if (!inInlineMath(line.text, context.pos - line.from)) return null
  }

  // `\begin{…}` is its own menu: the useful thing about an environment is the
  // whole skeleton, and the name on its own leaves an unclosed block behind.
  const begun = context.matchBefore(/\\begin\{[a-zA-Z*]*/)
  if (begun) {
    const query = context.state.sliceDoc(begun.from, begun.to).slice('\\begin{'.length)
    const options: Completion[] = findEnvironment(query).map((env) => ({
      label: `\\begin{${env.name}}`,
      detail: env.detail,
      type: 'class',
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        // Anything already typed inside the braces is replaced, the closing
        // brace included where the user got that far.
        const after = view.state.sliceDoc(to, Math.min(to + 1, view.state.doc.length))
        const end = after === '}' ? to + 1 : to
        applySnippet(view, from, end, environmentSnippet(env))
      }
    }))
    if (options.length === 0) return null
    return { from: begun.from, to: begun.to, options, filter: false }
  }

  const match = context.matchBefore(/\\[a-zA-Z]*/)
  if (!match) return null
  const query = context.state.sliceDoc(match.from, match.to).slice(1)

  const options: Completion[] = findLatex(query)
    .slice(0, 60)
    .map((command) => ({
      // The glyph leads, because that is what is being looked for. Two spaces
      // rather than one: a lone `∈` beside `in` needs the gap to read as a
      // picture of the word rather than part of it.
      label: command.symbol ? `${command.symbol}  \\${command.name}` : `\\${command.name}`,
      detail: command.group,
      type: 'keyword',
      info: () => latexPreview(command),
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        applySnippet(view, from, to, latexSnippet(command))
      }
    }))

  if (options.length === 0) return null
  return { from: match.from, to: match.to, options, filter: false }
}

// ---------------------------------------------------------------------- code

/** What a declaration is, in the two letters a list can spare for it. */
const KIND_DETAIL: Record<CodeSymbol['kind'], string> = {
  function: 'function',
  class: 'class',
  variable: 'variable',
  constant: 'constant',
  type: 'type',
  import: 'import',
  field: 'field'
}

/** The completion types CodeMirror knows, for the class it puts on the row. */
const KIND_TYPE: Record<CodeSymbol['kind'], string> = {
  function: 'function',
  class: 'class',
  variable: 'variable',
  constant: 'constant',
  type: 'type',
  import: 'namespace',
  field: 'property'
}

/**
 * A token: something that could be a name being typed.
 *
 * Wider than an identifier on purpose, because half of what is worth suggesting
 * is not one — `console.log`, `std::vector`, `System.out.println`, `#include`,
 * `println!`, `Get-ChildItem`, `$this`. It has to *start* like a name, though,
 * so the `-l` of `ls -l` and the `.` of a float are not treated as the
 * beginning of a word.
 */
const TOKEN_RE = /[A-Za-z_$#][\w$#.:!-]*/

/** The last `.`, `::` or `->` in a token, which is where a member starts. */
function lastSeparator(text: string): { at: number; length: number } | null {
  let found: { at: number; length: number } | null = null
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('::', i) || text.startsWith('->', i)) found = { at: i, length: 2 }
    else if (text[i] === '.') found = { at: i, length: 1 }
  }
  return found
}

/**
 * The names in scope at the caret: what this block declares, and what the
 * blocks above it in the same language declared.
 *
 * The second half is the notebook rule made visible. A note's blocks run into
 * one session per language, so by the fifth block the names from the second one
 * really are in scope — and nothing on the page says so, which is exactly why
 * the suggestion list is the right place to say it.
 */
function scopeSymbols(
  block: CodeBlock,
  earlier: CodeBlock[]
): Array<{ symbol: CodeSymbol; here: boolean }> {
  const languageId = block.languageId
  if (!languageId) return []

  const out: Array<{ symbol: CodeSymbol; here: boolean }> = []
  for (const above of earlier) {
    if (above.languageId !== languageId) continue
    for (const symbol of symbolsIn(languageId, above.code)) out.push({ symbol, here: false })
  }
  for (const symbol of symbolsIn(languageId, block.code)) out.push({ symbol, here: true })
  return out
}

/** Add an option unless a better-ranked one already claimed the same label. */
function collect(into: Map<string, Completion>, option: Completion): void {
  const held = into.get(option.label)
  if (held && (held.boost ?? 0) >= (option.boost ?? 0)) return
  into.set(option.label, option)
}

/**
 * Suggestions inside a code fence.
 *
 * Three sources, ranked in the order of how much they are worth: what the note
 * declares above the caret, then the language's keywords, then its builtins.
 * A name the person wrote themselves beats a name the language shipped with,
 * because they typed the first one on purpose and are trying to type it again.
 */
export function codeComplete(context: CompletionContext): CompletionResult | null {
  const where = contextAt(context.state, context.pos)
  if (where.kind !== 'code') return null

  // `` ```!python `` — the block said no. See `fenceInfo`.
  if (!where.block.hints) return null

  const match = context.matchBefore(TOKEN_RE)
  if (!match || match.from === match.to) return null

  const text = context.state.sliceDoc(match.from, match.to)
  const vocab = where.block.languageId ? vocabFor(where.block.languageId) : null
  const options = new Map<string, Completion>()

  // ---- after a dot: members, and whatever continues a dotted builtin.
  const cut = lastSeparator(text)
  if (cut) {
    const head = text.slice(0, cut.at + cut.length)
    const tail = text.slice(cut.at + cut.length)
    if (!/^\w*$/.test(tail)) return null

    for (const builtin of vocab?.builtins ?? []) {
      if (!builtin.startsWith(head) || builtin.length === head.length) continue
      collect(options, { label: builtin.slice(head.length), detail: 'built-in', type: 'property', boost: 1 })
    }
    for (const member of vocab?.members ?? []) {
      collect(options, { label: member, detail: 'member', type: 'method', boost: 0 })
    }
    if (options.size === 0) return null
    return {
      from: match.from + cut.at + cut.length,
      to: match.to,
      options: [...options.values()],
      validFor: /^\w*$/
    }
  }

  // ---- otherwise: the note's own names first, then the language's.
  for (const { symbol, here } of scopeSymbols(where.block, where.earlier)) {
    collect(options, {
      label: symbol.name,
      detail: symbol.detail || KIND_DETAIL[symbol.kind],
      // A name from a block further up is in scope but is not what is being
      // written, so it sorts under the ones on this screen.
      info: here ? undefined : 'Declared in an earlier block',
      type: KIND_TYPE[symbol.kind],
      boost: here ? 3 : 2
    })
  }
  for (const keyword of vocab?.keywords ?? []) {
    collect(options, { label: keyword, detail: 'keyword', type: 'keyword', boost: 1 })
  }
  for (const builtin of vocab?.builtins ?? []) {
    collect(options, { label: builtin, detail: 'built-in', type: 'function', boost: 0 })
  }

  if (options.size === 0) return null
  return {
    from: match.from,
    to: match.to,
    options: [...options.values()],
    // A dot or a colon changes the question, so those end the run and the
    // source is asked again; the rest of a name does not.
    validFor: /^[\w$#!-]*$/
  }
}

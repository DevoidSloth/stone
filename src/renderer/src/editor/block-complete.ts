import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import { CODE_LANGUAGES } from '@shared/code-langs'
import { useStone } from '../store'
import {
  ACCENTS,
  DATATYPES,
  datatypeFor,
  keyNamed,
  type DataValue,
  type Datatype
} from './datatypes'
import { contextAt, type CodeBlock } from './intellisense'

/**
 * Suggestions inside the fences that are not code.
 *
 * `intellisense` covers the two places a note stops being prose that everyone
 * expects to be covered — an equation and a code block — and then stops,
 * because everything else was a "drawn" fence it had no opinion about. But a
 * `hash` block is as much a language as Python is: it has directives, it has
 * values only some of which are legal, and every one of them is a thing you
 * knew last week and cannot remember today. That is precisely the gap a
 * suggestion list closes, and it was open.
 *
 * So this source answers three questions, all from the one table in
 * `datatypes`:
 *
 *   on the fence line     — which languages and figures can go here
 *   at the start of a line — which directives, or which steps
 *   after `key:`          — which values that directive takes
 *
 * Everything it offers carries a line of explanation and, where it helps, the
 * shape of a value, so the manual is mostly not needed; when it is, the last
 * row of an unfiltered list opens the panel at the section for this fence.
 *
 * The lists are vocabulary, never validation. What a directive's value *means*
 * is known only to the parser in `viz/`, and a completion source that tried to
 * second-guess it would be a worse copy of it, drifting.
 */

// -------------------------------------------------------------------- panels

/** The explanation beside a row: a line of prose, then the shape of a value. */
function infoNode(text: string | undefined, sample?: string): Node | null {
  if (!text && !sample) return null
  const wrap = document.createElement('div')
  wrap.className = 'cm-block-info'

  if (text) {
    const p = document.createElement('p')
    p.className = 'cm-block-info__text'
    // `code` spans, the one bit of markup these strings use — the same two
    // forms the manual allows itself, minus the bold nobody needs in a tooltip.
    for (const [i, part] of text.split('`').entries()) {
      if (!part) continue
      if (i % 2 === 0) p.appendChild(document.createTextNode(part))
      else {
        const code = document.createElement('code')
        code.textContent = part
        p.appendChild(code)
      }
    }
    wrap.appendChild(p)
  }

  if (sample) {
    const pre = document.createElement('pre')
    pre.className = 'cm-block-info__sample'
    pre.textContent = sample
    wrap.appendChild(pre)
  }
  return wrap
}

// -------------------------------------------------------------- the fence line

/**
 * What can follow three backticks.
 *
 * The figures come first and with their blurbs, because a fence word is the one
 * part of a program figure nothing else in the editor will teach you: a code
 * language is a name you already know, and `boxes` is a name you have to be
 * told exists. Languages follow, in the table's own order.
 */
function fenceLanguages(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  // The `!` is kept out of the token being replaced: it is the block's opt-out
  // of suggestions, and picking a language should not quietly delete it.
  const match = /^\s*(?:```|~~~)\s*!?([\w+#.-]*)$/.exec(before)
  if (!match) return null
  if (!context.explicit && match[1].length === 0) return null

  const options: Completion[] = []
  for (const type of DATATYPES) {
    if (!type.fence) continue
    const headline = type.presets.find((preset) => preset.headline) ?? type.presets[0]
    options.push({
      label: type.fence,
      detail: type.label,
      type: 'class',
      boost: 2,
      info: () => infoNode(type.blurb, headline?.code.split('\n').slice(1, -1).join('\n'))
    })
  }
  for (const language of CODE_LANGUAGES) {
    options.push({ label: language.id, detail: language.label, type: 'keyword', boost: 0 })
  }

  return { from: context.pos - match[1].length, to: context.pos, options }
}

// ------------------------------------------------------------- inside a fence

/**
 * Whether the caret is under an `algo` block's `---` rule.
 *
 * Above it a line is almost always a directive and below it almost always a
 * step. Only almost: the rule is decoration as far as the parser is concerned
 * — see `readSource` — so neither list is ever wrong, and the rule decides
 * which of the two goes on top rather than which one exists.
 */
function belowRule(state: EditorState, block: CodeBlock, line: number): boolean {
  for (let n = block.startLine + 1; n < line; n++) {
    if (state.doc.line(n).text.trim() === '---') return true
  }
  return false
}

/** The row that opens the manual instead of writing anything. */
function manualOption(type: Datatype): Completion {
  return {
    label: `Read the manual: ${type.label}`,
    detail: type.fence ?? '',
    type: 'text',
    boost: -99,
    info: () => infoNode(type.blurb),
    // No `changes`: an entry that inserted something would be a strange way to
    // ask a question, and what is already typed is what the reader was in the
    // middle of writing.
    apply: () => useStone.getState().openDocs(type.docs.topic, type.docs.section ?? null)
  }
}

function valueOptions(values: DataValue[]): Completion[] {
  return values.map((value) => ({
    label: value.label,
    detail: value.detail,
    type: 'enum',
    info: () => infoNode(value.detail)
  }))
}

/** The operators a `where:` line can use — see `shared/query`. */
const QUERY_OPS: DataValue[] = [
  { label: 'is', detail: 'Exactly equal' },
  { label: 'is not', detail: 'Anything else' },
  { label: 'contains', detail: 'The value appears somewhere in the property' },
  { label: 'not contains', detail: 'It does not' },
  { label: 'before', detail: 'Earlier than a date' },
  { label: 'after', detail: 'Later than a date' },
  { label: 'is empty', detail: 'The property is missing or blank' },
  { label: 'is not empty', detail: 'It has something in it' }
]

export function blockComplete(context: CompletionContext): CompletionResult | null {
  const where = contextAt(context.state, context.pos)

  // ```py — naming the language, which is a menu of its own.
  if (where.kind === 'fence') return where.opening ? fenceLanguages(context) : null
  if (where.kind !== 'drawn') return null

  // `` ```!tree `` — the block said no, the same way a code block can.
  if (!where.block.hints) return null
  const type = datatypeFor(where.block.name)
  if (!type) return null

  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)

  // ---- `#red` and friends, wherever an annotation is allowed. A `#` first on
  // the line opens a comment instead — see `readSource` — and a menu of
  // colours over someone writing a note to themselves would be a bug.
  const accent = /#([A-Za-z]*)$/.exec(before)
  if (type.annotated && accent && !/^\s*#/.test(before)) {
    return {
      from: context.pos - accent[1].length,
      to: context.pos,
      options: valueOptions(ACCENTS),
      validFor: /^[A-Za-z]*$/
    }
  }

  // ---- `where: status is …` — the operator, then whatever the vault calls it.
  if (type.id === 'stone') {
    const filter = /^\s*(?:where|filter)\s*:\s*\S+\s+(.*)$/.exec(before)
    if (filter) {
      return {
        from: context.pos - filter[1].length,
        to: context.pos,
        options: valueOptions(QUERY_OPS)
      }
    }
  }

  // ---- after a directive's colon: the words it accepts, when it accepts few.
  const valued = /^\s*([A-Za-z][\w-]*)\s*:\s*([\w.-]*)$/.exec(before)
  if (valued) {
    const key = keyNamed(type, valued[1])
    if (!key?.values) return null
    if (!context.explicit && valued[2].length === 0) return null
    return {
      from: context.pos - valued[2].length,
      to: context.pos,
      options: valueOptions(key.values),
      validFor: /^[\w.-]*$/
    }
  }

  // ---- `class Dog …` — the two words that can follow a declaration's name.
  if (type.id === 'types') {
    const declared = /^\s*(?:abstract\s+)?(?:class|interface|enum|record)\s+[\w<>.]+\s+(\w*)$/.exec(before)
    if (declared) {
      return {
        from: context.pos - declared[1].length,
        to: context.pos,
        options: valueOptions([
          { label: 'extends', detail: 'A solid edge up to the supertype' },
          { label: 'implements', detail: 'A dashed edge — realising, not extending' }
        ])
      }
    }
  }

  // ---- the start of a line: a directive, a step, or an element.
  // The optional `<` is for an `svg` block, where every line starts with one
  // and the word being looked up begins after it.
  const start = /^\s*<?([A-Za-z][\w-]*)?$/.exec(before)
  if (!start) return null
  const typed = start[1] ?? ''
  if (!context.explicit && typed.length === 0) return null

  const options: Completion[] = []
  // Under an `algo` block's rule the line is a step, and above it a directive.
  // Both lists stay either way — a directive is legal anywhere in a block, and
  // `speed:` written beside the steps it governs is a reasonable thing to do —
  // so the rule sinks the other list rather than removing it.
  const below = type.wordsBelowRule ? belowRule(context.state, where.block, line.number) : false
  const sunk = type.wordsBelowRule ? 6 : 0

  for (const key of type.keys ?? []) {
    options.push({
      label: `${key.key}:`,
      detail: key.detail,
      type: 'property',
      boost: (key.boost ?? 0) - (below ? sunk : 0),
      info: () => infoNode(key.info ?? key.detail, key.sample ? `${key.key}: ${key.sample}` : undefined),
      // The space after the colon is the one keystroke nobody wants to be
      // reminded of, and the values menu opens off the back of it.
      apply: `${key.key}: `
    })
  }

  for (const word of type.words ?? []) {
    // A parenthesised name is a *form* rather than a word — `(a curve)` is not
    // something to type. Choosing one writes the example instead, which is the
    // only reading of it that helps.
    const form = word.word.startsWith('(')
    options.push({
      label: word.word,
      detail: word.detail,
      type: form ? 'text' : 'keyword',
      boost: (word.boost ?? 0) - (below ? 0 : sunk),
      info: () =>
        infoNode(word.info ?? word.detail, word.sample ? `${form ? '' : `${word.word} `}${word.sample}` : undefined),
      apply: form ? (word.sample ?? '') : word.sample ? `${word.word} ` : word.word
    })
  }

  if (options.length === 0) return null
  // Only on an empty list, where nothing is being interrupted and the reader
  // has plainly stopped to think.
  if (typed.length === 0) options.push(manualOption(type))

  return { from: context.pos - typed.length, to: context.pos, options, validFor: /^[\w-]*$/ }
}

// --------------------------------------------------------------- the manual

/** A place in the manual: a topic, and the section that answers the question. */
export interface BlockDocs {
  /** What the block is, for the toast that says where you were sent. */
  label: string
  topic: string
  section: string | null
}

/** A GFM row — the one block with no fence and no marker of its own. */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

/**
 * What the caret is inside, as a page of the manual.
 *
 * The question **Explain this block** asks. It always answers with something:
 * a caret in ordinary prose is still in a note, and the writing topic is the
 * honest page for that — an action that silently did nothing would only be read
 * as broken.
 */
export function blockDocsAt(state: EditorState, pos: number): BlockDocs {
  const where = contextAt(state, pos)

  if (where.kind === 'drawn' || where.kind === 'fence') {
    const type = datatypeFor(where.block.name)
    if (type) return { label: type.label, topic: type.docs.topic, section: type.docs.section ?? null }
    // A fence that runs: the language matters less than the fact it is code.
    return { label: 'Code blocks', topic: 'code', section: 'Running one' }
  }
  if (where.kind === 'code') return { label: 'Code blocks', topic: 'code', section: 'Running one' }
  if (where.kind === 'math') return { label: 'Maths', topic: 'writing', section: 'Maths' }

  const line = state.doc.lineAt(pos).text
  if (TABLE_ROW_RE.test(line)) return { label: 'Tables', topic: 'writing', section: 'Tables' }
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ x~<>?/-]\]/.test(line)) {
    return { label: 'Tasks', topic: 'tasks', section: 'The syntax' }
  }
  if (/^\s*>\s*\[!/.test(line)) return { label: 'Callouts', topic: 'writing', section: 'Callouts' }
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return { label: 'Lists', topic: 'writing', section: 'Lists' }

  return { label: 'Writing', topic: 'writing', section: null }
}

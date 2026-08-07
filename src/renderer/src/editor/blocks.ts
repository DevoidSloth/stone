import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'

/**
 * Block handles.
 *
 * Notion's most-copied affordance: a grip in the margin that appears on hover
 * and drags the whole block somewhere else. Here a "block" is a paragraph, a
 * list item together with its indented children, or a fenced code block —
 * whatever a reader would think of as one thing.
 *
 * The drag moves lines in the document rather than manipulating a model, so the
 * result is exactly what a person would have got by cutting and pasting, and
 * undo puts it back in one step.
 */

class HandleWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-handle'
    el.draggable = true
    el.setAttribute('aria-label', 'Drag to move this block')
    el.title = 'Drag to move'
    // Six dots, the universal grip.
    el.textContent = '⠿'
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

interface BlockRange {
  first: number
  last: number
}

/** The run of lines the block starting at `lineNumber` covers. */
export function blockAt(view: EditorView, lineNumber: number): BlockRange {
  const doc = view.state.doc
  const text = doc.line(lineNumber).text

  const fence = /^\s*(```|~~~)/.exec(text)
  if (fence) {
    for (let n = lineNumber + 1; n <= doc.lines; n++) {
      if (/^\s*(```|~~~)/.test(doc.line(n).text)) return { first: lineNumber, last: n }
    }
    return { first: lineNumber, last: doc.lines }
  }

  const item = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(text)
  if (item) {
    const indent = item[1].length
    let last = lineNumber
    for (let n = lineNumber + 1; n <= doc.lines; n++) {
      const line = doc.line(n).text
      if (!line.trim()) break
      const childIndent = /^\s*/.exec(line)![0].length
      if (childIndent <= indent) break
      last = n
    }
    return { first: lineNumber, last }
  }

  if (/^\s*>/.test(text)) {
    let last = lineNumber
    while (last + 1 <= doc.lines && /^\s*>/.test(doc.line(last + 1).text)) last++
    return { first: lineNumber, last }
  }

  // A plain paragraph runs to the next blank line.
  let last = lineNumber
  while (last + 1 <= doc.lines && doc.line(last + 1).text.trim() && !isBlockStart(doc.line(last + 1).text)) {
    last++
  }
  return { first: lineNumber, last }
}

function isBlockStart(text: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s/.test(text) || /^#{1,6}\s/.test(text) || /^\s*(```|~~~)/.test(text)
}

/** True when the line begins something a handle should be offered for. */
function startsBlock(view: EditorView, lineNumber: number): boolean {
  const doc = view.state.doc
  const text = doc.line(lineNumber).text
  if (!text.trim()) return false

  // Inside a fence, only the opening line gets a handle.
  let fenceOpen = false
  for (let n = 1; n < lineNumber; n++) {
    if (/^\s*(```|~~~)/.test(doc.line(n).text)) fenceOpen = !fenceOpen
  }
  if (fenceOpen) return false

  // Frontmatter is not a block a reader reorders.
  if (lineNumber === 1 && text.trim() === '---') return false

  const previous = lineNumber > 1 ? doc.line(lineNumber - 1).text : ''
  if (isBlockStart(text)) return true
  if (/^\s*>/.test(text)) return !/^\s*>/.test(previous)
  // A paragraph's handle sits on its first line only.
  return !previous.trim() || isBlockStart(previous)
}

function buildHandles(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from)
    while (line.from <= to) {
      if (startsBlock(view, line.number)) {
        builder.add(line.from, line.from, Decoration.widget({ widget: new HandleWidget(), side: -2 }))
      }
      if (line.to >= doc.length) break
      line = doc.lineAt(line.to + 1)
    }
  }
  return builder.finish()
}

/**
 * Move a run of lines so it sits before `beforeLine`. Returns the transaction
 * spec, or null when the move would be a no-op.
 */
function moveBlock(
  view: EditorView,
  block: BlockRange,
  beforeLine: number
): { from: number; to: number; insert: string }[] | null {
  const doc = view.state.doc
  if (beforeLine > block.first && beforeLine <= block.last + 1) return null

  const first = doc.line(block.first)
  const last = doc.line(block.last)
  const text = doc.sliceString(first.from, last.to)

  // Cut the block along with the newline that follows it, so the gap closes.
  const cutFrom = first.from
  const cutTo = Math.min(last.to + 1, doc.length)

  const target = beforeLine > doc.lines ? doc.length : doc.line(beforeLine).from
  const insert = `${text}\n`

  if (target < cutFrom) {
    return [
      { from: cutFrom, to: cutTo, insert: '' },
      { from: target, to: target, insert }
    ].sort((a, b) => b.from - a.from)
  }
  return [
    { from: target, to: target, insert },
    { from: cutFrom, to: cutTo, insert: '' }
  ].sort((a, b) => b.from - a.from)
}

export function blockHandles(): Extension[] {
  let dragging: BlockRange | null = null

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildHandles(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildHandles(update.view)
        }
      }
    },
    {
      decorations: (value) => value.decorations,

      eventHandlers: {
        dragstart(event: DragEvent, view: EditorView) {
          const handle = (event.target as HTMLElement | null)?.closest('.cm-handle')
          if (!handle) return false
          const pos = view.posAtDOM(handle)
          dragging = blockAt(view, view.state.doc.lineAt(pos).number)
          event.dataTransfer?.setData('text/stone-block', 'block')
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
          view.dom.classList.add('cm-dragging-block')
          return false
        },

        dragover(event: DragEvent, view: EditorView) {
          if (!dragging) return false
          event.preventDefault()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          view.dom.querySelectorAll('.cm-drop-target').forEach((el) => {
            el.classList.remove('cm-drop-target')
          })
          if (pos === null) return true
          const line = view.state.doc.lineAt(pos)
          const dom = view.domAtPos(line.from).node as HTMLElement | null
          const row = dom?.nodeType === 1 ? (dom as HTMLElement) : dom?.parentElement
          row?.closest('.cm-line')?.classList.add('cm-drop-target')
          return true
        },

        drop(event: DragEvent, view: EditorView) {
          if (!dragging) return false
          event.preventDefault()
          view.dom.classList.remove('cm-dragging-block')
          view.dom.querySelectorAll('.cm-drop-target').forEach((el) => {
            el.classList.remove('cm-drop-target')
          })

          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          const block = dragging
          dragging = null
          if (pos === null) return true

          const targetLine = view.state.doc.lineAt(pos).number
          const changes = moveBlock(view, block, targetLine)
          if (changes) view.dispatch({ changes })
          return true
        },

        dragend(_event: DragEvent, view: EditorView) {
          dragging = null
          view.dom.classList.remove('cm-dragging-block')
          view.dom.querySelectorAll('.cm-drop-target').forEach((el) => {
            el.classList.remove('cm-drop-target')
          })
          return false
        }
      }
    }
  )

  return [plugin]
}

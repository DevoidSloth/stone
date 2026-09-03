import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'

import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/newsreader/index.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/editor.css'
import './styles/views.css'
import './styles/notion.css'
import './styles/blocks.css'
import './styles/viz.css'
import './styles/panels.css'

import { Editor } from './editor/Editor'

const DOC = [
  '---',
  'title: Harness',
  'tags: [a, b]',
  '---',
  'p1 alpha',
  'p2 bravo',
  '## Heading three',
  'p3 charlie',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  'p4 delta',
  'p5 echo',
  '```js',
  'const one = 1',
  'const two = 2',
  'const three = 3',
  '```',
  'p6 foxtrot',
  'p7 golf',
  '> [!note] Callout',
  '> body of it',
  'p8 hotel',
  'p9 india'
].join('\n')

function Harness() {
  const [value, setValue] = useState(DOC)
  return (
    <div style={{ width: 720, margin: '40px auto' }}>
      <Editor
        value={value}
        onChange={setValue}
        docKey="harness"
        notes={[]}
        tags={[]}
        onOpenWikilink={() => {}}
        onSelectTag={() => {}}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)

// Test hooks.
const w = window as unknown as Record<string, unknown>
w.__view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)
w.__line = () => {
  const v = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)
  if (!v) return null
  const head = v.state.selection.main.head
  return {
    line: v.state.doc.lineAt(head).number,
    col: head - v.state.doc.lineAt(head).from,
    text: v.state.doc.lineAt(head).text,
    active: (document.activeElement as HTMLElement | null)?.className ?? null,
    cell: (document.activeElement as HTMLElement | null)?.dataset?.row ?? null
  }
}
w.__put = (line: number, col = 0) => {
  const v = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
  const l = v.state.doc.line(line)
  v.dispatch({ selection: { anchor: Math.min(l.from + col, l.to) } })
  v.focus()
}
w.__key = (key: string) => {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  )
}

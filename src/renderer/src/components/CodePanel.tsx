import { useEffect, useMemo, useState } from 'react'
import { Text } from '@codemirror/state'
import { vizKind } from '@shared/viz-langs'
import { fenceInfo } from '@shared/code-langs'
import {
  fenceKey,
  notebookDoc,
  restartSession,
  runState,
  runnableFences,
  sessionFor,
  subscribeRun,
  subscribeSessions,
  type RunnableFence,
  type RunState
} from '../editor/run-code'
import { readsSymbols, symbolsIn, type CodeSymbol, type SymbolKind } from '../lib/symbols'
import { useStone } from '../store'
import { IconRefresh } from '../ui/icons'

/**
 * The code inspector.
 *
 * What a debugger shows you about a frame — the names that exist here, what
 * each of them is, and where it came from — for the blocks in the note you are
 * writing. It answers the question a page of code in a note actually raises,
 * which is not "what does this print" but "what is defined by the time I get
 * here", and in a notebook that question spans blocks: the fifth block runs
 * into a session the second one filled, and nothing on the page says so.
 *
 * Two sources, kept honestly apart. The **declarations** are read off the
 * source by `symbolsIn` — always available, correct for what is written, and
 * silent about anything decided at runtime. The **run state** is what actually
 * happened: which blocks have run into the session, what they exited with, and
 * whether the text has been edited since, because a session holding what an
 * old edit declared is the one thing a notebook is quietly wrong about.
 *
 * The block the caret is in is the current frame, and it is the only one that
 * gets the full scope listing. Showing every block's inherited scope would be
 * the same list five times over, and the one that matters is where you are.
 */

const KIND_LABEL: Record<SymbolKind, string> = {
  function: 'fn',
  class: 'class',
  variable: 'var',
  constant: 'const',
  type: 'type',
  import: 'use',
  field: 'field'
}

/** Fences that are not code: the figures, the queries, the pictures. */
function otherFences(content: string): Array<{ info: string; line: number; what: string }> {
  const out: Array<{ info: string; line: number; what: string }> = []
  const lines = content.split('\n')
  let open = false
  let info = ''
  let start = 0

  lines.forEach((text, index) => {
    const fence = /^\s*(```|~~~)\s*(.*)$/.exec(text)
    if (!fence) return
    if (!open) {
      open = true
      info = (fence[2] ?? '').trim()
      start = index + 1
      return
    }
    open = false

    const { name } = fenceInfo(info)
    if (!name) return
    const kind = vizKind(name)
    const what = kind
      ? 'figure'
      : name === 'stone'
        ? 'query'
        : name === 'mermaid'
          ? 'diagram'
          : name === 'svg'
            ? 'drawing'
            : name === 'math' || name === 'katex'
              ? 'maths'
              : ''
    if (what) out.push({ info: name, line: start, what })
  })

  return out
}

/** Where a run has got to, as a line the panel can print. */
function statusOf(state: RunState, code: string): { text: string; tone: string } {
  if (state.error) return { text: state.error, tone: 'bad' }

  switch (state.status) {
    case 'consent':
      return { text: 'waiting for permission', tone: 'wait' }
    case 'queued':
      return { text: 'queued behind an earlier block', tone: 'wait' }
    case 'starting':
      return { text: 'session starting', tone: 'wait' }
    case 'running':
      return { text: 'running', tone: 'live' }
    case 'done':
      break
    default:
      return { text: 'not run', tone: 'idle' }
  }

  const result = state.result
  if (!result) return { text: state.message ?? 'done', tone: 'ok' }

  const stale = state.ranCode !== null && state.ranCode !== code
  const how = result.timedOut
    ? 'timed out'
    : result.cancelled
      ? 'stopped'
      : result.signal
        ? `killed (${result.signal})`
        : result.code === 0
          ? 'ok'
          : `exit ${result.code}`

  const parts = [how, `${(result.ms / 1000).toFixed(result.ms < 1000 ? 2 : 1)}s`]
  if (result.count !== null) parts.push(`[${result.count}]`)
  if (stale) parts.push('· edited since')

  return {
    text: parts.join(' · '),
    tone: stale ? 'wait' : result.code === 0 && !result.timedOut && !result.cancelled ? 'ok' : 'bad'
  }
}

/** The last thing the block printed, which is usually the thing you wanted. */
function lastValue(state: RunState): string | null {
  for (let i = state.chunks.length - 1; i >= 0; i--) {
    const chunk = state.chunks[i]
    if (chunk.stream !== 'out') continue
    const line = chunk.text.split('\n').filter((l) => l.trim()).pop()
    if (line) return line.trim().slice(0, 80)
  }
  return null
}

function SymbolRow({ symbol, onJump }: { symbol: CodeSymbol; onJump: () => void }) {
  return (
    <button type="button" className="sym" onClick={onJump} data-tip={`Line ${symbol.line} of the block`}>
      <span className="sym__kind" data-kind={symbol.kind}>
        {KIND_LABEL[symbol.kind]}
      </span>
      <span className="sym__name truncate">{symbol.name}</span>
      {symbol.detail && <span className="sym__detail truncate">{symbol.detail}</span>}
    </button>
  )
}

export function CodePanel() {
  const relPath = useStone((s) => s.activeRelPath)
  const docs = useStone((s) => s.docs)
  const caret = useStone((s) => s.caret)
  const settings = useStone((s) => s.settings)
  const openNote = useStone((s) => s.openNote)

  // Runs and sessions live outside the store — they change on every chunk of
  // output, and putting them through Zustand would rerender the editor with
  // them. A counter is all this panel needs to hear about them.
  const [, bump] = useState(0)

  const content = relPath ? (docs[relPath]?.content ?? null) : null

  const doc = useMemo(() => Text.of((content ?? '').split('\n')), [content])
  const fences = useMemo(
    () => (content === null ? [] : runnableFences(doc)),
    // `runnableFences` reads the runner overrides out of the store itself, so a
    // language added in Settings has to re-scan the note.
    [doc, content, settings?.codeRunners]
  )
  const others = useMemo(() => (content === null ? [] : otherFences(content)), [content])
  const notebook = useMemo(() => (content === null ? false : notebookDoc(doc)), [doc, content])

  useEffect(() => {
    if (!relPath) return
    const tick = (): void => bump((n) => n + 1)
    const offs = fences.map((fence) => subscribeRun(fenceKey(relPath, fence), tick))
    offs.push(subscribeSessions(tick))
    return () => offs.forEach((off) => off())
  }, [fences, relPath])

  const jump = (line: number): void => {
    // Panel lines are the document's, counting from one; `openNote` counts from
    // zero, the way the editor's own reveal does.
    if (relPath) void openNote(relPath, { line: line - 1 })
  }

  if (!relPath || content === null) {
    return <p className="panel__empty">Open a note to inspect the code in it.</p>
  }

  if (fences.length === 0) {
    return (
      <>
        <p className="panel__empty">
          No runnable code in this note. Fence a block with a language — <code>python</code>,{' '}
          <code>java</code>, <code>js</code> — and everything it declares is listed here, with what
          each block exited with and what the session it ran into is holding.
        </p>
        {others.length > 0 && <OtherBlocks blocks={others} onJump={jump} />}
      </>
    )
  }

  /** The block the caret is in: the current frame. */
  const current =
    caret && caret.relPath === relPath
      ? (fences.find((f) => caret.line >= f.startLine && caret.line <= f.endLine) ?? null)
      : null

  /*
   * What the current block inherits. In a notebook every earlier block of the
   * same language has already run into the session it is about to join, so
   * their declarations are in scope here without appearing anywhere on screen —
   * which is exactly the thing worth showing. A name declared twice is the
   * later one, and a name this block declares itself is left out, because that
   * is the binding that will win.
   */
  const inherited: CodeSymbol[] = []
  if (current && notebook) {
    const own = new Set(symbolsIn(current.language.id, current.code).map((s) => s.name))
    const byName = new Map<string, CodeSymbol>()
    for (const fence of fences) {
      if (fence.index >= current.index || fence.language.id !== current.language.id) continue
      for (const symbol of symbolsIn(fence.language.id, fence.code)) {
        if (!symbol.top || own.has(symbol.name)) continue
        byName.set(symbol.name, { ...symbol, line: fence.startLine + symbol.line })
      }
    }
    inherited.push(...byName.values())
  }

  const languages = [...new Set(fences.map((f) => f.language.id))]
  const live = languages
    .map((id) => sessionFor(relPath, id))
    .filter((session): session is NonNullable<typeof session> => session !== null)

  return (
    <>
      <div className="codepanel__head">
        <span className="codepanel__mode" data-on={notebook}>
          {notebook ? 'Notebook — blocks share a session' : 'Each block runs on its own'}
        </span>
        {live.map((session) => (
          <div key={session.langId} className="codepanel__session">
            <span className="truncate">
              {session.label} · {session.count} {session.count === 1 ? 'block' : 'blocks'} in
            </span>
            <button
              type="button"
              className="btn btn--sm btn--ghost btn--icon"
              data-tip="Throw this session away and start again"
              aria-label={`Restart the ${session.label} session`}
              onClick={() => restartSession(relPath, session.langId)}
            >
              <IconRefresh size={11} />
            </button>
          </div>
        ))}
      </div>

      {fences.map((fence) => (
        <Frame
          key={fence.index}
          fence={fence}
          notePath={relPath}
          current={current?.index === fence.index}
          inherited={current?.index === fence.index ? inherited : []}
          onJump={jump}
        />
      ))}

      {others.length > 0 && <OtherBlocks blocks={others} onJump={jump} />}
    </>
  )
}

function Frame({
  fence,
  notePath,
  current,
  inherited,
  onJump
}: {
  fence: RunnableFence
  notePath: string
  current: boolean
  inherited: CodeSymbol[]
  onJump: (line: number) => void
}) {
  const state = runState(fenceKey(notePath, fence))
  const status = statusOf(state, fence.code)
  const value = lastValue(state)

  const symbols = readsSymbols(fence.language.id) ? symbolsIn(fence.language.id, fence.code) : null
  const defines = symbols?.filter((s) => s.top) ?? []
  const locals = symbols?.filter((s) => !s.top) ?? []

  return (
    <div className="frame" data-current={current}>
      <button
        type="button"
        className="frame__head"
        onClick={() => onJump(fence.startLine)}
        data-tip="Go to this block"
      >
        <span className="frame__lang truncate">{fence.language.label}</span>
        <span className="frame__lines">
          {fence.startLine}–{fence.endLine}
        </span>
      </button>

      <div className="frame__status" data-tone={status.tone}>
        {status.text}
      </div>
      {value && (
        <div className="frame__value truncate" data-tip={value}>
          → {value}
        </div>
      )}

      {inherited.length > 0 && (
        <>
          <div className="frame__group">In scope from the blocks above</div>
          {inherited.map((symbol) => (
            <SymbolRow
              key={`in-${symbol.kind}-${symbol.name}`}
              symbol={symbol}
              onJump={() => onJump(symbol.line)}
            />
          ))}
        </>
      )}

      {symbols === null ? (
        <p className="frame__none">Stone does not read {fence.language.label} declarations.</p>
      ) : symbols.length === 0 ? (
        <p className="frame__none">Declares nothing — statements only.</p>
      ) : (
        <>
          {defines.length > 0 && (
            <>
              <div className="frame__group">Defines</div>
              {defines.map((symbol) => (
                <SymbolRow
                  key={`d-${symbol.kind}-${symbol.name}-${symbol.line}`}
                  symbol={symbol}
                  onJump={() => onJump(fence.startLine + symbol.line)}
                />
              ))}
            </>
          )}
          {locals.length > 0 && (
            <>
              <div className="frame__group">Inside</div>
              {locals.map((symbol) => (
                <SymbolRow
                  key={`l-${symbol.kind}-${symbol.name}-${symbol.line}`}
                  symbol={symbol}
                  onJump={() => onJump(fence.startLine + symbol.line)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function OtherBlocks({
  blocks,
  onJump
}: {
  blocks: Array<{ info: string; line: number; what: string }>
  onJump: (line: number) => void
}) {
  return (
    <>
      <div className="panel__section eyebrow">Other blocks</div>
      {blocks.map((block) => (
        <button
          key={`${block.info}-${block.line}`}
          type="button"
          className="sym"
          onClick={() => onJump(block.line)}
          data-tip={`Line ${block.line}`}
        >
          <span className="sym__kind" data-kind="type">
            {block.what}
          </span>
          <span className="sym__name truncate">{block.info}</span>
          <span className="sym__detail">line {block.line}</span>
        </button>
      ))}
    </>
  )
}

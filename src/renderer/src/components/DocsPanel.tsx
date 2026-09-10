import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DOC_TOPICS, docTopic, searchDocs, type DocBlock, type DocSection } from '../docs/topics'
import { insertBlock } from '../editor/insert'
import { useStone } from '../store'
import { IconArrowLeft, IconCopy, IconPlus, IconSearch, IconX } from '../ui/icons'

/**
 * The manual, in the inspector.
 *
 * Stone's features are mostly syntax, and syntax is only ever needed in the
 * half-second before you type it. A documentation *window* would be read once;
 * a panel beside the note is read every time someone cannot remember whether a
 * heap is `heap:` or `level:`, which is the actual failure mode this exists to
 * fix.
 *
 * Two things make it more than a rendered README. Search matches sections
 * rather than pages, so `swap` lands on the `algo` step table instead of the
 * top of a long topic about figures. And every example has an **Insert**
 * button, which puts the block in the note under the caret — reading how a
 * fence works and having one is one click, not a transcription.
 */

// -------------------------------------------------------------------- inline

/**
 * `code` and **bold**, and nothing else.
 *
 * Held to two forms deliberately. A general markdown renderer here would be a
 * second implementation of the one the editor already has, drifting from it,
 * for text that is written in this repository and can simply not need it.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    out.push(
      match[1] !== undefined ? (
        <code key={`${keyPrefix}-${match.index}`}>{match[1]}</code>
      ) : (
        <b key={`${keyPrefix}-${match.index}`}>{match[2]}</b>
      )
    )
    last = match.index + match[0].length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

// -------------------------------------------------------------------- blocks

function Example({ code, caption }: { code: string; caption?: string }) {
  const toast = useStone((s) => s.toast)

  return (
    <div className="docs__example">
      <pre className="docs__code">
        <code>{code}</code>
      </pre>
      {caption && <p className="docs__caption">{inline(caption, 'cap')}</p>}
      <div className="docs__exampleActions">
        <button
          type="button"
          className="btn btn--sm"
          data-tip="Put this in the note, below the caret"
          onClick={() => {
            if (insertBlock(code)) toast('Inserted.', 'success')
            else toast('Open a note to insert into.', 'error')
          }}
        >
          <IconPlus size={11} />
          Insert
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          data-tip="Copy to the clipboard"
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => toast('Copied.', 'success'),
              () => toast('That could not be copied.', 'error')
            )
          }}
        >
          <IconCopy size={11} />
        </button>
      </div>
    </div>
  )
}

function Block({ block, id }: { block: DocBlock; id: string }) {
  switch (block.kind) {
    case 'p':
      return <p className="docs__p">{inline(block.text, id)}</p>
    case 'note':
      return <p className="docs__note">{inline(block.text, id)}</p>
    case 'list':
      return (
        <ul className="docs__list">
          {block.items.map((item, i) => (
            <li key={`${id}-${i}`}>{inline(item, `${id}-${i}`)}</li>
          ))}
        </ul>
      )
    case 'table':
      return (
        <table className="docs__table">
          <thead>
            <tr>
              <th>{block.head[0]}</th>
              <th>{block.head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map(([left, right], i) => (
              <tr key={`${id}-${i}`}>
                <td className={block.mono ? 'docs__mono' : undefined}>{inline(left, `${id}-l${i}`)}</td>
                <td>{inline(right, `${id}-r${i}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'example':
      return <Example code={block.code} caption={block.caption} />
  }
}

function Section({ section, id }: { section: DocSection; id: string }) {
  return (
    <section className="docs__section" data-section={section.title}>
      <h3 className="docs__h">{section.title}</h3>
      {section.blocks.map((block, i) => (
        <Block key={`${id}-${i}`} block={block} id={`${id}-${i}`} />
      ))}
    </section>
  )
}

// --------------------------------------------------------------------- panel

export function DocsPanel() {
  const topicId = useStone((s) => s.docsTopic)
  const openDocs = useStone((s) => s.openDocs)
  const [query, setQuery] = useState('')
  /** A section named by a search hit, scrolled to once the topic is up. */
  const [target, setTarget] = useState<string | null>(null)
  const scroll = useRef<HTMLDivElement>(null)

  const topic = topicId ? docTopic(topicId) : null
  const hits = useMemo(() => (query.trim() ? searchDocs(query) : []), [query])

  useEffect(() => {
    if (!target || !topic) return
    const el = scroll.current?.querySelector(`[data-section="${CSS.escape(target)}"]`)
    el?.scrollIntoView({ block: 'start' })
    setTarget(null)
  }, [target, topic])

  // Coming back to the index should not leave the last topic's scroll offset
  // behind, which reads as a page that failed to load. The scroller is the
  // inspector's, not this panel's — the panel is only what is inside it.
  //
  // Not when a search hit named a section: opening the topic and scrolling to
  // the section are the same click, and both effects fire on the same render.
  useEffect(() => {
    if (target !== null) return
    scroll.current?.closest('.inspector__scroll')?.scrollTo({ top: 0 })
    // `target` decides whether this runs, but it must not re-run when it is
    // cleared — that would throw away the scroll it just deferred to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId])

  const open = (id: string, section: string | null): void => {
    setQuery('')
    setTarget(section)
    openDocs(id)
  }

  return (
    <div className="docs" ref={scroll}>
      {/* Stuck to the top: a manual is searched from wherever you had got to
          in it, and a field scrolled off the screen is a field nobody uses. */}
      <div className="docs__searchbar">
        <div className="docs__search">
          <IconSearch size={12} />
          <input
            className="docs__field"
            value={query}
            placeholder="Search the manual"
            aria-label="Search the manual"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Clear"
              onClick={() => setQuery('')}
            >
              <IconX size={11} />
            </button>
          )}
        </div>
      </div>

      {query.trim() ? (
        <>
          <div className="panel__section eyebrow">
            {hits.length} {hits.length === 1 ? 'result' : 'results'}
          </div>
          {hits.length === 0 && (
            <p className="panel__empty">
              Nothing here says that. Try a fence name — <code>tree</code>, <code>algo</code>,{' '}
              <code>stone</code> — or a token like <code>@due</code>.
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={`${hit.topic.id}-${hit.section?.title ?? ''}`}
              type="button"
              className="panelrow"
              onClick={() => open(hit.topic.id, hit.section?.title ?? null)}
            >
              <b className="truncate">{hit.section ? hit.section.title : hit.topic.title}</b>
              <span className="panelrow__sub">
                {hit.section ? `${hit.topic.title} · ${hit.excerpt}` : hit.excerpt}
              </span>
            </button>
          ))}
        </>
      ) : topic ? (
        <>
          <button type="button" className="docs__back" onClick={() => openDocs(null)}>
            <IconArrowLeft size={12} />
            All topics
          </button>
          <h2 className="docs__title">{topic.title}</h2>
          <p className="docs__blurb">{topic.blurb}</p>
          {topic.sections.map((section, i) => (
            <Section key={section.title} section={section} id={`${topic.id}-${i}`} />
          ))}
        </>
      ) : (
        <>
          <div className="panel__section eyebrow">Everything Stone does</div>
          {DOC_TOPICS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="panelrow"
              onClick={() => open(entry.id, null)}
            >
              <b className="truncate">{entry.title}</b>
              <span className="panelrow__sub">{entry.blurb}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

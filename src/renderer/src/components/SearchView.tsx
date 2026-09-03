import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { useStone } from '../store'
import { IconSearch, IconX } from '../ui/icons'

/**
 * Vault-wide search.
 *
 * The palette answers "take me to that note"; this answers "where does this
 * appear". That is a different job, and it needs the matching lines in context,
 * a persistent result list, and the ability to act on all of them at once.
 */

function Highlight({ text, from, to }: { text: string; from: number; to: number }) {
  // Offsets are measured against the raw line; the display text is trimmed, so
  // fall back to a plain render rather than highlighting the wrong span.
  if (from < 0 || to > text.length || from >= to) return <>{text}</>
  return (
    <>
      {text.slice(0, from)}
      <mark>{text.slice(from, to)}</mark>
      {text.slice(to)}
    </>
  )
}

function HitRow({ hit }: { hit: SearchHit }) {
  const openNote = useStone((s) => s.openNote)
  const [expanded, setExpanded] = useState(true)

  return (
    <section className="hit">
      <button type="button" className="hit__head" onClick={() => setExpanded((v) => !v)}>
        <b className="truncate">{hit.title}</b>
        <span className="hit__path truncate">{hit.relPath.replace(/\.md$/, '')}</span>
        {hit.matches.length > 0 && <span className="hit__count">{hit.matches.length}</span>}
      </button>

      {expanded &&
        (hit.matches.length > 0 ? (
          hit.matches.map((match) => (
            <button
              key={match.line}
              type="button"
              className="hit__line"
              onClick={() => void openNote(hit.relPath, { line: match.line })}
            >
              <span className="hit__no">{match.line + 1}</span>
              <span className="hit__text">
                <Highlight text={match.text} from={match.from} to={match.to} />
              </span>
            </button>
          ))
        ) : (
          <button
            type="button"
            className="hit__line"
            onClick={() => void openNote(hit.relPath)}
          >
            <span className="hit__text hit__text--muted">{hit.excerpt}</span>
          </button>
        ))}
    </section>
  )
}

export function SearchView() {
  const query = useStone((s) => s.searchQuery)
  const options = useStone((s) => s.searchOptions)
  const hits = useStone((s) => s.searchHits)
  const searching = useStone((s) => s.searching)
  const runSearch = useStone((s) => s.runSearch)
  const setSearchOptions = useStone((s) => s.setSearchOptions)
  const replaceAll = useStone((s) => s.replaceAll)

  const [draft, setDraft] = useState(query)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Debounced, because every keystroke otherwise reads every note on disk.
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(draft), 180)
    return () => clearTimeout(timer)
  }, [draft, runSearch])

  const total = useMemo(
    () => hits.reduce((sum, hit) => sum + Math.max(hit.matches.length, 1), 0),
    [hits]
  )

  return (
    <div className="searchview">
      <div className="searchview__head">
        <div className="searchview__field">
          <IconSearch size={14} />
          <input
            ref={input}
            className="searchview__input"
            placeholder="Search the vault — try path: tag: file: or turn on regex"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Search the vault"
          />
          {draft && (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Clear"
              onClick={() => setDraft('')}
            >
              <IconX size={12} />
            </button>
          )}
        </div>

        <div className="searchview__flags">
          <button
            type="button"
            className="filterbtn"
            aria-pressed={options.caseSensitive}
            data-tip="Match case"
            onClick={() => setSearchOptions({ caseSensitive: !options.caseSensitive })}
          >
            Aa
          </button>
          <button
            type="button"
            className="filterbtn"
            aria-pressed={options.wholeWord}
            data-tip="Whole words only"
            onClick={() => setSearchOptions({ wholeWord: !options.wholeWord })}
          >
            ab|
          </button>
          <button
            type="button"
            className="filterbtn"
            aria-pressed={options.regex}
            data-tip="Regular expression"
            onClick={() => setSearchOptions({ regex: !options.regex })}
          >
            .*
          </button>
          <button
            type="button"
            className="filterbtn"
            aria-pressed={replacing}
            data-tip="Replace across the vault"
            onClick={() => setReplacing((v) => !v)}
          >
            Replace
          </button>
        </div>
      </div>

      {replacing && (
        <div className="searchview__replace">
          <input
            className="field"
            placeholder="Replace with…"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          {confirming ? (
            <>
              <span className="searchview__warn">
                Rewrites {total} match{total === 1 ? '' : 'es'} in {hits.length} note
                {hits.length === 1 ? '' : 's'}.
              </span>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => {
                  void replaceAll(replacement)
                  setConfirming(false)
                }}
              >
                Replace them
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!draft.trim() || hits.length === 0}
              onClick={() => setConfirming(true)}
            >
              Replace all
            </button>
          )}
        </div>
      )}

      <div className="searchview__meta">
        {searching
          ? 'Searching…'
          : draft.trim()
            ? `${total} match${total === 1 ? '' : 'es'} in ${hits.length} note${hits.length === 1 ? '' : 's'}`
            : 'Results appear as you type.'}
      </div>

      <div className="searchview__list">
        {!searching && draft.trim() && hits.length === 0 && (
          <div className="empty">
            <div className="empty__inner">
              <p className="empty__title">Nothing found</p>
              <p className="empty__body">
                Operators narrow a search: <code>tag:project</code>, <code>path:Journal</code>,{' '}
                <code>file:review</code>. They combine with the words you type.
              </p>
            </div>
          </div>
        )}
        {hits.map((hit) => (
          <HitRow key={hit.relPath} hit={hit} />
        ))}
      </div>
    </div>
  )
}

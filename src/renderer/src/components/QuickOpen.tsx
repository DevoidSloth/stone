import { useEffect, useMemo, useRef, useState } from 'react'
import { useStone } from '../store'
import { fuzzyMatch, highlight } from '../lib/fuzzy'
import { IconFolder, IconNote } from '../ui/icons'

/**
 * Go to file.
 *
 * The command palette answers "what do I want to do"; this answers "which
 * file", which is a different question asked far more often and deserves not
 * to be filtered through a list of commands first. It opens from the path bar
 * at the top of a pane — the row that reads like a URL, so it behaves like one
 * — and whatever it opens lands in *that* pane, not wherever focus happens to
 * be.
 */

interface Row {
  key: string
  /** The name shown big, with the matched letters marked. */
  name: string
  ranges: [number, number][]
  /** Where it lives, shown small. */
  where: string
  score: number
  open: (mode: Mode) => void
}

type Mode = 'here' | 'tab' | 'split'

const LIMIT = 40

export function QuickOpen() {
  const paneIndex = useStone((s) => s.quickOpen)
  const setQuickOpen = useStone((s) => s.setQuickOpen)
  const notes = useStone((s) => s.notes)
  const documents = useStone((s) => s.documents)
  const openNote = useStone((s) => s.openNote)
  const openDocument = useStone((s) => s.openDocument)

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const open = useMemo(() => paneIndex !== null, [paneIndex])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  /**
   * Send a target to a pane. `split` makes the new column first and opens into
   * that, which is how you get a note beside the one you were reading without
   * a second gesture.
   */
  const send = (mode: Mode, into: (pane: number, newTab: boolean) => void): void => {
    const pane = paneIndex ?? 0
    setQuickOpen(null)
    useStone.getState().focusPane(pane)
    if (mode === 'split') useStone.getState().splitPane()
    into(mode === 'split' ? useStone.getState().activePane : pane, mode === 'tab')
  }

  const rows = useMemo<Row[]>(() => {
    if (paneIndex === null) return []
    const q = query.trim()

    const noteRows = notes.map((note) => {
      const folder = note.relPath.includes('/')
        ? note.relPath.slice(0, note.relPath.lastIndexOf('/'))
        : 'Vault root'
      // Score the name and the whole path, and keep the better of the two —
      // typing a folder name has to find its notes, but a name match on the
      // same query is the more likely target and is weighted to say so.
      const byName = fuzzyMatch(q, note.title)
      const byPath = fuzzyMatch(q, note.relPath)
      if (!byName && !byPath) return null
      const nameWins = byName !== null && (!byPath || byName.score + 12 >= byPath.score)
      return {
        key: `note:${note.relPath}`,
        name: note.title,
        ranges: nameWins ? byName!.ranges : [],
        where: folder,
        score: nameWins ? byName!.score + 12 : byPath!.score,
        // Recency only ever breaks ties; it must not outrank a better match.
        recency: note.mtime,
        open: (mode: Mode) =>
          send(mode, (pane, newTab) => void openNote(note.relPath, { pane, newTab }))
      }
    })

    const docRows = documents.map((doc) => {
      const hit = fuzzyMatch(q, doc.name)
      if (!hit) return null
      return {
        key: `doc:${doc.id}`,
        name: doc.name,
        ranges: hit.ranges,
        where: [doc.kind.toUpperCase(), doc.folderPath || null].filter(Boolean).join(' · '),
        score: hit.score,
        recency: doc.mtime,
        open: (mode: Mode) => send(mode, (pane, newTab) => openDocument(doc.path, { pane, newTab }))
      }
    })

    const all = [...noteRows, ...docRows].filter((row): row is NonNullable<typeof row> => row !== null)
    all.sort((a, b) => b.score - a.score || b.recency - a.recency)
    return all.slice(0, LIMIT)
  }, [paneIndex, query, notes, documents, openNote, openDocument])

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(rows.length - 1, 0)))
  }, [rows.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (paneIndex === null) return null

  const mac = window.stone.platform === 'darwin'

  return (
    <div className="overlay overlay--top" onMouseDown={() => setQuickOpen(null)} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to file"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Go to a note or document…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              rows[cursor]?.open(e.metaKey || e.ctrlKey ? 'tab' : e.shiftKey ? 'split' : 'here')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setQuickOpen(null)
            }
          }}
        />

        <div className="palette__list" ref={listRef}>
          {rows.length === 0 && (
            <p className="palette__empty">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : 'The vault is empty.'}
            </p>
          )}

          {rows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              className="palette__row"
              data-active={index === cursor}
              onMouseEnter={() => setCursor(index)}
              onClick={(e) => row.open(e.metaKey || e.ctrlKey ? 'tab' : e.shiftKey ? 'split' : 'here')}
            >
              <span className="palette__icon">
                {row.key.startsWith('doc:') ? <IconFolder size={15} /> : <IconNote size={15} />}
              </span>
              <span className="palette__label truncate">
                {highlight(row.name, row.ranges).map((chunk, i) =>
                  chunk.hit ? (
                    <b key={i} className="palette__hit">
                      {chunk.text}
                    </b>
                  ) : (
                    <span key={i}>{chunk.text}</span>
                  )
                )}
                <span className="palette__sub" style={{ display: 'block' }}>
                  {row.where}
                </span>
              </span>
            </button>
          ))}
        </div>

        <footer className="palette__foot">
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>{mac ? '⌘' : 'Ctrl'}↵</kbd> new tab
          </span>
          <span>
            <kbd>⇧↵</kbd> in a split
          </span>
        </footer>
      </div>
    </div>
  )
}

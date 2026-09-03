import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SearchHit } from '@shared/types'
import { useStone } from '../store'
import { COMMANDS, commandLabel, keysFor } from '../commands'
import { formatChord } from '../lib/keys'
import { IconFolder, IconNote, IconPuzzle, IconSearch } from '../ui/icons'
import { useFocusTrap } from '../lib/focus-trap'

interface Command {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette() {
  const open = useStone((s) => s.paletteOpen)
  const setPalette = useStone((s) => s.setPalette)
  const notes = useStone((s) => s.notes)
  const settings = useStone((s) => s.settings)
  const pluginCommands = useStone((s) => s.pluginCommands)
  const openNote = useStone((s) => s.openNote)
  const documents = useStone((s) => s.documents)
  const openDocument = useStone((s) => s.openDocument)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useFocusTrap(dialog, open)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Focus after the rise animation starts so the caret does not jump.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Full-text search runs in main; debounce so typing stays smooth on big vaults.
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      void window.stone.search
        .query(trimmed, { limit: 30 })
        .then(setHits)
        .catch(() => setHits([]))
    }, 90)
    return () => clearTimeout(timer)
  }, [query, open])

  const commands = useMemo<Command[]>(() => {
    const overrides = settings?.keybindings ?? {}
    const ctx = { query }
    const built = COMMANDS.filter((c) => !c.paletteHidden).map((command) => {
      const Icon = command.icon
      const [chord] = keysFor(command, overrides)
      return {
        id: command.id,
        label: commandLabel(command, ctx),
        hint: chord ? formatChord(chord) : undefined,
        icon: <Icon size={15} />,
        run: () => command.run(ctx)
      }
    })

    // Plugin commands sit alongside the built-in ones rather than in a section
    // of their own: to the person typing, where a command came from is trivia.
    return [
      ...built,
      ...pluginCommands.map((command) => ({
        id: `${command.pluginId}:${command.id}`,
        label: command.name,
        icon: <IconPuzzle size={15} />,
        run: () => void window.stone.plugins.run(command.pluginId, command.id)
      }))
    ]
  }, [query, settings, pluginCommands])

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 5)
    return commands.filter((c) => c.label.toLowerCase().includes(q)).slice(0, 6)
  }, [commands, query])

  const noteResults = useMemo(() => {
    if (query.trim()) return hits
    return notes.slice(0, 8).map<SearchHit>((n) => ({
      relPath: n.relPath,
      title: n.title,
      score: 0,
      excerpt: n.excerpt,
      matchedTerms: [],
      matches: []
    }))
  }, [hits, notes, query])

  /**
   * Documents rank alongside notes rather than in a section of their own.
   * Searching for a thing should not require knowing what kind of file it is.
   */
  const documentResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return documents
      .filter((d) => d.name.toLowerCase().includes(q))
      .slice(0, 5)
  }, [documents, query])

  const rows = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ kind: 'command' as const, command: c })),
      ...documentResults.map((d) => ({ kind: 'doc' as const, doc: d })),
      ...noteResults.map((h) => ({ kind: 'note' as const, hit: h }))
    ],
    [filteredCommands, documentResults, noteResults]
  )

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(rows.length - 1, 0)))
  }, [rows.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const activate = (index: number): void => {
    const row = rows[index]
    if (!row) return
    setPalette(false)
    if (row.kind === 'command') row.command.run()
    else if (row.kind === 'doc') openDocument(row.doc.path)
    else void openNote(row.hit.relPath)
  }

  return (
    <div className="overlay overlay--top" onMouseDown={() => setPalette(false)} role="presentation">
      <div
        className="palette"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search notes, or type a command…"
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
              activate(cursor)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setPalette(false)
            }
          }}
        />

        <div className="palette__list" ref={listRef}>
          {rows.length === 0 && (
            <p className="palette__empty">No notes match “{query.trim()}”.</p>
          )}

          {filteredCommands.length > 0 && <div className="palette__group eyebrow">Commands</div>}
          {rows.map((row, index) => {
            if (row.kind !== 'command') return null
            return (
              <button
                key={row.command.id}
                type="button"
                className="palette__row"
                data-active={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activate(index)}
              >
                <span className="palette__icon">{row.command.icon}</span>
                <span className="palette__label truncate">{row.command.label}</span>
                {row.command.hint && <span className="palette__kbd">{row.command.hint}</span>}
              </button>
            )
          })}

          {documentResults.length > 0 && <div className="palette__group eyebrow">Documents</div>}
          {rows.map((row, index) => {
            if (row.kind !== 'doc') return null
            return (
              <button
                key={row.doc.id}
                type="button"
                className="palette__row"
                data-active={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activate(index)}
              >
                <span className="palette__icon">
                  <IconFolder size={15} />
                </span>
                <span className="palette__label truncate">
                  {row.doc.name}
                  <span className="palette__sub" style={{ display: 'block' }}>
                    {row.doc.kind.toUpperCase()}
                    {row.doc.pageCount ? ` · ${row.doc.pageCount} pages` : ''}
                    {row.doc.evicted ? ' · not downloaded' : ''}
                  </span>
                </span>
              </button>
            )
          })}

          {noteResults.length > 0 && (
            <div className="palette__group eyebrow">
              {query.trim() ? 'Matching notes' : 'Recent notes'}
            </div>
          )}
          {rows.map((row, index) => {
            if (row.kind !== 'note') return null
            return (
              <button
                key={row.hit.relPath}
                type="button"
                className="palette__row"
                data-active={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activate(index)}
              >
                <span className="palette__icon">
                  {query.trim() ? <IconSearch size={15} /> : <IconNote size={15} />}
                </span>
                <span className="palette__label truncate">
                  {row.hit.title}
                  {row.hit.excerpt && (
                    <span className="palette__sub" style={{ display: 'block' }}>
                      {row.hit.excerpt.slice(0, 90)}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

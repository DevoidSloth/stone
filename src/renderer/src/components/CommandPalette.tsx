import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SearchHit } from '@shared/types'
import { useStone } from '../store'
import { today } from '../lib/dates'
import {
  IconCalendar,
  IconDownload,
  IconNote,
  IconOutline,
  IconPlus,
  IconProperties,
  IconRefresh,
  IconSettings,
  IconSplit,
  IconSun,
  IconTable,
  IconTasks,
  IconTrash,
  IconLayers,
  IconSearch
} from '../ui/icons'

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
  const openNote = useStone((s) => s.openNote)
  const openDaily = useStone((s) => s.openDaily)
  const createNote = useStone((s) => s.createNote)
  const setView = useStone((s) => s.setView)
  const setSettingsOpen = useStone((s) => s.setSettingsOpen)
  const setQuickAdd = useStone((s) => s.setQuickAdd)
  const updateSettings = useStone((s) => s.updateSettings)
  const refreshVault = useStone((s) => s.refreshVault)
  const openPeriodic = useStone((s) => s.openPeriodic)
  const splitPane = useStone((s) => s.splitPane)
  const setSidePanel = useStone((s) => s.setSidePanel)
  const toast = useStone((s) => s.toast)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'today',
        label: "Open today's note",
        hint: 'T',
        icon: <IconLayers size={15} />,
        run: () => void openDaily(today())
      },
      {
        id: 'new-note',
        label: query.trim() ? `Create note "${query.trim()}"` : 'Create a note',
        icon: <IconPlus size={15} />,
        run: () => void createNote(query.trim() || 'Untitled')
      },
      {
        id: 'new-task',
        label: 'Add a task',
        icon: <IconTasks size={15} />,
        run: () => setQuickAdd(true)
      },
      {
        id: 'search',
        label: 'Search the whole vault',
        hint: '⇧F',
        icon: <IconSearch size={15} />,
        run: () => setView('search')
      },
      {
        id: 'calendar',
        label: 'Go to calendar',
        icon: <IconCalendar size={15} />,
        run: () => setView('calendar')
      },
      {
        id: 'tasks',
        label: 'Go to tasks',
        icon: <IconTasks size={15} />,
        run: () => setView('tasks')
      },
      {
        id: 'views',
        label: 'Go to views',
        icon: <IconTable size={15} />,
        run: () => setView('views')
      },
      {
        id: 'trash',
        label: 'Open the trash',
        icon: <IconTrash size={15} />,
        run: () => setView('trash')
      },
      {
        id: 'weekly',
        label: "Open this week's note",
        icon: <IconCalendar size={15} />,
        run: () => void openPeriodic('week')
      },
      {
        id: 'monthly',
        label: "Open this month's note",
        icon: <IconCalendar size={15} />,
        run: () => void openPeriodic('month')
      },
      {
        id: 'split',
        label: 'Split the editor',
        hint: '⇧E',
        icon: <IconSplit size={15} />,
        run: () => splitPane()
      },
      {
        id: 'outline',
        label: 'Show the outline',
        icon: <IconOutline size={15} />,
        run: () => {
          setView('notes')
          setSidePanel('outline')
        }
      },
      {
        id: 'properties',
        label: 'Edit page properties',
        icon: <IconProperties size={15} />,
        run: () => {
          setView('notes')
          setSidePanel('properties')
        }
      },
      {
        id: 'export-pdf',
        label: 'Export this note as a PDF',
        icon: <IconDownload size={15} />,
        run: () => {
          const relPath = useStone.getState().activeRelPath
          if (!relPath) {
            toast('Open a note first.', 'error')
            return
          }
          void window.stone.exporter.pdf(relPath).then((saved) => {
            if (saved) toast(`Exported to ${saved}.`, 'success')
          })
        }
      },
      {
        id: 'export-vault',
        label: 'Export the whole vault',
        icon: <IconDownload size={15} />,
        run: () => {
          void window.stone.exporter.vault().then((result) => {
            if (result) toast(`${result.count} notes exported to ${result.folder}.`, 'success')
          })
        }
      },
      {
        id: 'vim',
        label: settings?.vimMode ? 'Turn off vim mode' : 'Turn on vim mode',
        icon: <IconSettings size={15} />,
        run: () => void updateSettings({ vimMode: !settings?.vimMode })
      },
      {
        id: 'theme',
        label: settings?.theme === 'light' ? 'Use the dark theme' : 'Use the light theme',
        icon: <IconSun size={15} />,
        run: () => void updateSettings({ theme: settings?.theme === 'light' ? 'dark' : 'light' })
      },
      {
        id: 'reindex',
        label: 'Rebuild the vault index',
        icon: <IconRefresh size={15} />,
        run: () => {
          void window.stone.vault
            .reindex()
            .then(() => refreshVault())
            .then(() => toast('Vault reindexed.', 'success'))
        }
      },
      {
        id: 'settings',
        label: 'Open settings',
        icon: <IconSettings size={15} />,
        run: () => setSettingsOpen(true)
      }
    ],
    [
      query,
      settings,
      openDaily,
      createNote,
      setQuickAdd,
      setView,
      updateSettings,
      refreshVault,
      setSettingsOpen,
      openPeriodic,
      splitPane,
      setSidePanel,
      toast
    ]
  )

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

  const rows = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ kind: 'command' as const, command: c })),
      ...noteResults.map((h) => ({ kind: 'note' as const, hit: h }))
    ],
    [filteredCommands, noteResults]
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
    else void openNote(row.hit.relPath)
  }

  return (
    <div className="overlay overlay--top" onMouseDown={() => setPalette(false)} role="presentation">
      <div
        className="palette"
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

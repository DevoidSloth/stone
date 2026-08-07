import { useEffect, useMemo, useState } from 'react'
import type { NoteMeta } from '@shared/types'
import { useStone } from '../store'
import { MONTHS, relativeDay, toISODate } from '../lib/dates'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import {
  IconChevronRight,
  IconCopy,
  IconFolder,
  IconHash,
  IconNote,
  IconPlus,
  IconStar,
  IconTrash
} from '../ui/icons'

type Tab = 'pages' | 'recent' | 'tags'

const DATE_TITLE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const COLLAPSED_KEY = 'stone.collapsedFolders'
const COLLAPSED_TAGS_KEY = 'stone.collapsedTags'

/** Daily notes are named by date; the raw ISO string reads as a filename. */
function displayTitle(note: NoteMeta): string {
  const m = DATE_TITLE_RE.exec(note.title)
  if (!m) return note.title
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${m[1]}`
}

function matches(note: NoteMeta, needle: string): boolean {
  if (!needle) return true
  const q = needle.toLowerCase()
  return (
    note.title.toLowerCase().includes(q) ||
    note.relPath.toLowerCase().includes(q) ||
    note.tags.some((t) => t.toLowerCase().includes(q)) ||
    note.aliases.some((a) => a.toLowerCase().includes(q)) ||
    note.excerpt.toLowerCase().includes(q)
  )
}

interface Folder {
  name: string
  path: string
  folders: Folder[]
  notes: NoteMeta[]
}

/** Rebuild the vault's directory structure from the relative paths. */
function buildTree(notes: NoteMeta[], allFolders: string[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], notes: [] }

  const folderAt = (segments: string[]): Folder => {
    let cursor = root
    let walked = ''
    for (const part of segments) {
      walked = walked ? `${walked}/${part}` : part
      let next = cursor.folders.find((f) => f.name === part)
      if (!next) {
        next = { name: part, path: walked, folders: [], notes: [] }
        cursor.folders.push(next)
      }
      cursor = next
    }
    return cursor
  }

  // Seed from the real folder list so an empty folder is still shown — one you
  // just made and cannot see is indistinguishable from one that failed.
  for (const folder of allFolders) folderAt(folder.split('/'))

  for (const note of notes) {
    const parts = note.relPath.split('/')
    parts.pop()
    folderAt(parts).notes.push(note)
  }

  const sort = (folder: Folder): void => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name))
    folder.notes.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)))
    folder.folders.forEach(sort)
  }
  sort(root)
  return root
}

/** A `#work/admin` tag tree, so a hierarchy reads as one. */
interface TagNode {
  name: string
  path: string
  count: number
  children: TagNode[]
}

function buildTagTree(tags: { tag: string; count: number }[]): TagNode[] {
  const roots: TagNode[] = []

  for (const { tag, count } of tags) {
    const parts = tag.split('/')
    let level = roots
    let walked = ''
    for (const part of parts) {
      walked = walked ? `${walked}/${part}` : part
      let node = level.find((n) => n.name === part)
      if (!node) {
        node = { name: part, path: walked, count: 0, children: [] }
        level.push(node)
      }
      // A parent's count includes its children, which is what a reader expects
      // of `#work` when everything is actually filed under `#work/something`.
      node.count += count
      level = node.children
    }
  }

  const sort = (nodes: TagNode[]): void => {
    nodes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    nodes.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

function NoteRow({
  note,
  depth,
  active,
  favorited,
  onOpen,
  onMenu
}: {
  note: NoteMeta
  depth: number
  active: boolean
  favorited: boolean
  onOpen: (relPath: string, newTab: boolean) => void
  onMenu: (event: React.MouseEvent, note: NoteMeta) => void
}) {
  const open = note.taskCount - note.doneCount
  return (
    <button
      type="button"
      className="treerow"
      aria-current={active}
      draggable
      style={{ paddingLeft: 6 + depth * 14 }}
      title={`${note.title} · edited ${relativeDay(toISODate(new Date(note.mtime)))}`}
      onClick={(e) => onOpen(note.relPath, e.metaKey || e.ctrlKey)}
      onAuxClick={(e) => {
        if (e.button === 1) onOpen(note.relPath, true)
      }}
      onContextMenu={(e) => onMenu(e, note)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/stone-note', note.relPath)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <span className="treerow__twist" />
      <span className="treerow__icon">
        {note.icon ? <span className="treerow__emoji">{note.icon}</span> : <IconNote size={15} />}
      </span>
      <span className="treerow__label truncate">{displayTitle(note)}</span>
      {favorited && <IconStar size={11} className="treerow__star" />}
      {open > 0 && <span className="treerow__count">{open}</span>}
    </button>
  )
}

function FolderRows({
  folder,
  depth,
  collapsed,
  toggle,
  activeRelPath,
  favorites,
  onOpen,
  onNoteMenu,
  onFolderMenu,
  onDropNote
}: {
  folder: Folder
  depth: number
  collapsed: Set<string>
  toggle: (path: string) => void
  activeRelPath: string | null
  favorites: string[]
  onOpen: (relPath: string, newTab: boolean) => void
  onNoteMenu: (event: React.MouseEvent, note: NoteMeta) => void
  onFolderMenu: (event: React.MouseEvent, path: string) => void
  onDropNote: (relPath: string, folder: string) => void
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  return (
    <>
      {folder.folders.map((child) => {
        const isCollapsed = collapsed.has(child.path)
        const count = child.notes.length + child.folders.length
        return (
          <div key={child.path}>
            <button
              type="button"
              className="treerow treerow--folder"
              data-drop={dropTarget === child.path}
              style={{ paddingLeft: 6 + depth * 14 }}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(child.path)}
              onContextMenu={(e) => onFolderMenu(e, child.path)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/stone-note')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropTarget(child.path)
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDropTarget(null)
                const relPath = e.dataTransfer.getData('text/stone-note')
                if (relPath) onDropNote(relPath, child.path)
              }}
            >
              <span className={`treerow__twist ${isCollapsed ? '' : 'treerow__twist--open'}`}>
                <IconChevronRight size={12} />
              </span>
              <span className="treerow__label truncate">{child.name}</span>
              <span className="treerow__count">{count}</span>
            </button>
            {!isCollapsed && (
              <FolderRows
                folder={child}
                depth={depth + 1}
                collapsed={collapsed}
                toggle={toggle}
                activeRelPath={activeRelPath}
                favorites={favorites}
                onOpen={onOpen}
                onNoteMenu={onNoteMenu}
                onFolderMenu={onFolderMenu}
                onDropNote={onDropNote}
              />
            )}
          </div>
        )
      })}
      {folder.notes.map((note) => (
        <NoteRow
          key={note.relPath}
          note={note}
          depth={depth}
          active={note.relPath === activeRelPath}
          favorited={favorites.includes(note.relPath)}
          onOpen={onOpen}
          onMenu={onNoteMenu}
        />
      ))}
    </>
  )
}

function TagRows({
  nodes,
  depth,
  collapsed,
  toggle,
  onPick,
  onMenu
}: {
  nodes: TagNode[]
  depth: number
  collapsed: Set<string>
  toggle: (path: string) => void
  onPick: (tag: string) => void
  onMenu: (event: React.MouseEvent, tag: string) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const isCollapsed = collapsed.has(node.path)
        return (
          <div key={node.path}>
            <div className="tagrow" style={{ paddingLeft: 4 + depth * 12 }}>
              {node.children.length > 0 ? (
                <button
                  type="button"
                  className={`tagrow__twist ${isCollapsed ? '' : 'tagrow__twist--open'}`}
                  aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                  onClick={() => toggle(node.path)}
                >
                  <IconChevronRight size={11} />
                </button>
              ) : (
                <span className="tagrow__twist" />
              )}
              <button
                type="button"
                className="tagrow__label truncate"
                onClick={() => onPick(node.path)}
                onContextMenu={(e) => onMenu(e, node.path)}
              >
                <IconHash size={11} />
                {node.name}
              </button>
              <span className="tagrow__count">{node.count}</span>
            </div>
            {!isCollapsed && node.children.length > 0 && (
              <TagRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                toggle={toggle}
                onPick={onPick}
                onMenu={onMenu}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar() {
  const notes = useStone((s) => s.notes)
  const tags = useStone((s) => s.tags)
  const stats = useStone((s) => s.stats)
  const folderList = useStone((s) => s.folders)
  const templates = useStone((s) => s.templates)
  const settings = useStone((s) => s.settings)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const openNote = useStone((s) => s.openNote)
  const createNote = useStone((s) => s.createNote)
  const createFromTemplate = useStone((s) => s.createFromTemplate)
  const deleteNote = useStone((s) => s.deleteNote)
  const duplicateNote = useStone((s) => s.duplicateNote)
  const moveNote = useStone((s) => s.moveNote)
  const toggleFavorite = useStone((s) => s.toggleFavorite)
  const refreshVault = useStone((s) => s.refreshVault)
  const toast = useStone((s) => s.toast)

  const [tab, setTab] = useState<Tab>('pages')
  const [filter, setFilter] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_TAGS_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])
  useEffect(() => {
    localStorage.setItem(COLLAPSED_TAGS_KEY, JSON.stringify([...collapsedTags]))
  }, [collapsedTags])

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleTag = (path: string): void => {
    setCollapsedTags((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const favorites = settings?.favorites ?? []

  const filtered = useMemo(() => {
    let list = notes.filter((n) => matches(n, filter))
    // A nested tag filter matches its children too.
    if (tagFilter) {
      list = list.filter((n) =>
        n.tags.some((t) => t === tagFilter || t.startsWith(`${tagFilter}/`))
      )
    }
    return list
  }, [notes, filter, tagFilter])

  const tree = useMemo(() => buildTree(filtered, folderList), [filtered, folderList])
  const tagTree = useMemo(() => buildTagTree(tags), [tags])
  const recent = useMemo(() => filtered.slice(0, 100), [filtered])
  const searching = filter.trim().length > 0
  const favoriteNotes = useMemo(
    () => favorites.map((f) => notes.find((n) => n.relPath === f)).filter((n): n is NoteMeta => Boolean(n)),
    [favorites, notes]
  )

  const open = (relPath: string, newTab: boolean): void => {
    void openNote(relPath, { newTab })
  }

  const noteMenu = (event: React.MouseEvent, note: NoteMeta): void => {
    const items: MenuItem[] = [
      { id: 'open-tab', label: 'Open in a new tab', run: () => void openNote(note.relPath, { newTab: true }) },
      {
        id: 'open-split',
        label: 'Open in a split',
        run: () => {
          useStone.getState().splitPane()
          void openNote(note.relPath, { pane: useStone.getState().panes.length - 1 })
        }
      },
      {
        id: 'favorite',
        label: favorites.includes(note.relPath) ? 'Remove from favourites' : 'Add to favourites',
        icon: <IconStar size={13} />,
        run: () => void toggleFavorite(note.relPath)
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: <IconCopy size={13} />,
        run: () => void duplicateNote(note.relPath)
      },
      {
        id: 'move',
        label: 'Move to',
        icon: <IconFolder size={13} />,
        children: [
          { id: 'root', label: 'Vault root', run: () => void moveNote(note.relPath, '') },
          ...folderList.map((f) => ({ id: f, label: f, run: () => void moveNote(note.relPath, f) }))
        ]
      },
      {
        id: 'reveal',
        label: 'Show in folder',
        run: () => void window.stone.vault.revealInFolder(note.relPath)
      },
      {
        id: 'delete',
        label: 'Move to trash',
        icon: <IconTrash size={13} />,
        danger: true,
        run: () => void deleteNote(note.relPath)
      }
    ]
    openMenu(event, items)
  }

  const folderMenu = (event: React.MouseEvent, path: string): void => {
    const items: MenuItem[] = [
      {
        id: 'new-note',
        label: 'New note here',
        icon: <IconPlus size={13} />,
        run: () => void createNote('Untitled', path)
      },
      {
        id: 'new-folder',
        label: 'New folder inside',
        icon: <IconFolder size={13} />,
        run: () => {
          const name = window.prompt('Name for the new folder')
          if (!name?.trim()) return
          void window.stone.folders
            .create(`${path}/${name.trim()}`)
            .then(() => refreshVault())
            .catch((err: Error) => toast(err.message, 'error'))
        }
      },
      {
        id: 'rename',
        label: 'Rename folder',
        run: () => {
          const name = window.prompt('Rename folder', path.split('/').pop() ?? '')
          if (!name?.trim()) return
          void window.stone.folders
            .rename(path, name.trim())
            .then(() => refreshVault())
            .catch((err: Error) => toast(err.message, 'error'))
        }
      },
      {
        id: 'delete',
        label: 'Move folder to trash',
        icon: <IconTrash size={13} />,
        danger: true,
        run: () => {
          void window.stone.folders
            .remove(path)
            .then(() => refreshVault())
            .then(() => toast('Folder moved to the vault trash.', 'success'))
            .catch((err: Error) => toast(err.message, 'error'))
        }
      }
    ]
    openMenu(event, items)
  }

  const tagMenu = (event: React.MouseEvent, tag: string): void => {
    openMenu(event, [
      {
        id: 'filter',
        label: `Filter by #${tag}`,
        run: () => {
          setTagFilter(tag)
          setTab('pages')
        }
      },
      {
        id: 'rename',
        label: 'Rename tag everywhere',
        run: () => {
          const next = window.prompt(`Rename #${tag} to`, tag)
          if (!next?.trim() || next.trim() === tag) return
          void window.stone.vault
            .renameTag(tag, next.trim())
            .then((result) => {
              void refreshVault()
              toast(`Renamed across ${result.notes} note${result.notes === 1 ? '' : 's'}.`, 'success')
            })
            .catch((err: Error) => toast(err.message, 'error'))
        }
      }
    ])
  }

  const newNoteMenu = (event: React.MouseEvent): void => {
    if (templates.length === 0) {
      void createNote('Untitled')
      return
    }
    openMenu(event, [
      { id: 'blank', label: 'Blank note', run: () => void createNote('Untitled') },
      ...templates.map((template) => ({
        id: template.relPath,
        label: `${template.icon ? `${template.icon} ` : ''}${template.title}`,
        run: () => void createFromTemplate('Untitled', template.relPath)
      }))
    ])
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__inner">
        <div className="sidebar__head">
          <input
            className="field sidebar__filter"
            placeholder="Search pages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search pages"
          />
          <div className="tabs" role="tablist" aria-label="Sidebar mode">
            {(['pages', 'recent', 'tags'] as Tab[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="tabs__btn"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {id === 'pages' ? 'Pages' : id === 'recent' ? 'Recent' : 'Tags'}
              </button>
            ))}
          </div>
        </div>

        {tagFilter && (
          <div style={{ padding: '6px 8px 0' }}>
            <button type="button" className="tagchip" onClick={() => setTagFilter(null)}>
              <IconHash size={11} />
              {tagFilter}
              <b>clear</b>
            </button>
          </div>
        )}

        {tab === 'tags' ? (
          <div className="sidebar__list">
            {tags.length === 0 ? (
              <p className="empty__body" style={{ padding: '8px 6px', textAlign: 'left' }}>
                Tags appear once you write <code>#something</code> in a note. Use a slash for a
                hierarchy — <code>#work/admin</code>.
              </p>
            ) : (
              <TagRows
                nodes={tagTree}
                depth={0}
                collapsed={collapsedTags}
                toggle={toggleTag}
                onPick={(tag) => {
                  setTagFilter(tag)
                  setTab('pages')
                }}
                onMenu={tagMenu}
              />
            )}
          </div>
        ) : (
          <div className="sidebar__list">
            {favoriteNotes.length > 0 && tab === 'pages' && !searching && (
              <>
                <div className="sidebar__group eyebrow">Favourites</div>
                {favoriteNotes.map((note) => (
                  <NoteRow
                    key={`fav-${note.relPath}`}
                    note={note}
                    depth={0}
                    active={note.relPath === activeRelPath}
                    favorited
                    onOpen={open}
                    onMenu={noteMenu}
                  />
                ))}
                <div className="sidebar__group eyebrow">All pages</div>
              </>
            )}

            {filtered.length === 0 && (
              <div className="empty" style={{ padding: 'var(--sp-5) var(--sp-2)' }}>
                <div className="empty__inner">
                  <p className="empty__body">
                    {searching ? 'No pages match that search.' : 'No pages yet.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={() => void createNote('Untitled')}
                  >
                    <IconPlus size={13} />
                    New page
                  </button>
                </div>
              </div>
            )}

            {/* A search should show hits directly, not make you expand folders. */}
            {tab === 'recent' || searching
              ? recent.map((note) => (
                  <NoteRow
                    key={note.relPath}
                    note={note}
                    depth={0}
                    active={note.relPath === activeRelPath}
                    favorited={favorites.includes(note.relPath)}
                    onOpen={open}
                    onMenu={noteMenu}
                  />
                ))
              : filtered.length > 0 && (
                  <FolderRows
                    folder={tree}
                    depth={0}
                    collapsed={collapsed}
                    toggle={toggle}
                    activeRelPath={activeRelPath}
                    favorites={favorites}
                    onOpen={open}
                    onNoteMenu={noteMenu}
                    onFolderMenu={folderMenu}
                    onDropNote={(relPath, folder) => void moveNote(relPath, folder)}
                  />
                )}
          </div>
        )}

        <div className="sidebar__foot">
          <button
            type="button"
            className="btn btn--sm sidebar__new"
            onClick={newNoteMenu}
            title={templates.length > 0 ? 'New page, blank or from a template' : 'New page'}
          >
            <IconPlus size={13} />
            New page
          </button>
          <button
            type="button"
            className="btn btn--sm btn--icon"
            aria-label="New folder"
            title="New folder"
            onClick={() => {
              const name = window.prompt('Name for the new folder')
              if (!name?.trim()) return
              void window.stone.folders
                .create(name.trim())
                .then(() => refreshVault())
                .catch((err: Error) => toast(err.message, 'error'))
            }}
          >
            <IconFolder size={13} />
          </button>
        </div>
        <div className="sidebar__foot sidebar__foot--stats">
          <span>{stats?.notes ?? 0} pages</span>
          <span>{stats?.openTasks ?? 0} open</span>
        </div>
      </div>

      {menu && <ContextMenu state={menu} onClose={closeMenu} />}
    </aside>
  )
}

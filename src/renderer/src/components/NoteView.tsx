import { useEffect, useMemo, useRef, useState } from 'react'
import { readFrontmatterKey, setFrontmatterKey } from '@shared/frontmatter'
import { useStone } from '../store'
import { Editor } from '../editor/Editor'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCopy,
  IconDownload,
  IconFolder,
  IconHash,
  IconImage,
  IconMore,
  IconSmile,
  IconStar,
  IconTrash
} from '../ui/icons'
import { CoverBand, CoverPicker, IconPicker } from './PageDressing'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { HoverPreview } from './SidePanels'
import { formatLongDate, relativeDay, toISODate } from '../lib/dates'

function basename(relPath: string): string {
  return relPath.split('/').pop()!.replace(/\.md$/, '')
}

const DATE_NAME_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEK_NAME_RE = /^\d{4}-W\d{2}$/

export function NoteView({ relPath, paneIndex }: { relPath: string; paneIndex: number }) {
  const doc = useStone((s) => s.docs[relPath])
  const notes = useStone((s) => s.notes)
  const tags = useStone((s) => s.tags)
  const folders = useStone((s) => s.folders)
  const settings = useStone((s) => s.settings)
  const activePane = useStone((s) => s.activePane)
  const setDoc = useStone((s) => s.setDoc)
  const consumeReveal = useStone((s) => s.consumeReveal)
  const openTarget = useStone((s) => s.openTarget)
  const renameNote = useStone((s) => s.renameNote)
  const deleteNote = useStone((s) => s.deleteNote)
  const moveNote = useStone((s) => s.moveNote)
  const duplicateNote = useStone((s) => s.duplicateNote)
  const toggleFavorite = useStone((s) => s.toggleFavorite)
  const patchNoteMeta = useStone((s) => s.patchNoteMeta)
  const goBack = useStone((s) => s.goBack)
  const goForward = useStone((s) => s.goForward)
  const toast = useStone((s) => s.toast)

  const [title, setTitle] = useState('')
  const [picker, setPicker] = useState<'icon' | 'cover' | null>(null)
  const [hover, setHover] = useState<{ target: string; rect: DOMRect } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()

  const note = useMemo(() => notes.find((n) => n.relPath === relPath) ?? null, [notes, relPath])

  useEffect(() => {
    setTitle(basename(relPath))
    setPicker(null)
    setHover(null)
  }, [relPath])

  if (!doc) return null

  const name = basename(relPath)
  /** Daily and weekly notes are named by date; the raw string reads as a filename. */
  const isDaily = DATE_NAME_RE.test(name)
  const isWeekly = WEEK_NAME_RE.test(name)

  const commitTitle = (): void => {
    const next = title.trim()
    if (!next || next === name) {
      setTitle(name)
      return
    }
    void renameNote(relPath, next)
  }

  /** Fetch a note's body for an `![[embed]]` in the editor. */
  const loadEmbed = async (target: string): Promise<{ title: string; body: string } | null> => {
    const hit = await window.stone.notes.resolveLink(target).catch(() => null)
    if (!hit) return null
    const embedded = await window.stone.notes.get(hit.relPath)
    if (!embedded) return null
    const body = embedded.content.replace(/^---[\s\S]*?---\n?/, '').trim()
    return { title: embedded.title, body }
  }

  // Sans is the default; serif and mono are the opt-ins.
  const fontClass =
    settings?.editorFont === 'serif'
      ? 'note--serif'
      : settings?.editorFont === 'mono'
        ? 'note--mono'
        : ''

  const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : 'Vault root'
  const measure = { '--measure': `${settings?.editorWidth ?? 720}px` } as React.CSSProperties
  const editedOn = note ? toISODate(new Date(note.mtime)) : toISODate(new Date())
  const favorited = settings?.favorites.includes(relPath) ?? false

  /*
   * Read the dressing from the live buffer rather than from the index. The
   * indexed metadata only catches up after autosave, the file watcher, and a
   * reindex, so sourcing it there made a new icon appear about a second late.
   */
  const icon = readFrontmatterKey(doc.content, 'icon')
  const cover = readFrontmatterKey(doc.content, 'cover')

  /** Icon and cover live in frontmatter, so both are one surgical line edit. */
  const setKey = (key: 'icon' | 'cover', value: string | null): void => {
    setDoc(relPath, setFrontmatterKey(doc.content, key, value))
    // Patch the sidebar's copy too, so the tree row updates in the same frame.
    patchNoteMeta(relPath, key === 'icon' ? { icon: value } : { cover: value })
  }

  const exportAs = async (kind: 'markdown' | 'html' | 'pdf'): Promise<void> => {
    try {
      const saved = await window.stone.exporter[kind](relPath)
      if (!saved) return
      toast(`Exported to ${saved}.`, 'success')
      void window.stone.exporter.reveal(saved)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const pageMenu: MenuItem[] = [
    {
      id: 'favorite',
      label: favorited ? 'Remove from favourites' : 'Add to favourites',
      icon: <IconStar size={13} />,
      run: () => void toggleFavorite(relPath)
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <IconCopy size={13} />,
      run: () => void duplicateNote(relPath)
    },
    {
      id: 'move',
      label: 'Move to',
      icon: <IconFolder size={13} />,
      children: [
        { id: 'move-root', label: 'Vault root', run: () => void moveNote(relPath, '') },
        ...folders.map((f) => ({
          id: `move-${f}`,
          label: f,
          run: () => void moveNote(relPath, f)
        }))
      ]
    },
    {
      id: 'insert-file',
      label: 'Insert a file…',
      icon: <IconImage size={13} />,
      run: () => {
        void window.stone.attachments.pick().then((picked) => {
          if (picked.length === 0) return
          setDoc(relPath, `${doc.content.replace(/\s*$/, '')}\n\n${picked.map((p) => p.markdown).join('\n')}\n`)
        })
      }
    },
    {
      id: 'export',
      label: 'Export as',
      icon: <IconDownload size={13} />,
      children: [
        { id: 'export-md', label: 'Markdown', run: () => void exportAs('markdown') },
        { id: 'export-html', label: 'HTML', run: () => void exportAs('html') },
        { id: 'export-pdf', label: 'PDF', run: () => void exportAs('pdf') }
      ]
    },
    {
      id: 'reveal',
      label: 'Show in folder',
      icon: <IconFolder size={13} />,
      run: () => void window.stone.vault.revealInFolder(relPath)
    },
    {
      id: 'delete',
      label: 'Move to trash',
      icon: <IconTrash size={13} />,
      danger: true,
      run: () => void deleteNote(relPath)
    }
  ]

  const body = (
    <>
      {cover && (
        <CoverBand
          cover={cover}
          onChange={() => setPicker(picker === 'cover' ? null : 'cover')}
          onRemove={() => setKey('cover', null)}
        />
      )}

      <div className="note__wrap" style={measure}>
        <div className={`page__dressing ${cover ? 'page__dressing--overlap' : ''}`}>
          {icon && (
            <button
              type="button"
              className="page__icon"
              aria-label="Change page icon"
              onClick={() => setPicker(picker === 'icon' ? null : 'icon')}
            >
              {icon}
            </button>
          )}

          <div className="page__addrow">
            {!icon && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPicker(picker === 'icon' ? null : 'icon')}
              >
                <IconSmile size={14} />
                Add icon
              </button>
            )}
            {!cover && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPicker(picker === 'cover' ? null : 'cover')}
              >
                <IconImage size={14} />
                Add cover
              </button>
            )}
          </div>

          {picker === 'icon' && (
            <IconPicker
              onPick={(emoji) => {
                setKey('icon', emoji)
                setPicker(null)
              }}
              onClear={() => {
                setKey('icon', null)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )}
          {picker === 'cover' && (
            <CoverPicker
              active={cover}
              onPick={(next) => {
                setKey('cover', next)
                setPicker(null)
              }}
              onClear={() => {
                setKey('cover', null)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )}
        </div>

        {isDaily || isWeekly ? (
          <h1 className="note__title note__title--static">
            {isDaily ? formatLongDate(name) : name.replace('-W', ' · week ')}
          </h1>
        ) : (
          <input
            ref={titleRef}
            className="note__title"
            value={title}
            placeholder="Untitled"
            aria-label="Note title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTitle()
                titleRef.current?.blur()
              }
              if (e.key === 'Escape') {
                setTitle(name)
                titleRef.current?.blur()
              }
            }}
          />
        )}

        <div className="note__subline">
          <span>Edited {relativeDay(editedOn)}</span>
          {note && note.words > 0 && <span>{note.words.toLocaleString()} words</span>}
          {note && note.taskCount > 0 && (
            <span>
              {note.doneCount}/{note.taskCount} tasks
            </span>
          )}
          {note?.tags.map((tag) => (
            <span key={tag} className="tagchip">
              <IconHash size={10} />
              {tag}
            </span>
          ))}
        </div>

        <Editor
          docKey={relPath}
          value={doc.content}
          onChange={(next) => setDoc(relPath, next)}
          notes={notes}
          tags={tags}
          onOpenWikilink={(target) => void openTarget(target)}
          onSelectTag={(tag) => toast(`Tagged #${tag}. Filter by it in the sidebar.`, 'info')}
          loadEmbed={loadEmbed}
          attachmentsFolder={settings?.attachmentsFolder ?? 'Attachments'}
          vimMode={settings?.vimMode ?? false}
          spellcheck={settings?.spellcheck ?? true}
          revealLine={doc.revealLine}
          onRevealed={() => consumeReveal(relPath)}
          onHoverLink={(target, rect) => setHover({ target, rect })}
          onHoverEnd={() => setHover(null)}
        />
      </div>
    </>
  )

  return (
    <div className={`note ${fontClass}`} data-focused={paneIndex === activePane}>
      <div className="note__head">
        <div className="note__nav">
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Back"
            title="Back"
            onClick={goBack}
          >
            <IconArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Forward"
            title="Forward"
            onClick={goForward}
          >
            <IconArrowRight size={14} />
          </button>
        </div>

        <div className="note__crumbs">
          <IconFolder size={13} />
          <b>{folder}</b>
        </div>

        <div className="note__status">
          <span>{doc.dirty ? 'Saving' : 'Saved'}</span>
          <span className={`note__dot ${doc.dirty ? 'note__dot--dirty' : ''}`} />
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={favorited ? 'Remove from favourites' : 'Add to favourites'}
            title={favorited ? 'Remove from favourites' : 'Add to favourites'}
            data-on={favorited}
            onClick={() => void toggleFavorite(relPath)}
          >
            <IconStar size={13} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="More actions"
            title="More actions"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              openMenu(
                { clientX: rect.right - 220, clientY: rect.bottom + 4, preventDefault: () => {} },
                pageMenu
              )
            }}
          >
            <IconMore size={14} />
          </button>
        </div>
      </div>

      <div
        className="note__scroll"
        onContextMenu={(e) => {
          // Let the editor keep its own context menu for text selections.
          if (window.getSelection()?.toString()) return
          openMenu(e, pageMenu)
        }}
      >
        {body}
      </div>

      {hover && (
        <HoverPreview target={hover.target} rect={hover.rect} onClose={() => setHover(null)} />
      )}
      {menu && <ContextMenu state={menu} onClose={closeMenu} />}
    </div>
  )
}

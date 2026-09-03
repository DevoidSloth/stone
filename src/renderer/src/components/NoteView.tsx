import { useEffect, useMemo, useRef, useState } from 'react'
import { readFrontmatterKey, setFrontmatterKey, yamlScalar } from '@shared/frontmatter'
import { ancestorFolders, folderDefinedBy, folderName } from '@shared/folder-note'
import { useStone } from '../store'
import { Editor } from '../editor/Editor'
import { activeEditor } from '../editor/insert'
import { insertPickedFiles } from '../editor/slash'
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
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
import { CoverBand, CoverPicker, IconPicker, PageIcon } from './PageDressing'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { HoverPreview } from './SidePanels'
import { exportNoteToPdf } from '../export-note'
import { formatLongDate, relativeDay, toISODate } from '../lib/dates'
import { describeError } from '../lib/errors'
import { useResolvedDark } from '../lib/theme'

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
  const openFolderNote = useStone((s) => s.openFolderNote)
  const duplicateNote = useStone((s) => s.duplicateNote)
  const toggleFavorite = useStone((s) => s.toggleFavorite)
  const patchNoteMeta = useStone((s) => s.patchNoteMeta)
  const goBack = useStone((s) => s.goBack)
  const goForward = useStone((s) => s.goForward)
  const setQuickOpen = useStone((s) => s.setQuickOpen)
  const toast = useStone((s) => s.toast)

  const [title, setTitle] = useState('')
  const [picker, setPicker] = useState<'icon' | 'cover' | null>(null)
  const [hover, setHover] = useState<{ target: string; rect: DOMRect } | null>(null)
  /** True in a split too narrow for the folder trail to be worth its width. */
  const [narrow, setNarrow] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  // CodeMirror keys its own base theme off a boolean, not off our CSS, so the
  // resolved theme has to reach it as a value — including when `system` flips.
  const dark = useResolvedDark()

  const note = useMemo(() => notes.find((n) => n.relPath === relPath) ?? null, [notes, relPath])

  useEffect(() => {
    setTitle(basename(relPath))
    setPicker(null)
    setHover(null)
  }, [relPath])

  /*
   * Below this the folder trail shrinks to a row of two-pixel stubs, which is
   * worse than not being there — so it isn't. The file's own name, the status,
   * and the picker all survive at any width, and the picker is the way back to
   * anywhere the trail would have led.
   */
  useEffect(() => {
    const el = headRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 560))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
  /** Enclosing folders, outermost first. A folder note skips the folder it defines. */
  const crumbs = ancestorFolders(relPath)
  const defines = folderDefinedBy(relPath)
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

  /**
   * Icon and cover live in frontmatter, so both are one surgical line edit.
   * The value is quoted on the way in: an icon of `7` or `#` is text here, but
   * bare YAML would hand the indexer a number, or a comment, or nothing.
   */
  const setKey = (key: 'icon' | 'cover', value: string | null): void => {
    setDoc(relPath, setFrontmatterKey(doc.content, key, value === null ? null : yamlScalar(value)))
    // Patch the sidebar's copy too, so the tree row updates in the same frame.
    patchNoteMeta(relPath, key === 'icon' ? { icon: value } : { cover: value })
  }

  // PDF goes through `exportNoteToPdf`, which also flushes unsaved edits; this
  // covers the two formats that do not need the print window.
  const exportAs = async (kind: 'markdown' | 'html'): Promise<void> => {
    try {
      const saved = await window.stone.exporter[kind](relPath)
      if (!saved) return
      toast(`Exported to ${saved}.`, 'success')
      void window.stone.exporter.reveal(saved)
    } catch (err) {
      toast(describeError(err), 'error')
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
      label: 'Embed an image or a PDF…',
      icon: <IconImage size={13} />,
      run: () => {
        // Through the editor when there is one, so it lands at the caret and
        // can be undone. Appending to the end is the fallback for a note that
        // is open but not focused, where there is no caret to land at.
        const view = activeEditor()
        if (view) {
          void insertPickedFiles(view)
          return
        }
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
        { id: 'export-pdf', label: 'PDF', run: () => void exportNoteToPdf(relPath) }
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
      separated: true,
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
              <PageIcon icon={icon} />
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
              current={icon}
              onPick={(next) => {
                setKey('icon', next)
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
            spellCheck={settings?.spellcheck ?? true}
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
          dark={dark}
          fontSize={settings?.editorFontSize ?? 16}
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
      <div className="note__head" ref={headRef}>
        <div className="note__nav">
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Back"
            data-tip="Back"
            onClick={goBack}
          >
            <IconArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Forward"
            data-tip="Forward"
            onClick={goForward}
          >
            <IconArrowRight size={14} />
          </button>
        </div>

        {/*
         * The trail back to each enclosing folder's note. Nothing about it is
         * stored in the file — it is read straight off the path, so it can
         * never disagree with where the note actually sits.
         *
         * It reads like an address bar, so it behaves like one: the folders are
         * links, and the row as a whole opens the go-to-file picker for *this*
         * pane, which is the fastest way to put something else in the split you
         * are looking at.
         */}
        <div
          className="note__crumbs"
          data-narrow={narrow}
          onClick={() => setQuickOpen(paneIndex)}
        >
          <IconFolder size={13} />
          {crumbs.length === 0 ? (
            <b>{defines ? 'Vault root' : folder}</b>
          ) : (
            crumbs.map((crumb) => (
              <span key={crumb} className="note__crumb">
                <button
                  type="button"
                  className="note__crumb-link truncate"
                  data-tip={`Open the folder note for ${crumb}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void openFolderNote(crumb)
                  }}
                >
                  {folderName(crumb)}
                </button>
                <span className="note__crumb-sep">/</span>
              </span>
            ))
          )}
          <button
            type="button"
            className="note__crumb-file"
            aria-label="Open another file in this pane"
            data-tip={`Open another file in this pane (${window.stone.platform === 'darwin' ? '⌘P' : 'Ctrl P'})`}
          >
            <span className="truncate">{name}</span>
            <IconChevronDown size={11} />
          </button>
          {defines && <span className="note__crumb-self">folder note</span>}
        </div>

        <div className="note__status">
          <span>{doc.dirty ? 'Saving' : 'Saved'}</span>
          <span className={`note__dot ${doc.dirty ? 'note__dot--dirty' : ''}`} />
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={favorited ? 'Remove from favourites' : 'Add to favourites'}
            data-tip={favorited ? 'Remove from favourites' : 'Add to favourites'}
            data-on={favorited}
            onClick={() => void toggleFavorite(relPath)}
          >
            <IconStar size={13} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="More actions"
            data-tip="More actions"
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
          // Text being edited gets the native menu instead: spelling
          // suggestions and a working Cut/Paste can only come from the main
          // process, and Electron raises that menu only when nothing here
          // calls preventDefault. The page menu keeps the margins, the
          // header, and the ••• button.
          if ((e.target as HTMLElement).closest('.cm-content, input, textarea')) return
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

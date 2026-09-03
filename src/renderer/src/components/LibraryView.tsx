import { useEffect, useMemo, useState } from 'react'
import type { LibraryDoc } from '@shared/types'
import { useStone } from '../store'
import { IconCloud, IconFolder, IconRefresh, IconSearch, IconX } from '../ui/icons'

/**
 * The library.
 *
 * Documents, indexed where they already live. The point is not to become a
 * document manager — it is that a paper you annotated and a note you wrote
 * about it should turn up in the same search, and that linking one to the other
 * should not mean pasting a file path.
 *
 * Rendering a PDF is Chromium's job, through the sandboxed scheme, so the
 * viewer here is an iframe and not a reimplementation of a PDF engine. Anything
 * else shows the text that was extracted, which is what makes it searchable.
 */

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Thumbnail({ doc }: { doc: LibraryDoc }) {
  return (
    <div className="libcard__cover libcard__cover--blank" aria-hidden="true">
      {doc.kind === 'pdf' ? 'PDF' : doc.kind === 'epub' ? 'EPUB' : '◻'}
    </div>
  )
}

export function LibraryView() {
  const settings = useStone((s) => s.settings)
  const toast = useStone((s) => s.toast)
  const addLibraryFolder = useStone((s) => s.addLibraryFolder)
  const removeLibraryFolder = useStone((s) => s.removeLibraryFolder)

  const [docs, setDocs] = useState<LibraryDoc[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ doc: LibraryDoc; excerpt: string }[]>([])
  const [open, setOpen] = useState<LibraryDoc | null>(null)
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const [openText, setOpenText] = useState('')
  const [scanning, setScanning] = useState(false)

  const folders = settings?.libraryFolders ?? []

  useEffect(() => {
    void window.stone.library.list().then(setDocs).catch(() => setDocs([]))
    return window.stone.library.onScanned(setDocs)
  }, [])

  // Search runs over the extracted text in main; debounced, like note search.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      void window.stone.library
        .search(trimmed)
        .then((results) => setHits(results.map((r) => ({ doc: r.doc, excerpt: r.excerpt }))))
        .catch(() => setHits([]))
    }, 120)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open) {
      setOpenUrl(null)
      setOpenText('')
      return
    }
    if (open.kind === 'pdf' && !open.evicted) {
      void window.stone.library.url(open.path).then(setOpenUrl).catch(() => setOpenUrl(null))
    } else {
      setOpenUrl(null)
    }
    void window.stone.library.text(open.id).then(setOpenText).catch(() => setOpenText(''))
  }, [open])

  const shown = useMemo(
    () => (query.trim() ? hits.map((h) => h.doc) : docs),
    [query, hits, docs]
  )

  const excerptFor = (doc: LibraryDoc): string =>
    hits.find((h) => h.doc.id === doc.id)?.excerpt ?? ''

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      setDocs(await window.stone.library.scan())
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setScanning(false)
    }
  }

  // Main saves the folder and scans it, and the scan is broadcast — so this
  // only has to pick up the resulting documents.
  const addFolder = async (mode: 'index' | 'copy'): Promise<void> => {
    if (await addLibraryFolder(mode)) setDocs(await window.stone.library.list())
  }

  if (folders.length === 0) {
    return (
      <div className="empty">
        <div className="empty__inner">
          <p className="empty__title">No document folders yet</p>
          <p className="empty__body">
            Point Stone at the folders your PDFs already live in. It reads them where they are,
            pulls out the text so they turn up in search, and never moves or rewrites anything.
          </p>
          <div className="empty__actions">
            <button type="button" className="btn btn--primary" onClick={() => void addFolder('index')}>
              <IconFolder size={13} />
              Watch a folder
            </button>
            <button type="button" className="btn" onClick={() => void addFolder('copy')}>
              Import a folder into the vault
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="library">
      <div className="library__head">
        <div className="library__search">
          <IconSearch size={14} />
          <input
            className="field"
            placeholder="Search inside your documents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <span className="library__count">
          {shown.length} {shown.length === 1 ? 'document' : 'documents'}
        </span>

        <button type="button" className="btn btn--sm" disabled={scanning} onClick={() => void scan()}>
          <IconRefresh size={12} />
          {scanning ? 'Reading…' : 'Rescan'}
        </button>

        <button type="button" className="btn btn--sm" onClick={() => void addFolder('index')}>
          <IconFolder size={12} />
          Add folder
        </button>
      </div>

      <div className="library__folders">
        {folders.map((folder) => (
          <span key={folder.id} className="tagchip" title={folder.path}>
            {folder.label}
            <em>{folder.mode === 'copy' ? 'copies in' : 'in place'}</em>
            <button
              type="button"
              aria-label={`Stop watching ${folder.label}`}
              onClick={() => {
                void removeLibraryFolder(folder.id).then(async () =>
                  setDocs(await window.stone.library.list())
                )
              }}
            >
              <IconX size={10} />
            </button>
          </span>
        ))}
      </div>

      <div className="library__body">
        <div className="library__grid">
          {shown.length === 0 && (
            <p className="panel__empty">
              {query.trim() ? 'Nothing matches inside your documents.' : 'No documents found yet.'}
            </p>
          )}

          {shown.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="libcard"
              data-active={open?.id === doc.id}
              onClick={() => setOpen(doc)}
              onDoubleClick={() => void window.stone.library.openExternally(doc.path)}
            >
              <Thumbnail doc={doc} />
              <b className="truncate">{doc.name}</b>
              <span className="libcard__meta">
                {doc.evicted ? (
                  <>
                    <IconCloud size={11} /> Not downloaded
                  </>
                ) : (
                  [
                    doc.kind.toUpperCase(),
                    doc.pageCount ? `${doc.pageCount} pages` : '',
                    formatSize(doc.size)
                  ]
                    .filter(Boolean)
                    .join(' · ')
                )}
              </span>
              {excerptFor(doc) && <span className="libcard__excerpt">…{excerptFor(doc)}…</span>}
              {!doc.hasText && !doc.evicted && (
                <span className="libcard__warn">Name only — no text could be read</span>
              )}
            </button>
          ))}
        </div>

        {open && (
          <aside className="library__viewer">
            <header className="library__viewerhead">
              <b className="truncate">{open.name}</b>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void window.stone.library.openExternally(open.path)}
              >
                Open in default app
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void window.stone.library.reveal(open.path)}
              >
                Reveal
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label="Close"
                onClick={() => setOpen(null)}
              >
                <IconX size={13} />
              </button>
            </header>

            {open.warning && <p className="library__warning">{open.warning}</p>}

            {openUrl ? (
              // Chromium's own PDF viewer, over the scheme that is fenced to the
              // watched folders. No PDF engine of our own, and no file:// URL.
              <iframe className="library__frame" src={openUrl} title={open.name} />
            ) : (
              <div className="library__text">
                <p className="hint">
                  There is nothing here that can draw this one. This is the text Stone read out of
                  it, which is what makes it searchable.
                </p>
                {openText ? <pre>{openText.slice(0, 20000)}</pre> : <p className="hint">No text.</p>}
              </div>
            )}

            <footer className="library__cite">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  void navigator.clipboard.writeText(`[${open.name}](file://${open.path})`)
                  toast('Markdown link copied.', 'success')
                }}
              >
                Copy a link to this
              </button>
            </footer>
          </aside>
        )}
      </div>
    </div>
  )
}

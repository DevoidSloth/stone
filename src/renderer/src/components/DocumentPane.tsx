import { useEffect, useMemo, useState } from 'react'
import type { LibraryDoc } from '@shared/types'
import { useStone } from '../store'
import { PdfViewer } from './PdfViewer'
import { IconChevronDown, IconCloud, IconLink, IconRefresh, IconSearch } from '../ui/icons'
import { describeError } from '../lib/errors'

/**
 * A document, open in a pane like any note.
 *
 * PDFs render over the `stone-file://` scheme, through pdf.js in the pane —
 * Stone does not implement a PDF engine, it drives one that already ships with
 * the app. Anything else in a watched folder is still listed, searchable and
 * linkable; it just has nothing here that can draw it.
 */
export function DocumentPane({ absPath, paneIndex }: { absPath: string; paneIndex: number }) {
  const documents = useStone((s) => s.documents)
  const notes = useStone((s) => s.notes)
  const openNote = useStone((s) => s.openNote)
  const toast = useStone((s) => s.toast)
  const splitPane = useStone((s) => s.splitPane)
  const setQuickOpen = useStone((s) => s.setQuickOpen)

  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [showText, setShowText] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const doc: LibraryDoc | undefined = useMemo(
    () => documents.find((d) => d.path === absPath),
    [documents, absPath]
  )

  useEffect(() => {
    if (!doc || doc.evicted) {
      setUrl(null)
      return
    }
    let alive = true
    void window.stone.library
      .renderUrl(doc.id)
      .then((next) => {
        if (alive) setUrl(next)
      })
      .catch(() => setUrl(null))
    return () => {
      alive = false
    }
  }, [doc])

  useEffect(() => {
    if (!doc) return
    void window.stone.library
      .text(doc.id)
      .then(setText)
      .catch(() => setText(''))
  }, [doc])

  /** Notes that link to this document by name — the other half of `[[…]]`. */
  const linkedFrom = useMemo(() => {
    if (!doc) return []
    const needle = `[[${doc.name.toLowerCase()}`
    return notes.filter((n) => n.links.some((l) => `[[${l.toLowerCase()}`.startsWith(needle)))
  }, [notes, doc])

  if (!doc) {
    return (
      <div className="empty">
        <div className="empty__inner">
          <p className="empty__title">Document not found</p>
          <p className="empty__body">
            It is no longer in a watched folder. <span className="mono">{absPath}</span>
          </p>
        </div>
      </div>
    )
  }

  const download = async (): Promise<void> => {
    setDownloading(true)
    try {
      const next = await window.stone.library.download(doc.path)
      useStone.setState({ documents: next })
      toast(`${doc.name} downloaded.`, 'success')
    } catch (err) {
      toast(describeError(err), 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="docpane">
      <header className="docpane__head">
        {/* The same path bar a note has: click it to put something else here. */}
        <button
          type="button"
          className="docpane__name truncate"
          data-tip={`Open another file in this pane (${window.stone.platform === 'darwin' ? '⌘P' : 'Ctrl P'})`}
          onClick={() => setQuickOpen(paneIndex)}
        >
          <b className="truncate">{doc.name}</b>
          <IconChevronDown size={11} />
        </button>
        <span className="docpane__meta">
          {[doc.kind.toUpperCase(), doc.pageCount ? `${doc.pageCount} pages` : '']
            .filter(Boolean)
            .join(' · ')}
        </span>

        <div className="docpane__tools">
          {text && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-pressed={showText}
              data-tip="Show the text Stone extracted, which is what search matches on"
              onClick={() => setShowText((v) => !v)}
            >
              <IconSearch size={12} /> Text
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-tip="Open beside this, to write about it"
            onClick={() => splitPane()}
          >
            Split
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              void navigator.clipboard.writeText(`[[${doc.name}]]`)
              toast('Wikilink copied. Paste it in any note.', 'success')
            }}
          >
            <IconLink size={12} /> Link
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void window.stone.library.openExternally(doc.path)}
          >
            Open in default app
          </button>
        </div>
      </header>

      {doc.evicted ? (
        <div className="empty">
          <div className="empty__inner">
            <p className="empty__title">
              <IconCloud size={16} /> Not downloaded
            </p>
            <p className="empty__body">
              This file lives in iCloud and its contents are not on this Mac. Stone does not fetch
              it during a scan, because that would stall on every evicted file in the folder.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              disabled={downloading}
              onClick={() => void download()}
            >
              <IconRefresh size={13} />
              {downloading ? 'Downloading…' : 'Download it now'}
            </button>
          </div>
        </div>
      ) : showText ? (
        <div className="docpane__text">
          <pre>{text.slice(0, 60000)}</pre>
        </div>
      ) : url ? (
        <PdfViewer doc={doc} url={url} />
      ) : (
        <div className="empty">
          <div className="empty__inner">
            <p className="empty__title">Nothing to render</p>
            <p className="empty__body">
              {doc.warning ??
                'Stone found no pages inside this document. It is still searchable by name.'}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => void window.stone.library.openExternally(doc.path)}
            >
              Open in default app
            </button>
          </div>
        </div>
      )}

      {linkedFrom.length > 0 && (
        <footer className="docpane__links">
          <span className="eyebrow">Linked from</span>
          {linkedFrom.slice(0, 6).map((note) => (
            <button
              key={note.relPath}
              type="button"
              className="docpane__link"
              onClick={() => void openNote(note.relPath)}
            >
              {note.title}
            </button>
          ))}
        </footer>
      )}
    </div>
  )
}

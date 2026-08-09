import { useStone } from '../store'
import { NoteView } from './NoteView'
import { IconPlus, IconSplit, IconX } from '../ui/icons'

/**
 * Tabs and split panes.
 *
 * Up to three panes side by side, each with its own tab strip and its own
 * back/forward stack. Buffers are shared: the same note open twice is one
 * document, so an edit in the left pane appears in the right one immediately
 * rather than racing it to disk.
 */

function basename(relPath: string): string {
  return relPath.split('/').pop()!.replace(/\.md$/, '')
}

function TabStrip({ paneIndex }: { paneIndex: number }) {
  const pane = useStone((s) => s.panes[paneIndex])
  const panes = useStone((s) => s.panes)
  const activePane = useStone((s) => s.activePane)
  const docs = useStone((s) => s.docs)
  const focusTab = useStone((s) => s.focusTab)
  const closeTab = useStone((s) => s.closeTab)
  const closePane = useStone((s) => s.closePane)
  const splitPane = useStone((s) => s.splitPane)
  const createNote = useStone((s) => s.createNote)

  if (!pane) return null

  return (
    <div className="tabstrip" data-active={paneIndex === activePane}>
      <div className="tabstrip__tabs">
        {pane.tabs.map((tab, index) => (
          <div
            key={tab.id}
            className="tab"
            aria-selected={index === pane.active}
            onMouseDown={(e) => {
              // Middle-click closes, the way it does everywhere else.
              if (e.button === 1) {
                e.preventDefault()
                closeTab(paneIndex, tab.id)
              }
            }}
          >
            <button
              type="button"
              className="tab__label truncate"
              onClick={() => focusTab(paneIndex, index)}
              title={tab.relPath}
            >
              {docs[tab.relPath]?.dirty && <span className="tab__dot" />}
              {basename(tab.relPath)}
            </button>
            <button
              type="button"
              className="tab__close"
              aria-label={`Close ${basename(tab.relPath)}`}
              onClick={() => closeTab(paneIndex, tab.id)}
            >
              <IconX size={11} />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="tabstrip__new"
          aria-label="New note in a new tab"
          title="New note in a new tab"
          onClick={() => void createNote('Untitled', undefined, { pane: paneIndex, newTab: true })}
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div className="tabstrip__tools">
        {panes.length < 3 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Split the editor"
            title="Split the editor"
            onClick={splitPane}
          >
            <IconSplit size={14} />
          </button>
        )}
        {panes.length > 1 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Close this pane"
            title="Close this pane"
            onClick={() => closePane(paneIndex)}
          >
            <IconX size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

export function Panes() {
  const panes = useStone((s) => s.panes)
  const activePane = useStone((s) => s.activePane)
  const focusPane = useStone((s) => s.focusPane)
  const createNote = useStone((s) => s.createNote)
  const setPalette = useStone((s) => s.setPalette)

  return (
    <div className="panes">
      {panes.map((pane, index) => {
        const tab = pane.tabs[pane.active]
        return (
          <div
            key={pane.id}
            className="panes__pane"
            data-active={index === activePane}
            onMouseDown={() => index !== activePane && focusPane(index)}
          >
            {pane.tabs.length > 0 && <TabStrip paneIndex={index} />}

            {tab ? (
              <NoteView relPath={tab.relPath} paneIndex={index} />
            ) : (
              <div className="empty">
                <div className="empty__inner">
                  <p className="empty__title">Nothing open</p>
                  <p className="empty__body">
                    Pick a note on the left, press{' '}
                    <span className="mono">
                      {window.stone.platform === 'darwin' ? '⌘K' : 'Ctrl K'}
                    </span>{' '}
                    to search, or start something new.
                  </p>
                  <div className="empty__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void createNote('Untitled')}
                    >
                      <IconPlus size={13} />
                      New note
                    </button>
                    <button type="button" className="btn" onClick={() => setPalette(true)}>
                      Search
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

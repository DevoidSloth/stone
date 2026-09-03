import { Fragment, useRef, useState, type DragEvent, type PointerEvent, type RefObject } from 'react'
import { MAX_PANES, docPathOf, isDocTarget, useStone } from '../store'
import { NoteView } from './NoteView'
import { DocumentPane } from './DocumentPane'
import { IconGrip, IconPlus, IconSplit, IconX } from '../ui/icons'

/**
 * Tabs and split panes.
 *
 * Up to three panes side by side, each with its own tab strip and its own
 * back/forward stack. Buffers are shared: the same note open twice is one
 * document, so an edit in the left pane appears in the right one immediately
 * rather than racing it to disk.
 *
 * The layout is built by hand rather than dragged out of a menu. A tab can be
 * pulled anywhere — another strip, a slot in this one, or the edge of a pane,
 * which tears it out into a split of its own — and a whole split can be picked
 * up by its grip and dropped somewhere else in the row, or dropped onto
 * another split to fold the two together. Dividers drag to resize.
 */

/** A tab's label, for a note or a document alike. */
function basename(target: string): string {
  const path = isDocTarget(target) ? docPathOf(target) : target
  return path.split('/').pop()!.replace(/\.(md|pdf|epub)$/i, '')
}

/** Where a drop would land, as a fraction of the pane's width. */
type Zone = 'left' | 'center' | 'right'

const EDGE = 0.28

function zoneAt(event: DragEvent<HTMLElement>): Zone {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / (rect.width || 1)
  if (x < EDGE) return 'left'
  if (x > 1 - EDGE) return 'right'
  return 'center'
}

/**
 * The drop surface over a pane's body, alive only while something is being
 * dragged. The edges make a new split at this column; the middle drops into
 * the pane that is already there.
 */
function DropZones({ paneIndex }: { paneIndex: number }) {
  const drag = useStone((s) => s.paneDrag)
  const panes = useStone((s) => s.panes)
  const moveTab = useStone((s) => s.moveTab)
  const tabToNewPane = useStone((s) => s.tabToNewPane)
  const movePane = useStone((s) => s.movePane)
  const mergePane = useStone((s) => s.mergePane)
  const setPaneDrag = useStone((s) => s.setPaneDrag)

  const [zone, setZone] = useState<Zone | null>(null)

  // A pane dragged onto itself has nowhere to go, so it gets no target at all.
  if (!drag || (drag.kind === 'pane' && drag.pane === paneIndex)) return null

  /*
   * Splitting is off when it would need a fourth column. A tab that is the last
   * one in its pane is exempt: the pane it leaves closes behind it, so the row
   * ends up exactly as wide as it started.
   */
  const lastOfItsPane = drag.kind === 'tab' && (panes[drag.pane]?.tabs.length ?? 0) <= 1
  const canSplit = drag.kind === 'pane' || panes.length < MAX_PANES || lastOfItsPane

  const resolve = (event: DragEvent<HTMLElement>): Zone => {
    const next = zoneAt(event)
    return next !== 'center' && !canSplit ? 'center' : next
  }

  const drop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const where = resolve(event)
    setZone(null)
    setPaneDrag(null)

    if (drag.kind === 'pane') {
      if (where === 'center') mergePane(drag.pane, paneIndex)
      else movePane(drag.pane, where === 'left' ? paneIndex : paneIndex + 1)
      return
    }

    const from = { pane: drag.pane, tabId: drag.tabId }
    if (where === 'center') {
      moveTab(from, { pane: paneIndex, index: panes[paneIndex]?.tabs.length ?? 0 })
    } else {
      tabToNewPane(from, where === 'left' ? paneIndex : paneIndex + 1)
    }
  }

  return (
    <div
      className="panedrop"
      data-zone={zone ?? undefined}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setZone(resolve(event))
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setZone(null)
      }}
      onDrop={drop}
    >
      {zone && <div className="panedrop__hint" data-zone={zone} />}
    </div>
  )
}

function TabStrip({ paneIndex }: { paneIndex: number }) {
  const pane = useStone((s) => s.panes[paneIndex])
  const panes = useStone((s) => s.panes)
  const activePane = useStone((s) => s.activePane)
  const docs = useStone((s) => s.docs)
  const drag = useStone((s) => s.paneDrag)
  const focusTab = useStone((s) => s.focusTab)
  const closeTab = useStone((s) => s.closeTab)
  const closePane = useStone((s) => s.closePane)
  const splitPane = useStone((s) => s.splitPane)
  const moveTab = useStone((s) => s.moveTab)
  const setPaneDrag = useStone((s) => s.setPaneDrag)
  const createNote = useStone((s) => s.createNote)

  const [slot, setSlot] = useState<number | null>(null)

  if (!pane) return null

  /** The gap the pointer is nearest, counted in tabs from the left. */
  const slotAt = (event: DragEvent<HTMLDivElement>): number => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-tab]'))
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect()
      if (event.clientX < rect.left + rect.width / 2) return i
    }
    return tabs.length
  }

  const marker = (index: number) =>
    slot === index ? <span key={`slot-${index}`} className="tabstrip__slot" /> : null

  return (
    <div className="tabstrip" data-active={paneIndex === activePane}>
      <div
        className="tabstrip__tabs"
        onDragOver={(event) => {
          if (drag?.kind !== 'tab') return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setSlot(slotAt(event))
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setSlot(null)
        }}
        onDrop={(event) => {
          if (drag?.kind !== 'tab') return
          event.preventDefault()
          const index = slotAt(event)
          setSlot(null)
          setPaneDrag(null)
          moveTab({ pane: drag.pane, tabId: drag.tabId }, { pane: paneIndex, index })
        }}
      >
        {pane.tabs.map((tab, index) => (
          <Fragment key={tab.id}>
            {marker(index)}
            <div
              className="tab"
              data-tab
              draggable
              data-dragging={drag?.kind === 'tab' && drag.tabId === tab.id}
              aria-selected={index === pane.active}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                // Chromium wants *something* on the transfer or the drag never
                // starts; the payload everything reads is in the store.
                event.dataTransfer.setData('text/plain', tab.relPath)
                setPaneDrag({ kind: 'tab', pane: paneIndex, tabId: tab.id, relPath: tab.relPath })
              }}
              onDragEnd={() => {
                setPaneDrag(null)
                setSlot(null)
              }}
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
          </Fragment>
        ))}
        {marker(pane.tabs.length)}

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
        {panes.length > 1 && (
          <div
            className="tabstrip__grip"
            draggable
            role="button"
            tabIndex={-1}
            aria-label="Drag to move this split"
            title="Drag to move this split"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', pane.id)
              setPaneDrag({ kind: 'pane', pane: paneIndex })
            }}
            onDragEnd={() => setPaneDrag(null)}
          >
            <IconGrip size={13} />
          </div>
        )}
        {panes.length < MAX_PANES && (
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

/**
 * The seam between two panes. Dragging it trades width between exactly those
 * two, so the panes further along never move under the pointer; double-click
 * evens the whole row out again.
 */
function Divider({ index, row }: { index: number; row: RefObject<HTMLDivElement | null> }) {
  const setPaneSizes = useStone((s) => s.setPaneSizes)

  const grab = (event: PointerEvent<HTMLDivElement>): void => {
    const el = row.current
    if (!el || event.button !== 0) return
    event.preventDefault()

    const startX = event.clientX
    const sizes = useStone.getState().panes.map((pane) => pane.size)
    const total = sizes.reduce((sum, n) => sum + n, 0)
    const pair = sizes[index - 1] + sizes[index]
    // One weight unit is what a pane of weight 1 gets, so pixels convert cleanly.
    const unit = el.clientWidth / (total || 1)
    /** Narrower than this and a pane is thinner than the text it holds. */
    const min = Math.min(0.35, pair / 2)

    const move = (e: globalThis.PointerEvent): void => {
      const left = Math.max(min, Math.min(pair - min, sizes[index - 1] + (e.clientX - startX) / unit))
      const next = [...sizes]
      next[index - 1] = left
      next[index] = pair - left
      setPaneSizes(next)
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('is-resizing')
    }

    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div
      className="panes__divider"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to even them out"
      onPointerDown={grab}
      onDoubleClick={() => setPaneSizes(useStone.getState().panes.map(() => 1))}
    />
  )
}

export function Panes() {
  const panes = useStone((s) => s.panes)
  const activePane = useStone((s) => s.activePane)
  const drag = useStone((s) => s.paneDrag)
  const focusPane = useStone((s) => s.focusPane)
  const createNote = useStone((s) => s.createNote)
  const setPalette = useStone((s) => s.setPalette)
  const row = useRef<HTMLDivElement>(null)

  return (
    <div className="panes" ref={row} data-dragging={drag?.kind ?? undefined}>
      {panes.map((pane, index) => {
        const tab = pane.tabs[pane.active]
        return (
          <Fragment key={pane.id}>
            {index > 0 && <Divider index={index} row={row} />}
            <div
              className="panes__pane"
              style={{ flexGrow: pane.size, flexBasis: 0 }}
              data-active={index === activePane}
              data-lifted={drag?.kind === 'pane' && drag.pane === index}
              onMouseDown={() => index !== activePane && focusPane(index)}
            >
              {pane.tabs.length > 0 && <TabStrip paneIndex={index} />}

              <div className="panes__body">
                {tab ? (
                  isDocTarget(tab.relPath) ? (
                    <DocumentPane absPath={docPathOf(tab.relPath)} paneIndex={index} />
                  ) : (
                    <NoteView relPath={tab.relPath} paneIndex={index} />
                  )
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

                <DropZones paneIndex={index} />
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasData, CanvasEdge, CanvasFile, CanvasNode, CanvasSide } from '@shared/types'
import { useStone } from '../store'
import { IconNote, IconPlus, IconTrash, IconX } from '../ui/icons'

/**
 * The canvas.
 *
 * Notes and the calendar are both linear — one after another, or one day after
 * another. This is the surface for the thinking that is not: the shape of an
 * argument, how five notes relate, a plan laid out in space rather than in
 * order. It is the one place in Stone where position carries meaning.
 *
 * Nodes are DOM rather than a drawn canvas, unlike the graph screen. The graph
 * draws hundreds of identical dots and never needs to edit one, so a 2D context
 * wins; here every node is a card with text you type into and links you click,
 * and rebuilding text editing and hit-testing on top of a bitmap to save a few
 * hundred elements would be a bad trade. Edges are SVG underneath, because they
 * are the one thing DOM cannot draw well.
 *
 * The file is JSON Canvas, so a board made here opens in Obsidian and vice
 * versa. Anything in the file this editor does not understand — an unknown node
 * type, a colour it does not offer — is carried through a save untouched rather
 * than dropped.
 */

const GRID = 20
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

/** JSON Canvas presets. Index is what the format stores; the hex is ours. */
const PRESET_COLORS: Record<string, string> = {
  '1': '#ee6b6b',
  '2': '#e0a94a',
  '3': '#e3cf4a',
  '4': '#45c79a',
  '5': '#4fa8d8',
  '6': '#b07ce0'
}

function colorOf(node: CanvasNode | CanvasEdge): string | undefined {
  if (!node.color) return undefined
  return PRESET_COLORS[node.color] ?? node.color
}

const uid = (): string => Math.random().toString(36).slice(2, 10)

/** The point an edge leaves a node from, given the side it is anchored to. */
function anchor(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

/**
 * Pick the pair of sides that gives the shortest, least-crossing edge.
 *
 * Storing an explicit side per end is part of the format, but most edges are
 * created by dragging and never adjusted, so guessing well matters more than
 * the stored value does.
 */
function bestSides(a: CanvasNode, b: CanvasNode): { from: CanvasSide; to: CanvasSide } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2)
  const dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' }
  }
  return dy > 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' }
}

/** A cubic curve that leaves each end perpendicular to its side. */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }, fromSide: CanvasSide, toSide: CanvasSide): string {
  const reach = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.4)
  const out = (side: CanvasSide, p: { x: number; y: number }, sign: number): { x: number; y: number } => {
    if (side === 'left') return { x: p.x - reach * sign, y: p.y }
    if (side === 'right') return { x: p.x + reach * sign, y: p.y }
    if (side === 'top') return { x: p.x, y: p.y - reach * sign }
    return { x: p.x, y: p.y + reach * sign }
  }
  const c1 = out(fromSide, from, 1)
  const c2 = out(toSide, to, 1)
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
}

const SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left']

export function CanvasView() {
  const notes = useStone((s) => s.notes)
  const openNote = useStone((s) => s.openNote)
  const toast = useStone((s) => s.toast)

  const [files, setFiles] = useState<CanvasFile[]>([])
  const [relPath, setRelPath] = useState<string | null>(null)
  const [data, setData] = useState<CanvasData>({ nodes: [], edges: [] })
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  /** Pointer gesture in flight, in canvas coordinates. */
  const drag = useRef<
    | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
    | { kind: 'move'; ids: string[]; startX: number; startY: number; origins: Map<string, { x: number; y: number }> }
    | { kind: 'resize'; id: string; startX: number; startY: number; w: number; h: number }
    | { kind: 'connect'; from: string; side: CanvasSide; x: number; y: number }
    | null
  >(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  // ------------------------------------------------------------ file access

  useEffect(() => {
    void window.stone.canvas
      .list()
      .then((list) => {
        setFiles(list)
        setRelPath((current) => current ?? list[0]?.relPath ?? null)
      })
      .catch(() => setFiles([]))
  }, [])

  useEffect(() => {
    if (!relPath) return
    void window.stone.canvas
      .read(relPath)
      .then((next) => {
        setData(next)
        setSelected([])
        dirty.current = false
      })
      .catch((err: Error) => toast(err.message, 'error'))
  }, [relPath, toast])

  const save = useCallback(
    (next: CanvasData) => {
      setData(next)
      dirty.current = true
      if (!relPath) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // Dragging a node fires continuously; writing on every frame would put
      // hundreds of files a second through a sync client.
      saveTimer.current = setTimeout(() => {
        void window.stone.canvas.write(relPath, next).catch((err: Error) => toast(err.message, 'error'))
        dirty.current = false
      }, 600)
    },
    [relPath, toast]
  )

  // A pending write must not be lost when the screen goes away.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  // ------------------------------------------------------------ coordinates

  const toCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const box = surfaceRef.current?.getBoundingClientRect()
      if (!box) return { x: 0, y: 0 }
      return {
        x: (clientX - box.left - view.x) / view.zoom,
        y: (clientY - box.top - view.y) / view.zoom
      }
    },
    [view]
  )

  const nodesById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])

  // ---------------------------------------------------------------- editing

  const addNode = (node: CanvasNode): void => {
    save({ ...data, nodes: [...data.nodes, node] })
    setSelected([node.id])
  }

  /** Drop new cards in the middle of what the user is actually looking at. */
  const centre = (): { x: number; y: number } => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return toCanvas(box.left + box.width / 2, box.top + box.height / 2)
  }

  const addText = (): void => {
    const { x, y } = centre()
    const node: CanvasNode = {
      id: uid(),
      type: 'text',
      text: '',
      x: Math.round((x - 125) / GRID) * GRID,
      y: Math.round((y - 40) / GRID) * GRID,
      width: 250,
      height: 100
    }
    addNode(node)
    setEditing(node.id)
  }

  const addFile = (file: string): void => {
    const { x, y } = centre()
    addNode({
      id: uid(),
      type: 'file',
      file,
      x: Math.round((x - 140) / GRID) * GRID,
      y: Math.round((y - 60) / GRID) * GRID,
      width: 280,
      height: 160
    })
    setPicking(false)
  }

  const remove = (): void => {
    if (selected.length === 0) return
    const gone = new Set(selected)
    save({
      nodes: data.nodes.filter((n) => !gone.has(n.id)),
      // An edge with a missing end is invisible but still in the file, so drop
      // any edge that touched a deleted node rather than leaving it orphaned.
      edges: data.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode))
    })
    setSelected([])
  }

  const patchNode = (id: string, patch: Partial<CanvasNode>): void => {
    save({
      ...data,
      nodes: data.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as CanvasNode) : n))
    })
  }

  const setColor = (color: string | undefined): void => {
    const chosen = new Set(selected)
    save({
      ...data,
      nodes: data.nodes.map((n) => (chosen.has(n.id) ? ({ ...n, color } as CanvasNode) : n))
    })
  }

  // --------------------------------------------------------------- pointers

  const onPointerMove = (event: React.PointerEvent): void => {
    const gesture = drag.current
    if (!gesture) return

    if (gesture.kind === 'pan') {
      setView((v) => ({
        ...v,
        x: gesture.originX + (event.clientX - gesture.startX),
        y: gesture.originY + (event.clientY - gesture.startY)
      }))
      return
    }

    const point = toCanvas(event.clientX, event.clientY)

    if (gesture.kind === 'move') {
      const dx = point.x - gesture.startX
      const dy = point.y - gesture.startY
      setData((current) => ({
        ...current,
        nodes: current.nodes.map((n) => {
          const origin = gesture.origins.get(n.id)
          if (!origin) return n
          return {
            ...n,
            // Snapped, because a board of hand-placed cards that are each two
            // pixels off reads as sloppy however carefully it was arranged.
            x: Math.round((origin.x + dx) / GRID) * GRID,
            y: Math.round((origin.y + dy) / GRID) * GRID
          }
        })
      }))
      return
    }

    if (gesture.kind === 'resize') {
      const width = Math.max(120, Math.round((gesture.w + point.x - gesture.startX) / GRID) * GRID)
      const height = Math.max(60, Math.round((gesture.h + point.y - gesture.startY) / GRID) * GRID)
      setData((current) => ({
        ...current,
        nodes: current.nodes.map((n) => (n.id === gesture.id ? { ...n, width, height } : n))
      }))
      return
    }

    if (gesture.kind === 'connect') setGhost(point)
  }

  const onPointerUp = (event: React.PointerEvent): void => {
    const gesture = drag.current
    drag.current = null
    setGhost(null)
    if (!gesture) return

    if (gesture.kind === 'move' || gesture.kind === 'resize') {
      // The gesture mutated local state directly for smoothness; persist the
      // result once, at the end, rather than debouncing every frame.
      setData((current) => {
        save(current)
        return current
      })
      return
    }

    if (gesture.kind === 'connect') {
      const target = (event.target as HTMLElement).closest('[data-node-id]')
      const toId = target?.getAttribute('data-node-id')
      if (!toId || toId === gesture.from) return
      const from = nodesById.get(gesture.from)
      const to = nodesById.get(toId)
      if (!from || !to) return
      const sides = bestSides(from, to)
      save({
        ...data,
        edges: [
          ...data.edges,
          {
            id: uid(),
            fromNode: gesture.from,
            fromSide: gesture.side,
            toNode: toId,
            toSide: sides.to
          }
        ]
      })
    }
  }

  const onWheel = (event: React.WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      return
    }
    // Zoom toward the pointer, so the thing under the cursor stays put.
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return
    const px = event.clientX - box.left
    const py = event.clientY - box.top
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * (1 - event.deltaY / 500)))
      const scale = zoom / v.zoom
      return { zoom, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale }
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (editing) return
      const el = event.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        remove()
      }
      if (event.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ----------------------------------------------------------------- render

  if (files.length === 0 && !relPath) {
    return (
      <div className="empty">
        <div className="empty__inner">
          <p className="empty__title">No canvases yet</p>
          <p className="empty__body">
            A canvas is a board you arrange yourself — notes, text, and the arrows between them.
            It saves as a <code>.canvas</code> file in your vault, in the open JSON Canvas format,
            so it opens in Obsidian too.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void window.stone.canvas.create('', 'Canvas').then(({ relPath: created }) => {
                setFiles((f) => [{ relPath: created, name: 'Canvas', mtime: Date.now() }, ...f])
                setRelPath(created)
              })
            }}
          >
            <IconPlus size={13} />
            New canvas
          </button>
        </div>
      </div>
    )
  }

  const selectedSet = new Set(selected)

  return (
    <div className="canvasview">
      <div className="canvasview__head">
        <select
          className="field"
          style={{ width: 200 }}
          value={relPath ?? ''}
          onChange={(e) => setRelPath(e.target.value)}
        >
          {files.map((file) => (
            <option key={file.relPath} value={file.relPath}>
              {file.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            void window.stone.canvas.create('', 'Canvas').then(({ relPath: created }) => {
              setFiles((f) => [{ relPath: created, name: 'Canvas', mtime: Date.now() }, ...f])
              setRelPath(created)
            })
          }}
        >
          <IconPlus size={12} /> Canvas
        </button>

        <div className="canvasview__tools">
          <button type="button" className="btn btn--sm" onClick={addText}>
            Text card
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setPicking(true)}>
            <IconNote size={12} /> Note card
          </button>

          {selected.length > 0 && (
            <>
              <div className="canvasview__swatches">
                <button
                  type="button"
                  className="swatch swatch--none"
                  aria-label="No colour"
                  onClick={() => setColor(undefined)}
                />
                {Object.entries(PRESET_COLORS).map(([key, hex]) => (
                  <button
                    key={key}
                    type="button"
                    className="swatch"
                    style={{ background: hex }}
                    aria-label={`Colour ${key}`}
                    onClick={() => setColor(key)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label="Delete selection"
                onClick={remove}
              >
                <IconTrash size={13} />
              </button>
            </>
          )}

          <span className="canvasview__zoom">{Math.round(view.zoom * 100)}%</span>
        </div>
      </div>

      <div
        className="canvasview__surface"
        ref={surfaceRef}
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('canvasview__world')) {
            return
          }
          setSelected([])
          setEditing(null)
          drag.current = {
            kind: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            originX: view.x,
            originY: view.y
          }
        }}
      >
        <div
          className="canvasview__world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            backgroundSize: `${GRID * 2}px ${GRID * 2}px`
          }}
        >
          <svg className="canvasview__edges" aria-hidden="true">
            {data.edges.map((edge) => {
              const from = nodesById.get(edge.fromNode)
              const to = nodesById.get(edge.toNode)
              if (!from || !to) return null
              const guess = bestSides(from, to)
              const fromSide = edge.fromSide ?? guess.from
              const toSide = edge.toSide ?? guess.to
              const stroke = colorOf(edge) ?? 'var(--border-strong, var(--text-ghost))'
              return (
                <g key={edge.id}>
                  <path
                    d={edgePath(anchor(from, fromSide), anchor(to, toSide), fromSide, toSide)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    markerEnd="url(#stone-arrow)"
                  />
                </g>
              )
            })}

            {ghost && drag.current?.kind === 'connect' && (
              <path
                d={edgePath(
                  anchor(nodesById.get(drag.current.from)!, drag.current.side),
                  ghost,
                  drag.current.side,
                  'left'
                )}
                fill="none"
                stroke="var(--text-ghost)"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            )}

            <defs>
              <marker
                id="stone-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-ghost)" />
              </marker>
            </defs>
          </svg>

          {data.nodes.map((node) => {
            const accent = colorOf(node)
            const note = node.type === 'file' ? notes.find((n) => n.relPath === node.file) : null

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                className={`cnode cnode--${node.type}`}
                data-selected={selectedSet.has(node.id)}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                  borderColor: accent,
                  boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined
                }}
                onPointerDown={(event) => {
                  if (editing === node.id) return
                  event.stopPropagation()
                  const additive = event.shiftKey
                  const ids = additive
                    ? [...new Set([...selected, node.id])]
                    : selectedSet.has(node.id)
                      ? selected
                      : [node.id]
                  setSelected(ids)
                  const point = toCanvas(event.clientX, event.clientY)
                  drag.current = {
                    kind: 'move',
                    ids,
                    startX: point.x,
                    startY: point.y,
                    origins: new Map(
                      data.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])
                    )
                  }
                }}
                onDoubleClick={() => {
                  if (node.type === 'text') setEditing(node.id)
                  if (node.type === 'file') void openNote(node.file)
                }}
              >
                {node.type === 'text' &&
                  (editing === node.id ? (
                    <textarea
                      className="cnode__editor"
                      autoFocus
                      defaultValue={node.text}
                      onBlur={(e) => {
                        setEditing(null)
                        patchNode(node.id, { text: e.target.value } as Partial<CanvasNode>)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') e.currentTarget.blur()
                      }}
                    />
                  ) : (
                    <div className="cnode__text">
                      {node.text || <span className="cnode__hint">Double-click to write</span>}
                    </div>
                  ))}

                {node.type === 'file' && (
                  <>
                    <div className="cnode__title truncate">
                      {note?.icon && <span>{note.icon}</span>}
                      {note?.title ?? node.file.replace(/\.md$/, '')}
                    </div>
                    <div className="cnode__excerpt">
                      {note?.excerpt ?? 'This note is no longer in the vault.'}
                    </div>
                  </>
                )}

                {node.type === 'link' && (
                  <div className="cnode__text">
                    <a href={node.url} onClick={(e) => e.preventDefault()}>
                      {node.url}
                    </a>
                  </div>
                )}

                {node.type === 'group' && <div className="cnode__title">{node.label ?? 'Group'}</div>}

                {/* Connection handles, one per side. */}
                {SIDES.map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`cnode__port cnode__port--${side}`}
                    aria-label={`Connect from the ${side}`}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      drag.current = {
                        kind: 'connect',
                        from: node.id,
                        side,
                        x: node.x,
                        y: node.y
                      }
                      setGhost(toCanvas(event.clientX, event.clientY))
                    }}
                  />
                ))}

                <span
                  className="cnode__resize"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    const point = toCanvas(event.clientX, event.clientY)
                    drag.current = {
                      kind: 'resize',
                      id: node.id,
                      startX: point.x,
                      startY: point.y,
                      w: node.width,
                      h: node.height
                    }
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>

      {picking && (
        <div className="overlay overlay--center" onMouseDown={() => setPicking(false)} role="presentation">
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Add a note to the canvas"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette__group eyebrow">
              Add a note
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label="Close"
                style={{ marginLeft: 'auto' }}
                onClick={() => setPicking(false)}
              >
                <IconX size={12} />
              </button>
            </div>
            <div className="palette__list">
              {notes.slice(0, 200).map((note) => (
                <button
                  key={note.relPath}
                  type="button"
                  className="palette__row"
                  onClick={() => addFile(note.relPath)}
                >
                  <span className="palette__icon">
                    <IconNote size={15} />
                  </span>
                  <span className="palette__label truncate">{note.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

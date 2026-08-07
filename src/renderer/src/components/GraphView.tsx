import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData } from '@shared/types'
import { useStone } from '../store'
import { IconSearch } from '../ui/icons'

/**
 * The link graph, drawn on a canvas with a small force simulation.
 *
 * No physics library: the whole thing is a few hundred lines, and pulling in
 * d3-force for one screen would roughly double the renderer bundle. Repulsion
 * uses a uniform spatial grid so cost stays near-linear instead of the O(n²)
 * every-pair comparison that makes naive versions stall past a few hundred
 * notes.
 */

interface SimNode {
  relPath: string
  title: string
  degree: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** Set while the node is being dragged, which pins it. */
  fixed: boolean
}

interface Palette {
  edge: string
  edgeActive: string
  node: string
  nodeDim: string
  nodeActive: string
  label: string
  labelDim: string
}

const CELL = 90
const REPULSION = 3400
const LINK_STRENGTH = 0.055
const LINK_DISTANCE = 62
const CENTER_PULL = 0.012
const DAMPING = 0.76
const ALPHA_DECAY = 0.987
const ALPHA_MIN = 0.0035

function readPalette(el: HTMLElement): Palette {
  const s = getComputedStyle(el)
  const v = (name: string): string => s.getPropertyValue(name).trim()
  return {
    edge: v('--border'),
    edgeActive: v('--accent'),
    node: v('--text-faint'),
    nodeDim: v('--border'),
    nodeActive: v('--accent'),
    label: v('--text-muted'),
    labelDim: v('--text-ghost')
  }
}

export function GraphView() {
  const graph = useStone((s) => s.graph)
  const loadGraph = useStone((s) => s.loadGraph)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const openNote = useStone((s) => s.openNote)

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Set by the simulation effect so the Fit button can reach it. */
  const fitRef = useRef<(() => void) | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hideOrphans, setHideOrphans] = useState(false)

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  const visible = useMemo<GraphData>(() => {
    if (!graph) return { nodes: [], edges: [] }
    const nodes = hideOrphans ? graph.nodes.filter((n) => n.degree > 0) : graph.nodes
    const keep = new Set(nodes.map((n) => n.relPath))
    return {
      nodes,
      edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    }
  }, [graph, hideOrphans])

  // Everything mutable the render loop touches lives in refs, so a re-render
  // never restarts the simulation or loses the viewport.
  const view = useRef({ zoom: 1, ox: 0, oy: 0 })
  const nodesRef = useRef<SimNode[]>([])
  const hoveredRef = useRef<string | null>(null)
  const queryRef = useRef('')
  const activeRef = useRef<string | null>(null)
  hoveredRef.current = hovered
  queryRef.current = query.trim().toLowerCase()
  activeRef.current = activeRelPath

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let palette = readPalette(host)
    let raf = 0
    let alpha = 1

    const byPath = new Map<string, SimNode>()
    const nodes: SimNode[] = visible.nodes.map((n, i) => {
      // Phyllotaxis start: an even spread, so the first ticks are not a single
      // overlapping clump that defeats the spatial grid.
      const angle = i * Math.PI * (3 - Math.sqrt(5))
      const radius = Math.sqrt(i) * 24
      const node: SimNode = {
        relPath: n.relPath,
        title: n.title,
        degree: n.degree,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        r: Math.min(3.5 + Math.sqrt(n.degree) * 2.1, 15),
        fixed: false
      }
      byPath.set(n.relPath, node)
      return node
    })
    nodesRef.current = nodes

    const links = visible.edges
      .map((e) => ({ s: byPath.get(e.source)!, t: byPath.get(e.target)! }))
      .filter((l) => l.s && l.t)

    const neighbours = new Map<string, Set<string>>()
    for (const { s, t } of links) {
      if (!neighbours.has(s.relPath)) neighbours.set(s.relPath, new Set())
      if (!neighbours.has(t.relPath)) neighbours.set(t.relPath, new Set())
      neighbours.get(s.relPath)!.add(t.relPath)
      neighbours.get(t.relPath)!.add(s.relPath)
    }

    function tick(): void {
      const grid = new Map<string, SimNode[]>()
      for (const n of nodes) {
        const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`
        const cell = grid.get(key)
        if (cell) cell.push(n)
        else grid.set(key, [n])
      }

      // Repulsion, limited to the 3x3 block of cells around each node.
      for (const n of nodes) {
        const cx = Math.floor(n.x / CELL)
        const cy = Math.floor(n.y / CELL)
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const cell = grid.get(`${gx},${gy}`)
            if (!cell) continue
            for (const m of cell) {
              if (m === n) continue
              let dx = n.x - m.x
              let dy = n.y - m.y
              let d2 = dx * dx + dy * dy
              if (d2 === 0) {
                // Perfectly coincident nodes would divide by zero; nudge apart.
                dx = (Math.random() - 0.5) * 0.1
                dy = (Math.random() - 0.5) * 0.1
                d2 = dx * dx + dy * dy
              }
              if (d2 > CELL * CELL) continue
              const force = (REPULSION / d2) * alpha
              const d = Math.sqrt(d2)
              n.vx += (dx / d) * force
              n.vy += (dy / d) * force
            }
          }
        }
      }

      for (const { s, t } of links) {
        const dx = t.x - s.x
        const dy = t.y - s.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (d - LINK_DISTANCE) * LINK_STRENGTH * alpha
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        s.vx += fx
        s.vy += fy
        t.vx -= fx
        t.vy -= fy
      }

      for (const n of nodes) {
        n.vx -= n.x * CENTER_PULL * alpha
        n.vy -= n.y * CENTER_PULL * alpha
        if (n.fixed) {
          n.vx = 0
          n.vy = 0
          continue
        }
        n.vx *= DAMPING
        n.vy *= DAMPING
        n.x += n.vx
        n.y += n.vy
      }

      alpha *= ALPHA_DECAY
    }

    function draw(): void {
      const dpr = window.devicePixelRatio || 1
      const w = host!.clientWidth
      const h = host!.clientHeight
      if (canvas!.width !== w * dpr || canvas!.height !== h * dpr) {
        canvas!.width = w * dpr
        canvas!.height = h * dpr
        canvas!.style.width = `${w}px`
        canvas!.style.height = `${h}px`
      }

      const { zoom, ox, oy } = view.current
      ctx!.setTransform(1, 0, 0, 1, 0, 0)
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx!.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 + ox), dpr * (h / 2 + oy))

      const focus = hoveredRef.current ?? activeRef.current
      const near = focus ? neighbours.get(focus) : null
      const q = queryRef.current

      const isLit = (relPath: string): boolean => {
        if (q) return relPath.toLowerCase().includes(q)
        if (!focus) return true
        return relPath === focus || Boolean(near?.has(relPath))
      }

      ctx!.lineWidth = 1 / zoom
      for (const { s, t } of links) {
        const lit = isLit(s.relPath) && isLit(t.relPath)
        const emphasised = focus && (s.relPath === focus || t.relPath === focus)
        if (!lit && (focus || q)) {
          ctx!.globalAlpha = 0.18
        } else {
          ctx!.globalAlpha = 1
        }
        ctx!.strokeStyle = emphasised ? palette.edgeActive : palette.edge
        ctx!.beginPath()
        ctx!.moveTo(s.x, s.y)
        ctx!.lineTo(t.x, t.y)
        ctx!.stroke()
      }

      for (const n of nodes) {
        const lit = isLit(n.relPath)
        ctx!.globalAlpha = lit || (!focus && !q) ? 1 : 0.2
        const isActive = n.relPath === activeRef.current
        const isHover = n.relPath === hoveredRef.current
        ctx!.fillStyle = isActive || isHover ? palette.nodeActive : n.degree ? palette.node : palette.nodeDim
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, isHover ? n.r * 1.35 : n.r, 0, Math.PI * 2)
        ctx!.fill()

        // Labels appear once there is room for them, and always for the node
        // under the pointer or the one currently open.
        const showLabel = isHover || isActive || (zoom > 0.75 && (n.degree > 0 || zoom > 1.3))
        if (showLabel) {
          ctx!.globalAlpha = lit || (!focus && !q) ? 1 : 0.25
          ctx!.fillStyle = isHover || isActive ? palette.label : palette.labelDim
          ctx!.font = `${isHover || isActive ? 600 : 400} ${12 / zoom}px Inter Variable, Inter, system-ui, sans-serif`
          ctx!.textAlign = 'center'
          ctx!.textBaseline = 'top'
          const label = n.title.length > 26 ? `${n.title.slice(0, 25)}…` : n.title
          ctx!.fillText(label, n.x, n.y + n.r + 4 / zoom)
        }
      }
      ctx!.globalAlpha = 1
    }

    let fitted = false
    function frame(): void {
      if (alpha > ALPHA_MIN) tick()
      // Frame the graph once the layout has actually cooled. A fixed timer
      // fits the initial spiral instead of the settled shape, which opens the
      // view zoomed far too far out.
      if (!fitted && alpha < 0.08) {
        fitted = true
        fit()
      }
      draw()
      raf = requestAnimationFrame(frame)
    }

    /** Fit every node into the viewport with a margin. */
    function fit(): void {
      if (!nodes.length) return
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const n of nodes) {
        minX = Math.min(minX, n.x)
        maxX = Math.max(maxX, n.x)
        minY = Math.min(minY, n.y)
        maxY = Math.max(maxY, n.y)
      }
      const w = host!.clientWidth
      const h = host!.clientHeight
      const spanX = Math.max(maxX - minX, 1)
      const spanY = Math.max(maxY - minY, 1)
      const zoom = Math.min((w - 160) / spanX, (h - 160) / spanY, 2.2)
      view.current.zoom = Math.max(zoom, 0.12)
      view.current.ox = -((minX + maxX) / 2) * view.current.zoom
      view.current.oy = -((minY + maxY) / 2) * view.current.zoom
    }
    fitRef.current = fit
    frame()

    // ------------------------------------------------------------ pointer

    const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = canvas!.getBoundingClientRect()
      const { zoom, ox, oy } = view.current
      return {
        x: (clientX - rect.left - rect.width / 2 - ox) / zoom,
        y: (clientY - rect.top - rect.height / 2 - oy) / zoom
      }
    }

    const pick = (clientX: number, clientY: number): SimNode | null => {
      const { x, y } = toWorld(clientX, clientY)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of nodes) {
        const d = Math.hypot(n.x - x, n.y - y)
        const hit = Math.max(n.r + 6, 10)
        if (d < hit && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    let dragNode: SimNode | null = null
    let panning = false
    let lastX = 0
    let lastY = 0
    let moved = false

    const onDown = (e: PointerEvent): void => {
      canvas!.setPointerCapture(e.pointerId)
      lastX = e.clientX
      lastY = e.clientY
      moved = false
      const hit = pick(e.clientX, e.clientY)
      if (hit) {
        dragNode = hit
        hit.fixed = true
      } else {
        panning = true
      }
    }

    const onMove = (e: PointerEvent): void => {
      if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2) moved = true

      if (dragNode) {
        const { x, y } = toWorld(e.clientX, e.clientY)
        dragNode.x = x
        dragNode.y = y
        alpha = Math.max(alpha, 0.35)
      } else if (panning) {
        view.current.ox += e.clientX - lastX
        view.current.oy += e.clientY - lastY
      } else {
        const hit = pick(e.clientX, e.clientY)
        const next = hit?.relPath ?? null
        if (next !== hoveredRef.current) setHovered(next)
        canvas!.style.cursor = hit ? 'pointer' : 'grab'
      }
      lastX = e.clientX
      lastY = e.clientY
    }

    const onUp = (e: PointerEvent): void => {
      canvas!.releasePointerCapture(e.pointerId)
      if (dragNode) {
        dragNode.fixed = false
        // A press without movement is a click, not a drag.
        if (!moved) void openNote(dragNode.relPath)
        dragNode = null
      }
      panning = false
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas!.getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = Math.exp(-e.deltaY * 0.0016)
      const next = Math.min(Math.max(view.current.zoom * factor, 0.1), 4)
      // Keep the point under the cursor anchored while zooming.
      view.current.ox = mx - ((mx - view.current.ox) * next) / view.current.zoom
      view.current.oy = my - ((my - view.current.oy) * next) / view.current.zoom
      view.current.zoom = next
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const observer = new ResizeObserver(() => draw())
    observer.observe(host)

    // The palette lives in CSS variables, so it has to be re-read on theme flip.
    const themeWatcher = new MutationObserver(() => {
      palette = readPalette(host)
    })
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      themeWatcher.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
    // Theme is deliberately not a dependency: the MutationObserver re-reads the
    // palette in place, so a theme flip must not restart the simulation.
  }, [visible, openNote])

  const hoveredNode = hovered ? visible.nodes.find((n) => n.relPath === hovered) : null

  return (
    <div className="graph">
      <div className="graph__head">
        <h1 className="tasks__title">Graph</h1>
        <span className="cal__year">
          {visible.nodes.length} notes · {visible.edges.length} links
        </span>
        <div className="cal__tools">
          <div className="graph__search">
            <IconSearch size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Highlight notes"
              aria-label="Highlight notes in the graph"
            />
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={hideOrphans}
            onClick={() => setHideOrphans((v) => !v)}
          >
            {hideOrphans ? 'Showing linked' : 'Show all'}
          </button>
          <button type="button" className="btn" onClick={() => fitRef.current?.()}>
            Fit
          </button>
        </div>
      </div>

      <div className="graph__canvas" ref={hostRef}>
        <canvas ref={canvasRef} />
        {visible.nodes.length === 0 && (
          <div className="empty">
            <div className="empty__inner">
              <p className="empty__title">Nothing to plot yet</p>
              <p className="empty__body">
                Link two notes with <code>[[double brackets]]</code> and they will appear here,
                joined.
              </p>
            </div>
          </div>
        )}
        {hoveredNode && (
          <div className="graph__peek">
            <b>{hoveredNode.title}</b>
            <span>
              {hoveredNode.degree} {hoveredNode.degree === 1 ? 'link' : 'links'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

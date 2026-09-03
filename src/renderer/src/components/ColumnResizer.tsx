import { useCallback } from 'react'
import { useStone } from '../store'

/**
 * The drag handle on a shell column.
 *
 * The editor panes have resized properly for a long time — a hairline with a
 * wide invisible hit strip, a body class during the drag, double-click to
 * reset. The three columns around them did not: the sidebar, the inspector and
 * the agenda were hard constants in the token sheet, which anyone with deep
 * folders or long note titles runs into in the first hour.
 *
 * This is the same interaction, applied to a single edge. `side` says which
 * edge of the column the handle sits on, which is what decides whether dragging
 * right makes the column wider or narrower.
 */

export interface ColumnResizerProps {
  /** Which shell width this drives. */
  width: number
  onResize: (width: number) => void
  /** Called at the end of a drag, for the one write to settings. */
  onCommit?: (width: number) => void
  min: number
  max: number
  /** The edge the handle sits on: a left-hand column has its handle on the right. */
  side: 'left' | 'right'
  reset: number
  label: string
}

export function ColumnResizer({
  width,
  onResize,
  onCommit,
  min,
  max,
  side,
  reset,
  label
}: ColumnResizerProps) {
  const grab = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      // A handle on the left edge of a right-hand column grows it as the
      // pointer moves left, which is the opposite sign.
      const direction = side === 'right' ? 1 : -1
      let latest = startWidth

      const move = (e: PointerEvent): void => {
        latest = Math.round(
          Math.max(min, Math.min(max, startWidth + (e.clientX - startX) * direction))
        )
        onResize(latest)
      }
      const stop = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        document.body.classList.remove('is-resizing')
        onCommit?.(latest)
      }

      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
    },
    [width, min, max, side, onResize, onCommit]
  )

  // Arrow keys move it too, in the steps a keyboard user would expect. A
  // divider that only answers to a pointer is a control half the users cannot
  // reach at all.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const step = event.shiftKey ? 32 : 8
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = width - step
    else if (event.key === 'ArrowRight') next = width + step
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else if (event.key === 'Enter') next = reset
    if (next === null) return
    event.preventDefault()
    const clamped = Math.round(Math.max(min, Math.min(max, next)))
    onResize(clamped)
    onCommit?.(clamped)
  }

  return (
    <div
      className="colresizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={grab}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onResize(reset)
        onCommit?.(reset)
      }}
    />
  )
}

/** The three shell widths, with the bounds each is clamped to. */
export const COLUMN_BOUNDS = {
  sidebar: { min: 180, max: 480, reset: 240 },
  inspector: { min: 220, max: 520, reset: 300 },
  agenda: { min: 220, max: 520, reset: 300 }
} as const

/** Push a live width to CSS during a drag, without a settings write per frame. */
export function applyColumnWidth(name: keyof typeof COLUMN_BOUNDS, px: number): void {
  const prop = name === 'sidebar' ? '--sidebar-w' : name === 'agenda' ? '--agenda-w' : '--inspector-w'
  document.documentElement.style.setProperty(prop, `${px}px`)
}

/** Restore the saved widths on boot. */
export function applyColumnWidths(widths: {
  sidebarWidth: number
  inspectorWidth: number
  agendaWidth: number
}): void {
  applyColumnWidth('sidebar', widths.sidebarWidth)
  applyColumnWidth('inspector', widths.inspectorWidth)
  applyColumnWidth('agenda', widths.agendaWidth)
}

/** Small helper so each column's handle is three lines at the call site. */
export function useColumnResizer(name: keyof typeof COLUMN_BOUNDS, label: string) {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const key = `${name}Width` as const
  const width = (settings?.[key] as number | undefined) ?? COLUMN_BOUNDS[name].reset

  return {
    ...COLUMN_BOUNDS[name],
    label,
    width,
    onResize: (px: number) => applyColumnWidth(name, px),
    onCommit: (px: number) => void updateSettings({ [key]: px })
  }
}

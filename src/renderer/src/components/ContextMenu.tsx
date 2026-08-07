import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A right-click menu.
 *
 * Rendered at the pointer and then nudged back on screen after measuring, which
 * is the only way to keep a menu opened near the bottom-right corner from being
 * clipped — its height is not known until it exists.
 */

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** A submenu of choices, e.g. which folder to move to. */
  children?: MenuItem[]
  run?: () => void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state.x, y: state.y })
  const [submenu, setSubmenu] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = menu.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({
      x: Math.min(state.x, window.innerWidth - rect.width - 8),
      y: Math.min(state.y, window.innerHeight - rect.height - 8)
    })
  }, [state.x, state.y, state.items])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="ctx__scrim" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menu}
        className="ctx"
        style={{ left: position.x, top: position.y }}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.items.map((item) =>
          item.children ? (
            <div
              key={item.id}
              className="ctx__item ctx__item--parent"
              role="menuitem"
              onMouseEnter={() => setSubmenu(item.id)}
              onMouseLeave={() => setSubmenu(null)}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              <span className="ctx__arrow">›</span>

              {submenu === item.id && (
                <div className="ctx ctx--sub" role="menu">
                  {item.children.length === 0 && (
                    <div className="ctx__empty">Nothing to choose</div>
                  )}
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className="ctx__item"
                      role="menuitem"
                      disabled={child.disabled}
                      onClick={() => {
                        child.run?.()
                        onClose()
                      }}
                    >
                      <span className="truncate">{child.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              key={item.id}
              type="button"
              className={`ctx__item ${item.danger ? 'ctx__item--danger' : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.run?.()
                onClose()
              }}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  )
}

/** Hook that owns menu state, so a caller only has to say what to show. */
export function useContextMenu(): {
  menu: MenuState | null
  open: (event: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void
  close: () => void
} {
  const [menu, setMenu] = useState<MenuState | null>(null)
  return {
    menu,
    open: (event, items) => {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, items })
    },
    close: () => setMenu(null)
  }
}

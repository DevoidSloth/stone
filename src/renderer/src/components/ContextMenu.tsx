import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { formatChord } from '../lib/keys'

/**
 * A right-click menu.
 *
 * Rendered at the pointer and then nudged back on screen after measuring, which
 * is the only way to keep a menu opened near the bottom-right corner from being
 * clipped — its height is not known until it exists. Submenus get the same
 * treatment: they used to open rightward unconditionally, so "Move to folder"
 * off a right-click near the right edge opened off-window.
 *
 * It is operable from the keyboard. `role="menu"` was already declared, which
 * is a promise of arrow-key movement, and the menu did not keep it: focus never
 * entered, so the items were not reachable at all.
 */

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** A rule above this item. Destructive actions want one; colour alone is weak. */
  separated?: boolean
  /** A chord like `Mod+Backspace`, shown right-aligned the way menus do. */
  keys?: string
  /** A submenu of choices, e.g. which folder to move to. */
  children?: MenuItem[]
  run?: () => void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

const isActionable = (item: MenuItem): boolean => !item.disabled

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: state.x, y: state.y })
  const [submenu, setSubmenu] = useState<string | null>(null)
  const [flip, setFlip] = useState(false)
  const [active, setActive] = useState(() => state.items.findIndex(isActionable))

  // Where focus came from, so closing the menu puts it back rather than
  // dropping the user at the top of the document.
  const restoreTo = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  )

  useLayoutEffect(() => {
    const el = menu.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({
      x: Math.min(state.x, window.innerWidth - rect.width - 8),
      y: Math.min(state.y, window.innerHeight - rect.height - 8)
    })
    // A submenu opens to the right at full menu width; if that would not fit,
    // it opens to the left instead.
    setFlip(state.x + rect.width * 2 + 16 > window.innerWidth)
  }, [state.x, state.y, state.items])

  // Move focus in, so the arrow keys have somewhere to move from.
  useEffect(() => {
    menu.current?.focus()
    const previous = restoreTo.current
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const close = (): void => {
    setSubmenu(null)
    onClose()
  }

  const step = (delta: number): void => {
    const items = state.items
    if (items.length === 0) return
    let next = active
    for (let i = 0; i < items.length; i++) {
      next = (next + delta + items.length) % items.length
      if (isActionable(items[next])) break
    }
    setActive(next)
    setSubmenu(null)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const item = state.items[active]
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        if (submenu) setSubmenu(null)
        else close()
        return
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        return
      case 'Home':
        event.preventDefault()
        setActive(state.items.findIndex(isActionable))
        return
      case 'End':
        event.preventDefault()
        setActive(state.items.map(isActionable).lastIndexOf(true))
        return
      case 'ArrowRight':
        if (item?.children) {
          event.preventDefault()
          setSubmenu(item.id)
        }
        return
      case 'ArrowLeft':
        if (submenu) {
          event.preventDefault()
          setSubmenu(null)
        }
        return
      case 'Enter':
      case ' ':
        if (!item || item.disabled) return
        event.preventDefault()
        if (item.children) setSubmenu(item.id)
        else {
          item.run?.()
          close()
        }
        return
      default:
        return
    }
  }

  return (
    <div className="ctx__scrim" onMouseDown={close} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menu}
        className="ctx"
        style={{ left: position.x, top: position.y }}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.items.map((item, index) =>
          item.children ? (
            <div
              key={item.id}
              className="ctx__item ctx__item--parent"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu === item.id}
              aria-disabled={item.disabled || undefined}
              data-active={index === active}
              data-separated={item.separated || undefined}
              onMouseEnter={() => {
                setActive(index)
                setSubmenu(item.id)
              }}
              onMouseLeave={() => setSubmenu(null)}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              <span className="ctx__arrow" aria-hidden="true">
                ›
              </span>

              {submenu === item.id && (
                <div className={`ctx ctx--sub ${flip ? 'ctx--sub-left' : ''}`} role="menu">
                  {item.children.length === 0 && <div className="ctx__empty">Nothing to choose</div>}
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className={`ctx__item ${child.danger ? 'ctx__item--danger' : ''}`}
                      role="menuitem"
                      disabled={child.disabled}
                      data-separated={child.separated || undefined}
                      onClick={() => {
                        child.run?.()
                        close()
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
              data-active={index === active}
              data-separated={item.separated || undefined}
              onMouseEnter={() => {
                setActive(index)
                setSubmenu(null)
              }}
              onClick={() => {
                item.run?.()
                close()
              }}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {/* Showing the chord here is also how people learn the chord. */}
              {item.keys && <span className="ctx__keys">{formatChord(item.keys)}</span>}
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
  open: (
    event: { clientX: number; clientY: number; preventDefault: () => void },
    items: MenuItem[]
  ) => void
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

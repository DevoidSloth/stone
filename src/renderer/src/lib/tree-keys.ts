import { useCallback, type RefObject } from 'react'

/**
 * Arrow-key navigation for the sidebar tree.
 *
 * The file tree was mouse-only: no `tabIndex`, no key handling, no roving
 * focus, in the panel people use more than any other. Obsidian's explorer is
 * fully navigable and it is the kind of thing you only notice is missing when
 * your hands are already on the keyboard.
 *
 * Rows are found in the DOM rather than threaded through the component tree,
 * because the tree renders through four mutually recursive components and
 * passing a focus index through all of them would touch every one of them to
 * express something the DOM already knows: document order is tree order.
 */

const ROW = '[data-treerow]'

function rows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW)].filter((el) => el.offsetParent !== null)
}

function focusRow(row: HTMLElement | undefined, root: HTMLElement): void {
  if (!row) return
  // Roving tabindex: exactly one row is in the tab order at a time, so Tab
  // leaves the tree rather than walking every note in the vault.
  for (const other of rows(root)) other.tabIndex = -1
  row.tabIndex = 0
  row.focus()
  row.scrollIntoView({ block: 'nearest' })
}

/** The twisty inside a folder row, which is what Left/Right operate. */
function twistyOf(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('.treerow__twist--btn')
}

export function useTreeKeyboard(ref: RefObject<HTMLElement | null>) {
  return useCallback(
    (event: React.KeyboardEvent) => {
      const root = ref.current
      if (!root) return

      const all = rows(root)
      if (all.length === 0) return
      const current = (event.target as HTMLElement).closest<HTMLElement>(ROW)
      const index = current ? all.indexOf(current) : -1

      const go = (next: number): void => {
        event.preventDefault()
        focusRow(all[Math.max(0, Math.min(all.length - 1, next))], root)
      }

      switch (event.key) {
        case 'ArrowDown':
          return go(index + 1)
        case 'ArrowUp':
          return go(index - 1)
        case 'Home':
          return go(0)
        case 'End':
          return go(all.length - 1)

        case 'ArrowRight': {
          if (!current) return go(0)
          const twisty = twistyOf(current)
          event.preventDefault()
          // Closed folder opens; already-open folder steps into its first child,
          // which is the standard tree behaviour and why this is not just a toggle.
          if (twisty && twisty.getAttribute('aria-expanded') === 'false') twisty.click()
          else focusRow(all[index + 1], root)
          return
        }

        case 'ArrowLeft': {
          if (!current) return
          const twisty = twistyOf(current)
          event.preventDefault()
          if (twisty && twisty.getAttribute('aria-expanded') === 'true') {
            twisty.click()
            return
          }
          // Otherwise climb to the parent, which is the nearest row above at a
          // shallower indent. Depth is expressed as padding, so it is readable
          // without the component tree having to say so.
          const depthOf = (el: HTMLElement): number => parseFloat(el.style.paddingLeft || '0')
          const mine = depthOf(current)
          for (let i = index - 1; i >= 0; i--) {
            if (depthOf(all[i]) < mine) return focusRow(all[i], root)
          }
          return
        }

        case 'Enter':
        case ' ': {
          if (!current) return
          event.preventDefault()
          // A folder row is a div wrapping buttons; a note row is the button.
          const open = current.matches('button')
            ? current
            : current.querySelector<HTMLElement>('.treerow__label, .treerow__name')
          open?.click()
          return
        }

        default:
          return
      }
    },
    [ref]
  )
}

/** Put the first row in the tab order, so Tab can reach the tree at all. */
export function seedTreeTabStop(root: HTMLElement | null): void {
  if (!root) return
  const all = rows(root)
  if (all.length === 0) return
  if (all.some((el) => el.tabIndex === 0)) return
  all[0].tabIndex = 0
}

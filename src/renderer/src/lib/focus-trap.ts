import { useEffect, type RefObject } from 'react'

/**
 * Keep Tab inside a dialog, and give focus back when it closes.
 *
 * Every dialog in Stone declared `aria-modal="true"`, which is a promise that
 * the rest of the page is inert — and Tab walked straight out of all five into
 * the app behind. Closing one dropped focus on `<body>`, so a keyboard user
 * restarted from the top of the document each time.
 *
 * Both halves matter, and the second is the one people notice: press ⌘K, change
 * your mind, press Escape, and the focus ring should be back on whatever you
 * were doing.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',')

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // `offsetParent` is null for anything `display: none`, which is how the
    // settings panes that are not the current tab hide themselves.
    (el) => el.offsetParent !== null || el === document.activeElement
  )
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return

    const restoreTo = document.activeElement as HTMLElement | null

    // Something inside has to hold focus, or the first Tab starts from the page
    // behind. Dialogs that focus their own input win this by getting there first.
    if (!root.contains(document.activeElement)) {
      const [first] = focusable(root)
      ;(first ?? root).focus()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // A click that lands outside — on a scrim, or on the app behind a dialog
    // that has none — must not leave focus stranded out there.
    const onFocusIn = (event: FocusEvent): void => {
      if (root.contains(event.target as Node)) return
      const [first] = focusable(root)
      ;(first ?? root).focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      // Only if it is still on the page — the dialog may have deleted the very
      // thing that opened it.
      if (restoreTo?.isConnected) restoreTo.focus()
    }
  }, [ref, active])
}

import { formatChord } from '../lib/keys'

/**
 * Tooltips, as one delegated listener over `data-tip`.
 *
 * Stone used `title=""` in thirty places, which is the wrong tool for
 * information a user actually needs: the OS waits about a second, renders it in
 * a system font belonging to no part of this interface, cannot be styled, and
 * never shows it on keyboard focus at all. Every one of those thirty carried
 * something real — a shortcut, a full note path, an instruction for a drag
 * handle.
 *
 * Delegation rather than a component per button, because that makes the
 * conversion a rename of the attribute rather than a rewrite of the element,
 * and because a tooltip is chrome that only one of can ever be visible: there
 * is no reason for thirty pieces of React state to exist for it.
 *
 * The delay is shared, which is the detail that makes a toolbar feel right —
 * the first tip costs 400ms, and moving along the row after that shows each
 * neighbour instantly, until the pointer rests elsewhere long enough to close
 * the group.
 */

const OPEN_DELAY = 400
const GROUP_GRACE = 300

let el: HTMLDivElement | null = null
let openTimer: ReturnType<typeof setTimeout> | null = null
let groupTimer: ReturnType<typeof setTimeout> | null = null
let groupOpen = false
let anchor: HTMLElement | null = null

function node(): HTMLDivElement {
  if (el) return el
  el = document.createElement('div')
  el.className = 'tip'
  el.setAttribute('role', 'tooltip')
  el.id = 'stone-tip'
  el.hidden = true
  document.body.appendChild(el)
  return el
}

function hide(): void {
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
  }
  if (anchor) {
    anchor.removeAttribute('aria-describedby')
    anchor = null
  }
  node().hidden = true

  if (groupTimer) clearTimeout(groupTimer)
  groupTimer = setTimeout(() => {
    groupOpen = false
    groupTimer = null
  }, GROUP_GRACE)
}

function show(target: HTMLElement): void {
  const label = target.dataset.tip
  if (!label) return

  const tip = node()
  tip.textContent = ''

  const text = document.createElement('span')
  text.className = 'tip__label'
  text.textContent = label
  tip.appendChild(text)

  if (target.dataset.tipKeys) {
    const keys = document.createElement('span')
    keys.className = 'tip__keys'
    keys.textContent = formatChord(target.dataset.tipKeys)
    tip.appendChild(keys)
  }

  // Measured before placing, because a tip near an edge has to be pulled back
  // and its width is not known until it has content.
  tip.hidden = false
  tip.style.left = '0px'
  tip.style.top = '0px'
  const rect = target.getBoundingClientRect()
  const size = tip.getBoundingClientRect()

  const below = target.dataset.tipSide !== 'top'
  const margin = 8
  const x = Math.min(
    Math.max(margin + size.width / 2, rect.left + rect.width / 2),
    window.innerWidth - size.width / 2 - margin
  )
  const y = below ? rect.bottom + 6 : rect.top - 6

  tip.className = `tip tip--${below ? 'bottom' : 'top'}`
  tip.style.left = `${Math.round(x)}px`
  tip.style.top = `${Math.round(y)}px`

  target.setAttribute('aria-describedby', tip.id)
  anchor = target

  groupOpen = true
  if (groupTimer) {
    clearTimeout(groupTimer)
    groupTimer = null
  }
}

function schedule(target: HTMLElement, immediate: boolean): void {
  if (openTimer) clearTimeout(openTimer)
  if (immediate || groupOpen) show(target)
  else openTimer = setTimeout(() => show(target), OPEN_DELAY)
}

function tipTarget(from: EventTarget | null): HTMLElement | null {
  const start = from as HTMLElement | null
  return start?.closest?.<HTMLElement>('[data-tip]') ?? null
}

/** Wire the listeners once, at startup. */
export function installTooltips(): void {
  document.addEventListener('pointerover', (event) => {
    const target = tipTarget(event.target)
    if (!target) {
      if (anchor && !anchor.contains(event.target as Node)) hide()
      return
    }
    if (target === anchor) return
    // A tip that follows a dragging finger is noise, not help.
    if ((event as PointerEvent).pointerType === 'touch') return
    schedule(target, false)
  })

  document.addEventListener('pointerout', (event) => {
    const target = tipTarget(event.target)
    if (target && target === anchor) hide()
  })

  // Pressing the control answers the question the tip was going to.
  document.addEventListener('pointerdown', hide, true)

  // The whole reason not to use `title`: a keyboard user gets the hint too.
  document.addEventListener('focusin', (event) => {
    const target = tipTarget(event.target)
    if (!target) {
      hide()
      return
    }
    if (target.matches(':focus-visible')) schedule(target, true)
  })

  document.addEventListener('focusout', hide)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide()
  })

  // Anything that moves the page out from under an open tip closes it.
  window.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
}

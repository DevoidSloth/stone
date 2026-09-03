import { cloneElement, type ReactElement } from 'react'

/**
 * A tooltip, as a wrapper around exactly one element.
 *
 * It only sets the attributes the delegated listener in `./tooltip` reads, so
 * both call styles — this and a bare `data-tip` on an element — are the same
 * mechanism. Use this where the element is already being written in JSX and a
 * wrapper reads more clearly than an attribute; use `data-tip` directly on
 * anything deep in a list, where a wrapper per row would be noise.
 */

export interface TipProps {
  label: string
  /** A chord like `Mod+K`, rendered as a key hint beside the label. */
  keys?: string
  side?: 'top' | 'bottom'
  children: ReactElement
}

export function Tip({ label, keys, side, children }: TipProps) {
  return cloneElement(children, {
    'data-tip': label,
    'data-tip-keys': keys,
    'data-tip-side': side
  } as Record<string, unknown>)
}

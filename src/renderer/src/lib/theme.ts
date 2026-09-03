import { useEffect, useState } from 'react'

/**
 * Whether the dark palette is currently painted.
 *
 * Reads the attribute the preload stamps and the store maintains, rather than
 * the settings value — `system` is only resolved at that point, and this has to
 * follow it when the OS crosses over mid-session.
 */
export function useResolvedDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light')

  useEffect(() => {
    const read = (): void => setDark(document.documentElement.dataset.theme !== 'light')
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    read()
    return () => observer.disconnect()
  }, [])

  return dark
}

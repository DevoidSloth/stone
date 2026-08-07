import { useEffect, useRef } from 'react'
import { IconX } from '../ui/icons'

/**
 * Page icons and covers.
 *
 * Both are stored as ordinary frontmatter keys (`icon:` and `cover:`) so a note
 * dressed up in Stone still opens as clean markdown anywhere else. Covers are
 * named gradients rather than image files: no asset pipeline, nothing to break
 * when the vault syncs, and they cannot go missing.
 */

export const COVERS = [
  'sand',
  'moss',
  'sky',
  'dusk',
  'ember',
  'plum',
  'slate',
  'sea',
  'clay',
  'ink'
] as const

export type CoverName = (typeof COVERS)[number]

const EMOJI = [
  '📄', '📝', '📚', '📖', '🗒️', '📌', '📎', '🗂️', '📁', '🏷️',
  '✅', '🎯', '🚀', '🔥', '💡', '⚡', '🧠', '🔍', '🧩', '🛠️',
  '💻', '⌨️', '🐛', '🧪', '📐', '📊', '📈', '🗓️', '⏰', '⏳',
  '🎓', '🏫', '✏️', '🖊️', '🧮', '🔬', '🧬', '🌍', '🗺️', '🧭',
  '☕', '🍵', '🌱', '🌿', '🍂', '❄️', '🌙', '⭐', '🌊', '🏔️',
  '🎧', '🎬', '🎨', '🎹', '🏃', '🧘', '💬', '❤️', '🎉', '🧊'
]

export function IconPicker({
  onPick,
  onClear,
  onClose
}: {
  onPick: (emoji: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred so the click that opened the popover does not immediately close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="picker" ref={ref} role="dialog" aria-label="Choose a page icon">
      <div className="picker__head">
        <span className="eyebrow">Icon</span>
        <button type="button" className="btn btn--sm" onClick={onClear}>
          Remove
        </button>
      </div>
      <div className="picker__grid">
        {EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="picker__emoji"
            aria-label={`Use ${emoji}`}
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CoverPicker({
  active,
  onPick,
  onClear,
  onClose
}: {
  active: string | null
  onPick: (cover: CoverName) => void
  onClear: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="picker picker--covers" ref={ref} role="dialog" aria-label="Choose a cover">
      <div className="picker__head">
        <span className="eyebrow">Cover</span>
        <button type="button" className="btn btn--sm" onClick={onClear}>
          Remove
        </button>
      </div>
      <div className="picker__covers">
        {COVERS.map((name) => (
          <button
            key={name}
            type="button"
            className={`picker__cover cover--${name}`}
            aria-label={name}
            aria-pressed={active === name}
            onClick={() => onPick(name)}
          />
        ))}
      </div>
    </div>
  )
}

export function CoverBand({
  cover,
  onChange,
  onRemove
}: {
  cover: string
  onChange: () => void
  onRemove: () => void
}) {
  return (
    <div className={`cover cover--${cover}`}>
      <div className="cover__actions">
        <button type="button" className="btn btn--sm btn--outline" onClick={onChange}>
          Change cover
        </button>
        <button
          type="button"
          className="btn btn--sm btn--outline btn--icon"
          aria-label="Remove cover"
          onClick={onRemove}
        >
          <IconX size={12} />
        </button>
      </div>
    </div>
  )
}

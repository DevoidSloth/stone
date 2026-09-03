import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_GLYPH_LENGTH, normalizePageIcon, pageIconKind, pageIconLength } from '@shared/page-icon'
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

const NUMBERS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '30', '50', '99', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ',
  '№', '½', '⅓', '¼', '¾', '1a', '1b', '2a', '2b', '3a'
]

const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'TL', 'WIP', 'TBD', 'FYI',
  'Q1', 'Q2', 'Q3', 'Q4', 'v1', 'v2', 'RE', 'PS', 'ID', 'OK'
]

const SYMBOLS = [
  '→', '←', '↑', '↓', '↗', '↘', '⇄', '⇢', '↺', '⤴',
  '★', '☆', '●', '○', '◆', '◇', '■', '□', '▲', '▼',
  '§', '¶', '†', '‡', '•', '‣', '·', '‥', '…', '¬',
  '✓', '✗', '±', '×', '÷', '=', '≠', '≈', '∞', '∅',
  '∑', '∆', '∫', '√', 'π', 'λ', 'µ', 'Ω', 'α', 'β',
  '#', '@', '&', '%', '‰', '°', '?', '!', '$', '€'
]

const TABS = [
  { id: 'emoji', label: 'Emoji', items: EMOJI },
  { id: 'numbers', label: '123', items: NUMBERS },
  { id: 'letters', label: 'ABC', items: LETTERS },
  { id: 'symbols', label: 'Symbols', items: SYMBOLS }
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * One page icon, drawn according to its kind. Emoji are left alone; anything
 * typed gets the monogram treatment, sized down as it lengthens so two or
 * three characters still fit the same square an emoji occupies.
 */
export function PageIcon({ icon, className }: { icon: string; className?: string }) {
  const kind = pageIconKind(icon)
  return (
    <span
      className={`pageicon pageicon--${kind}${className ? ` ${className}` : ''}`}
      data-len={kind === 'glyph' ? Math.min(pageIconLength(icon), MAX_GLYPH_LENGTH) : undefined}
    >
      {icon}
    </span>
  )
}

/**
 * The picker offers four sets rather than one, because plenty of pages are
 * better labelled by a chapter number or a pair of initials than by the
 * closest available picture. Whatever is not in the sets can be typed: the
 * field takes any character at all, so the sets are a shortcut, not a limit.
 */
export function IconPicker({
  current,
  onPick,
  onClear,
  onClose
}: {
  current: string | null
  onPick: (icon: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<TabId>(() =>
    current && pageIconKind(current) === 'glyph' ? 'symbols' : 'emoji'
  )
  const [typed, setTyped] = useState('')
  const preview = useMemo(() => normalizePageIcon(typed), [typed])
  const items = TABS.find((t) => t.id === tab)!.items

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

  const commitTyped = (): void => {
    if (preview) onPick(preview)
  }

  return (
    <div className="picker" ref={ref} role="dialog" aria-label="Choose a page icon">
      <div className="picker__head">
        <span className="eyebrow">Icon</span>
        <button type="button" className="btn btn--sm" onClick={onClear}>
          Remove
        </button>
      </div>

      <div className="picker__entry">
        <input
          className="field"
          value={typed}
          placeholder="Type a number, initials, or any symbol"
          aria-label="Custom icon"
          spellCheck={false}
          autoFocus
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTyped()
            }
          }}
        />
        <button
          type="button"
          className="picker__use"
          disabled={!preview}
          aria-label={preview ? `Use ${preview}` : 'Use typed icon'}
          onClick={commitTyped}
        >
          {preview ? <PageIcon icon={preview} /> : <span className="picker__use-hint">Use</span>}
        </button>
      </div>

      <div className="segmented picker__tabs" role="tablist" aria-label="Icon sets">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="segmented__btn"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="picker__grid">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            className="picker__emoji"
            aria-label={`Use ${item}`}
            aria-pressed={current === item}
            onClick={() => onPick(item)}
          >
            <PageIcon icon={item} />
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

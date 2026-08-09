/**
 * Keyboard chords, as text.
 *
 * A binding has to survive a round trip through settings.json, so it is stored
 * as a string like `Mod+Shift+F` rather than as a structured object. `Mod` is
 * the platform's command key — ⌘ on macOS, Ctrl everywhere else — which keeps
 * one stored binding correct on both platforms instead of forcing the user to
 * rebind everything when they change machine.
 *
 * The key itself is read from `event.code` for letters and digits, so a chord
 * recorded on one keyboard layout still fires on another, and so holding Shift
 * does not silently turn `Mod+Shift+1` into `Mod+Shift+!`.
 */

export const IS_MAC = navigator.platform.toUpperCase().includes('MAC')

/** Modifier order is fixed so two spellings of the same chord compare equal. */
const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift']

function keyName(event: KeyboardEvent): string | null {
  const code = event.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)

  // Anything else — arrows, brackets, Enter — is taken from `key`, which is
  // already a stable name for those. Bare modifier presses are not a chord.
  const key = event.key
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null
  if (key === ' ') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

/** The chord a key event represents, or null when only modifiers are down. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  const key = keyName(event)
  if (!key) return null

  const parts: string[] = []
  // On macOS ⌘ and ⌃ are different keys, so both are expressible. Elsewhere
  // Ctrl *is* Mod, and offering both would let a user bind an unreachable chord.
  if (IS_MAC) {
    if (event.metaKey) parts.push('Mod')
    if (event.ctrlKey) parts.push('Ctrl')
  } else if (event.ctrlKey) {
    parts.push('Mod')
  }
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  parts.push(key)
  return parts.join('+')
}

export function normaliseChord(chord: string): string {
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  const key = parts[parts.length - 1]
  const mods = ORDER.filter((m) => parts.slice(0, -1).some((p) => p.toLowerCase() === m.toLowerCase()))
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}

const SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↵',
  Escape: 'Esc',
  Backspace: '⌫'
}

const WORDS: Record<string, string> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace'
}

/**
 * Translate a chord into an Electron accelerator, for the global shortcut.
 *
 * Electron spells the platform command key `CommandOrControl`, which is the
 * same idea as `Mod` under a different name; everything else lines up already.
 */
export function toAccelerator(chord: string): string {
  return normaliseChord(chord)
    .split('+')
    .map((part) => {
      if (part === 'Mod') return 'CommandOrControl'
      if (part === 'Ctrl') return 'Control'
      if (part === 'Escape') return 'Esc'
      return part
    })
    .join('+')
}

/** The inverse, for showing a stored accelerator back to the user. */
export function fromAccelerator(accelerator: string): string {
  return normaliseChord(
    accelerator
      .split('+')
      .map((part) => {
        if (part === 'CommandOrControl' || part === 'CmdOrCtrl') return 'Mod'
        if (part === 'Command' || part === 'Cmd') return IS_MAC ? 'Mod' : 'Ctrl'
        if (part === 'Control') return IS_MAC ? 'Ctrl' : 'Mod'
        if (part === 'Option') return 'Alt'
        return part
      })
      .join('+')
  )
}

/** Render a chord the way the platform writes it: `⌘⇧F`, or `Ctrl+Shift+F`. */
export function formatChord(chord: string): string {
  if (!chord) return ''
  const parts = normaliseChord(chord).split('+')
  if (IS_MAC) return parts.map((p) => SYMBOLS[p] ?? p).join('')
  return parts.map((p) => WORDS[p] ?? p).join('+')
}

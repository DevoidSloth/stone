import { useMemo, useState } from 'react'
import { COMMANDS, commandLabel, keysFor, type CommandGroup } from '../commands'
import { chordFromEvent, formatChord } from '../lib/keys'
import { useStone } from '../store'
import { IconPlus, IconX } from '../ui/icons'

const GROUPS: CommandGroup[] = ['Navigation', 'Create', 'Note', 'Editor', 'App']

/**
 * Rebinding.
 *
 * Recording a chord means listening for the next keydown rather than parsing
 * typed text — nobody should have to know that the app spells the command key
 * `Mod`. The listener sits on the button itself, so the window handler never
 * sees the keystroke and a user can rebind ⌘K without the palette opening
 * underneath them.
 */
export function KeybindingSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const [recording, setRecording] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const overrides = settings?.keybindings ?? {}

  /** Chord → command ids, so a clash can be named rather than silently resolved. */
  const clashes = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const command of COMMANDS) {
      for (const chord of keysFor(command, overrides)) {
        seen.set(chord, [...(seen.get(chord) ?? []), command.id])
      }
    }
    return seen
  }, [overrides])

  if (!settings) return null

  const setKeys = (id: string, keys: string[]): void => {
    void updateSettings({ keybindings: { ...overrides, [id]: keys } })
  }

  const reset = (id: string): void => {
    const next = { ...overrides }
    delete next[id]
    void updateSettings({ keybindings: next })
  }

  const record = (id: string, event: React.KeyboardEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(null)
      return
    }
    const chord = chordFromEvent(event.nativeEvent)
    if (!chord) return
    const command = COMMANDS.find((c) => c.id === id)
    if (!command) return
    setKeys(id, [...keysFor(command, overrides), chord])
    setRecording(null)
  }

  const query = filter.trim().toLowerCase()
  const visible = COMMANDS.filter(
    (c) => !query || commandLabel(c, { query: '' }).toLowerCase().includes(query)
  )

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Keyboard
      </div>

      <div className="row">
        <div className="row__label">
          <b>Shortcuts</b>
          <span>
            Click a chord to remove it, or add another. A command can answer to more than one.
          </span>
        </div>
        <input
          className="field"
          style={{ width: 180 }}
          placeholder="Filter commands…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {GROUPS.map((group) => {
        const rows = visible.filter((c) => c.group === group)
        if (rows.length === 0) return null
        return (
          <div key={group} style={{ marginTop: 'var(--sp-4)' }}>
            <div className="eyebrow" style={{ opacity: 0.6, marginBottom: 'var(--sp-2)' }}>
              {group}
            </div>
            {rows.map((command) => {
              const keys = keysFor(command, overrides)
              const custom = overrides[command.id] !== undefined
              return (
                <div className="row" key={command.id} style={{ marginTop: 'var(--sp-2)' }}>
                  <div className="row__label">
                    <b>{commandLabel(command, { query: '' })}</b>
                    {keys.some((k) => (clashes.get(k)?.length ?? 0) > 1) && (
                      <span style={{ color: 'var(--red)' }}>
                        Also bound to another command — the last one wins.
                      </span>
                    )}
                  </div>

                  <div className="chips" style={{ justifyContent: 'flex-end' }}>
                    {keys.map((chord) => (
                      <button
                        key={chord}
                        type="button"
                        className="tagchip"
                        data-tip="Remove this shortcut"
                        onClick={() => setKeys(command.id, keys.filter((k) => k !== chord))}
                      >
                        {formatChord(chord)}
                        <b>
                          <IconX size={10} />
                        </b>
                      </button>
                    ))}

                    {recording === command.id ? (
                      <button
                        type="button"
                        className="tagchip"
                        autoFocus
                        onKeyDown={(e) => record(command.id, e)}
                        onBlur={() => setRecording(null)}
                      >
                        Press a chord…
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        aria-label={`Add a shortcut for ${commandLabel(command, { query: '' })}`}
                        onClick={() => setRecording(command.id)}
                      >
                        <IconPlus size={12} />
                      </button>
                    )}

                    {custom && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => reset(command.id)}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}

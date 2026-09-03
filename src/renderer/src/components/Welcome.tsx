import { useEffect, useState } from 'react'
import type { CloudTargetWithAdvice } from '../../../preload'
import { useStone } from '../store'
import { IconCloud, IconFolder, IconSpinner, StoneMark } from '../ui/icons'
import { describeError } from '../lib/errors'

const ICON_FOR: Record<string, string> = {
  icloud: 'iCloud Drive',
  gdrive: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  local: 'This computer'
}

/**
 * First run. The one decision that matters is where the vault lives, so this
 * screen does nothing else — it finds the sync folders already on the machine
 * and offers to put a Stone vault inside one.
 */
export function Welcome() {
  const toast = useStone((s) => s.toast)
  const boot = useStone((s) => s.boot)
  const [targets, setTargets] = useState<CloudTargetWithAdvice[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.stone.vault
      .cloudTargets()
      .then(setTargets)
      .catch(() => setTargets([]))
  }, [])

  const open = async (path: string): Promise<void> => {
    setBusy(true)
    try {
      await window.stone.vault.open(path)
      // `boot()` already knows how to bring the app up, and React swaps this
      // screen for the shell as soon as the vault path lands in the store.
      // Reloading the renderer instead threw away the whole process — fonts,
      // bundle, and all — for the sake of re-running the same function.
      await boot()
    } catch (err) {
      toast(describeError(err), 'error')
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    const picked = await window.stone.vault.choose()
    if (picked) await open(picked)
  }

  const separator = window.stone.platform === 'win32' ? '\\' : '/'

  return (
    <div className="welcome">
      {/* Without this the first screen the user ever sees is an immovable
          window, with the traffic lights floating over the card. */}
      <div className="dragstrip" />

      <div className="welcome__card">
        <div className="welcome__mark">
          <StoneMark size={30} />
          <span className="eyebrow">Notes · Tasks · Calendar</span>
        </div>

        <h1 className="welcome__title">Stone</h1>
        <p className="welcome__lede">
          Everything you write is a markdown file you own. Pick where those files live and Stone
          builds the rest around them.
        </p>

        <div className="welcome__targets">
          {targets.map((target) => (
            <button
              key={target.path}
              type="button"
              className="target"
              disabled={busy}
              onClick={() => void open(`${target.path}${separator}Stone`)}
            >
              <span className="target__icon">
                {busy ? <IconSpinner /> : target.kind === 'local' ? <IconFolder /> : <IconCloud />}
              </span>
              <span className="target__body">
                <b>{ICON_FOR[target.kind] ?? target.label}</b>
                <span>
                  {target.path}
                  {separator}Stone
                </span>
              </span>
            </button>
          ))}

          <button type="button" className="target" disabled={busy} onClick={() => void browse()}>
            <span className="target__icon">
              <IconFolder />
            </span>
            <span className="target__body">
              <b>Choose another folder</b>
              <span>Point Stone at an existing vault, including an Obsidian one</span>
            </span>
          </button>
        </div>

        <p className="welcome__note">
          Files stay plain markdown on disk. Putting the vault inside iCloud Drive or Google Drive is
          what syncs it between machines — Stone writes atomically and keeps a conflict copy if two
          devices edit the same note, so nothing is ever overwritten silently.
        </p>
      </div>
    </div>
  )
}

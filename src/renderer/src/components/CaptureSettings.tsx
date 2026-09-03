import { useEffect, useState } from 'react'
import { useStone } from '../store'
import { chordFromEvent, formatChord, fromAccelerator, toAccelerator } from '../lib/keys'
import { IconCopy, IconRefresh } from '../ui/icons'
import { describeError } from '../lib/errors'

function Toggle({ checked, onChange, label }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

/**
 * Capture, and the clipper that feeds it.
 *
 * The bookmarklet is shown rather than installed because no app can add one to
 * a browser on the user's behalf — dragging it to the bar is the install step,
 * and it carries the token, which is why the field is copy-only and why
 * regenerating one invalidates the bookmarklet already sitting in the browser.
 */
export function CaptureSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const toast = useStone((s) => s.toast)

  const [recording, setRecording] = useState(false)
  const [clipper, setClipper] = useState<{ running: boolean; bookmarklet: string }>({
    running: false,
    bookmarklet: ''
  })

  useEffect(() => {
    void window.stone.clipper
      .status()
      .then((s) => setClipper({ running: s.running, bookmarklet: s.bookmarklet }))
      .catch(() => undefined)
  }, [])

  if (!settings) return null

  const shortcut = settings.captureShortcut
  const shown = shortcut ? formatChord(fromAccelerator(shortcut)) : 'Not bound'

  const record = async (event: React.KeyboardEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(false)
      return
    }
    const chord = chordFromEvent(event.nativeEvent)
    if (!chord) return
    setRecording(false)

    const accelerator = toAccelerator(chord)
    const { ok } = await window.stone.capture.setShortcut(accelerator)
    await updateSettings({ captureShortcut: accelerator })
    if (!ok) {
      toast(
        `${formatChord(chord)} is already claimed by another app, so it is saved but not active.`,
        'error'
      )
    }
  }

  const toggleClipper = async (next: boolean): Promise<void> => {
    try {
      const result = await window.stone.clipper.setEnabled(next)
      setClipper(result)
      await updateSettings({ clipperEnabled: next })
      if (next) toast('Clipper listening. Drag the bookmarklet to your bookmarks bar.', 'success')
    } catch (err) {
      toast(describeError(err), 'error')
    }
  }

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Capture
      </div>

      <div className="row">
        <div className="row__label">
          <b>Global shortcut</b>
          <span>Opens quick-add from any app, whether or not Stone has focus.</span>
        </div>
        <div className="chips" style={{ justifyContent: 'flex-end' }}>
          {recording ? (
            <button
              type="button"
              className="tagchip"
              autoFocus
              onKeyDown={(e) => void record(e)}
              onBlur={() => setRecording(false)}
            >
              Press a chord…
            </button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {shown}
            </button>
          )}
          {shortcut && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                void window.stone.capture.setShortcut(null)
                void updateSettings({ captureShortcut: null })
              }}
            >
              Unbind
            </button>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Menu bar icon</b>
          <span>Keeps capture reachable once the window is closed.</span>
        </div>
        <Toggle
          label="Menu bar icon"
          checked={settings.trayEnabled}
          onChange={(next) => {
            void window.stone.capture.setTray(next)
            void updateSettings({ trayEnabled: next })
          }}
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Web clipper</b>
          <span>
            Listens on 127.0.0.1:{settings.clipperPort} for pages sent from the browser. Nothing off
            this machine can reach it, and every request carries a secret only your bookmarklet
            knows.
          </span>
        </div>
        <Toggle
          label="Web clipper"
          checked={settings.clipperEnabled}
          onChange={(next) => void toggleClipper(next)}
        />
      </div>

      {settings.clipperEnabled && (
        <>
          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="row__label">
              <b>Clippings folder</b>
              <span>Where a clipped page is filed, with its source URL in frontmatter.</span>
            </div>
            <input
              className="field"
              style={{ width: 160 }}
              value={settings.clipFolder}
              onChange={(e) => void updateSettings({ clipFolder: e.target.value })}
            />
          </div>

          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="row__label">
              <b>Bookmarklet</b>
              <span>
                Copy this, then make a new bookmark with it as the address. Clicking it on any page
                sends your selection — or the whole article — to Stone.
              </span>
            </div>
            <div className="chips" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!clipper.bookmarklet}
                onClick={() => {
                  void navigator.clipboard.writeText(clipper.bookmarklet)
                  toast('Bookmarklet copied.', 'success')
                }}
              >
                <IconCopy size={13} /> Copy
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-tip="Issue a new secret. The bookmarklet you already saved stops working."
                onClick={() => {
                  void window.stone.clipper.regenerateToken().then((r) => {
                    setClipper((c) => ({ ...c, bookmarklet: r.bookmarklet }))
                    toast('New secret issued — copy the bookmarklet again.', 'info')
                  })
                }}
              >
                <IconRefresh size={13} /> New secret
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

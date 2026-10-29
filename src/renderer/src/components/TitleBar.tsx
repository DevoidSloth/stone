import { useState } from 'react'
import type { Settings } from '@shared/types'
import { useStone, type View } from '../store'
import { COMMANDS_BY_ID, keysFor } from '../commands'
import { formatChord } from '../lib/keys'
import { exportNoteToPdf } from '../export-note'
import { Tip } from '../ui/Tip'
import {
  IconBoard,
  IconNote,
  IconSearch,
  IconSettings,
  IconSun,
  IconMoon,
  IconContrast,
  IconSpinner,
  IconPrint,
  StoneMark
} from '../ui/icons'

const VIEWS: {
  id: View
  label: string
  icon: typeof IconNote
  /** The command whose binding this button reflects, so hints stay honest. */
  command: string
  /** Shown only when switched on — off by default, to keep the bar honest. */
  optional?: boolean
}[] = [
  { id: 'notes', label: 'Notes', icon: IconNote, command: 'view-notes' },
  // Documents are not here on purpose: they open in the ordinary panes, are
  // listed in the sidebar, and answer to `[[links]]` — a screen of their own
  // would put them back in a box the rest of the app has to reach into.
  { id: 'canvas', label: 'Canvas', icon: IconBoard, command: 'view-canvas', optional: true }
]

/**
 * The chord actually bound to a command, formatted for display.
 *
 * The bar used to hardcode ⌘1 … ⌘7 while `buildKeymap` resolved the same
 * commands through the user's overrides, so rebinding a view left the tooltip
 * advertising a shortcut that no longer worked.
 */
function hintFor(id: string, overrides: Settings['keybindings']): string | undefined {
  const command = COMMANDS_BY_ID.get(id)
  if (!command) return undefined
  const [chord] = keysFor(command, overrides)
  return chord ? formatChord(chord) : undefined
}

function vaultName(path: string | null): string {
  if (!path) return 'Stone'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? 'Stone'
}

export function TitleBar() {
  const view = useStone((s) => s.view)
  const setView = useStone((s) => s.setView)
  const settings = useStone((s) => s.settings)
  const vaultPath = useStone((s) => s.vaultPath)
  const updateSettings = useStone((s) => s.updateSettings)
  const setPalette = useStone((s) => s.setPalette)
  const setSettingsOpen = useStone((s) => s.setSettingsOpen)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const [exporting, setExporting] = useState(false)

  const bindings = settings?.keybindings ?? {}

  // System → Limestone → Basalt → Tango. A two-way toggle silently destroyed `system`,
  // which after the first click could only be recovered from Settings.
  const theme = settings?.theme ?? 'system'
  const order = ['system', 'light', 'dark', 'tango'] as const
  const nextTheme = order[(order.indexOf(theme) + 1) % order.length]
  const THEME_LABEL = {
    system: 'Matching the system',
    light: 'Limestone',
    dark: 'Basalt',
    tango: 'Tango'
  } as const
  const themeIcon =
    theme === 'system' ? <IconContrast /> : theme === 'light' ? <IconSun /> : <IconMoon />
  const canExport = view === 'notes' && Boolean(activeRelPath)

  return (
    <header className="titlebar">
      <div className="titlebar__mark">
        <StoneMark />
        <span className="titlebar__vault truncate">{vaultName(vaultPath)}</span>
      </div>

      {/*
        Not a tablist. That role commits to arrow-key movement within one tab
        stop, `aria-controls`, and a matching tabpanel — none of which this has,
        and none of which it wants. Switching the whole screen is navigation.
      */}
      <nav className="segmented" aria-label="Views">
        {VIEWS.filter((v) => !v.optional || settings?.showCanvas || view === v.id).map(
          ({ id, label, icon: Icon, command }) => (
            <Tip key={id} label={label} keys={hintFor(command, bindings)}>
              <button
                type="button"
                aria-current={view === id ? 'page' : undefined}
                className="segmented__btn"
                data-active={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={14} />
                {label}
              </button>
            </Tip>
          )
        )}
      </nav>

      <div className="titlebar__spacer" />

      <button type="button" className="omni" onClick={() => setPalette(true)}>
        <IconSearch size={14} />
        Search or jump to…
        <span className="omni__hint">{formatChord(hintFor('palette', bindings) ?? 'Mod+K')}</span>
      </button>

      {/*
        The slot is permanent and the button inside it is disabled off a note.
        It used to unmount instead, which was honest about the action being
        unavailable but slid the two buttons to its right sideways every time
        the user changed view — a control that jumps is worse than either.
      */}
      <Tip
        label={canExport ? 'Export this note as a PDF' : 'Open a note to export it'}
        keys={hintFor('export-pdf', bindings)}
      >
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Export this note as a PDF"
          disabled={!canExport || exporting}
          onClick={() => {
            if (!activeRelPath) return
            setExporting(true)
            void exportNoteToPdf(activeRelPath).finally(() => setExporting(false))
          }}
        >
          {exporting ? <IconSpinner /> : <IconPrint />}
        </button>
      </Tip>

      <Tip label={`Theme: ${THEME_LABEL[theme]}`}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme]}`}
          onClick={() => void updateSettings({ theme: nextTheme })}
        >
          {themeIcon}
        </button>
      </Tip>

      <Tip label="Settings" keys={hintFor('settings', bindings)}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings />
        </button>
      </Tip>
    </header>
  )
}

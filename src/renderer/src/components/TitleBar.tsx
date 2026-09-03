import { useState } from 'react'
import { useStone, type View } from '../store'
import { exportNoteToPdf } from '../export-note'
import {
  IconBoard,
  IconCalendar,
  IconGraph,
  IconNote,
  IconSearch,
  IconSettings,
  IconSun,
  IconMoon,
  IconPrint,
  IconTasks,
  IconLayers,
  StoneMark
} from '../ui/icons'

const VIEWS: {
  id: View
  label: string
  icon: typeof IconNote
  key: string
  /** Shown only when switched on — off by default, to keep the bar honest. */
  optional?: boolean
}[] = [
  { id: 'today', label: 'Today', icon: IconLayers, key: '1' },
  { id: 'notes', label: 'Notes', icon: IconNote, key: '2' },
  { id: 'calendar', label: 'Calendar', icon: IconCalendar, key: '3' },
  { id: 'tasks', label: 'Tasks', icon: IconTasks, key: '4' },
  { id: 'graph', label: 'Graph', icon: IconGraph, key: '5' },
  // Documents are not here on purpose: they open in the ordinary panes, are
  // listed in the sidebar, and answer to `[[links]]` — a screen of their own
  // would put them back in a box the rest of the app has to reach into.
  { id: 'canvas', label: 'Canvas', icon: IconBoard, key: '7', optional: true }
]

function vaultName(path: string | null): string {
  if (!path) return 'Stone'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? 'Stone'
}

export function TitleBar() {
  const view = useStone((s) => s.view)
  const setView = useStone((s) => s.setView)
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const setPalette = useStone((s) => s.setPalette)
  const setSettingsOpen = useStone((s) => s.setSettingsOpen)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const [exporting, setExporting] = useState(false)

  const isLight = settings?.theme === 'light'
  const modifier = window.stone.platform === 'darwin' ? '⌘' : 'Ctrl'

  return (
    <header className="titlebar">
      <div className="titlebar__mark">
        <StoneMark />
        <span className="titlebar__vault truncate">{vaultName(settings?.vaultPath ?? null)}</span>
      </div>

      <nav className="segmented" role="tablist" aria-label="Views">
        {VIEWS.filter((v) => !v.optional || settings?.showCanvas || view === v.id).map(({ id, label, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className="segmented__btn"
            onClick={() => setView(id)}
            title={`${label} · ${modifier}${key}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      <div className="titlebar__spacer" />

      <button type="button" className="omni" onClick={() => setPalette(true)}>
        <IconSearch size={14} />
        Search or jump to…
        <span className="omni__hint">{modifier === '⌘' ? '⌘K' : 'Ctrl K'}</span>
      </button>

      {/*
        Per-note, so it appears only when there is a note to export. The rest of
        this bar is global chrome, and a permanently dead button sitting in it
        would be the same dishonesty the optional views above are avoiding.
      */}
      {view === 'notes' && activeRelPath && (
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={`Export this note as a PDF · ${modifier}\u21e7P`}
          aria-label="Export this note as a PDF"
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            void exportNoteToPdf(activeRelPath).finally(() => setExporting(false))
          }}
        >
          <IconPrint />
        </button>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title={isLight ? 'Use the dark theme' : 'Use the light theme'}
        aria-label={isLight ? 'Use the dark theme' : 'Use the light theme'}
        onClick={() => void updateSettings({ theme: isLight ? 'dark' : 'light' })}
      >
        {isLight ? <IconMoon /> : <IconSun />}
      </button>

      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        <IconSettings />
      </button>
    </header>
  )
}

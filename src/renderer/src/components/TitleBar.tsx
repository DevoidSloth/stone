import { useStone, type View } from '../store'
import {
  IconBoard,
  IconCalendar,
  IconFolder,
  IconGraph,
  IconNote,
  IconSearch,
  IconSettings,
  IconSun,
  IconMoon,
  IconTasks,
  IconLayers,
  StoneMark
} from '../ui/icons'

const VIEWS: { id: View; label: string; icon: typeof IconNote; key: string }[] = [
  { id: 'today', label: 'Today', icon: IconLayers, key: '1' },
  { id: 'notes', label: 'Notes', icon: IconNote, key: '2' },
  { id: 'calendar', label: 'Calendar', icon: IconCalendar, key: '3' },
  { id: 'tasks', label: 'Tasks', icon: IconTasks, key: '4' },
  { id: 'graph', label: 'Graph', icon: IconGraph, key: '5' },
  { id: 'canvas', label: 'Canvas', icon: IconBoard, key: '7' },
  { id: 'library', label: 'Documents', icon: IconFolder, key: '8' }
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

  const isLight = settings?.theme === 'light'
  const modifier = window.stone.platform === 'darwin' ? '⌘' : 'Ctrl'

  return (
    <header className="titlebar">
      <div className="titlebar__mark">
        <StoneMark />
        <span className="titlebar__vault truncate">{vaultName(settings?.vaultPath ?? null)}</span>
      </div>

      <nav className="segmented" role="tablist" aria-label="Views">
        {VIEWS.map(({ id, label, icon: Icon, key }) => (
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

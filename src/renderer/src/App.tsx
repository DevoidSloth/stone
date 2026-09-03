import { useEffect, useMemo } from 'react'
import { useStone } from './store'
import { buildKeymap } from './commands'
import { chordFromEvent } from './lib/keys'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Panes } from './components/Panes'
import { TodayView } from './components/TodayView'
import { CalendarView } from './components/CalendarView'
import { TasksView } from './components/TasksView'
import { GraphView } from './components/GraphView'
import { SearchView } from './components/SearchView'
import { TrashView } from './components/TrashView'
import { DatabaseView } from './components/DatabaseView'
import { CanvasView } from './components/CanvasView'
import { LibraryView } from './components/LibraryView'
import { SidePanels } from './components/SidePanels'
import { AgendaPane } from './components/AgendaPane'
import { CommandPalette } from './components/CommandPalette'
import { QuickOpen } from './components/QuickOpen'
import { QuickAdd } from './components/QuickAdd'
import { SettingsModal } from './components/SettingsModal'
import { PromptDialog } from './components/PromptDialog'
import { ClaudeDialog } from './components/ClaudeDialog'
import { AudioBar } from './components/AudioBar'
import { Welcome } from './components/Welcome'
import { IconX } from './ui/icons'

/** True when the keystroke belongs to a field or the editor, not to a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

function platformClass(): string {
  if (window.stone.platform === 'darwin') return 'is-mac'
  if (window.stone.platform === 'win32') return 'is-win'
  return 'is-linux'
}

export function App() {
  const ready = useStone((s) => s.ready)
  const settings = useStone((s) => s.settings)
  const view = useStone((s) => s.view)
  const toasts = useStone((s) => s.toasts)
  const boot = useStone((s) => s.boot)
  const dismissToast = useStone((s) => s.dismissToast)

  // Rebuilt only when the user rebinds something, not on every render.
  const keymap = useMemo(() => buildKeymap(settings?.keybindings ?? {}), [settings?.keybindings])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    document.documentElement.classList.add(platformClass())
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const chord = chordFromEvent(event)
      if (!chord) return
      const command = keymap.get(chord)
      if (!command) return

      // A binding with no modifier is a letter someone might be typing. The old
      // handler dodged this by only ever looking at Mod chords; now that any
      // chord is bindable, text fields and the editor keep the keystroke.
      if (!/\+/.test(chord) && isTyping(event.target)) return

      event.preventDefault()
      command.run({ query: '' })
    }

    // Mouse thumb buttons, which is how most people navigate back.
    const onMouse = (event: MouseEvent): void => {
      if (event.button === 3) {
        event.preventDefault()
        useStone.getState().goBack()
      }
      if (event.button === 4) {
        event.preventDefault()
        useStone.getState().goForward()
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [keymap])

  if (!ready) {
    return (
      <div className="app">
        <div className="app__body">
          <div className="empty">
            <div className="empty__inner">
              <p className="empty__title">Reading the vault…</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!settings?.vaultPath) return <Welcome />

  const showSidebar = view === 'notes' || view === 'today'
  // Today is the agenda at full size, so the column would only duplicate it.
  const showAgenda = view === 'calendar'
  const showInspector = view === 'notes'

  return (
    <div className="app">
      <div className="app__body">
        <TitleBar />

        <div className="app__panes">
          {showSidebar && <Sidebar />}

          <main className="pane">
            {view === 'calendar' ? (
              <CalendarView />
            ) : view === 'tasks' ? (
              <TasksView />
            ) : view === 'graph' ? (
              <GraphView />
            ) : view === 'search' ? (
              <SearchView />
            ) : view === 'trash' ? (
              <TrashView />
            ) : view === 'views' ? (
              <DatabaseView />
            ) : view === 'canvas' ? (
              <CanvasView />
            ) : view === 'library' ? (
              <LibraryView />
            ) : view === 'today' ? (
              <TodayView />
            ) : (
              <Panes />
            )}
          </main>

          {showInspector && <SidePanels />}
          {showAgenda && <AgendaPane />}
        </div>

        {/* A row of the layout rather than something floating over it: a bar
            that covered the last line of a note would hide exactly the line
            being written while a lecture is recorded. */}
        <AudioBar />
      </div>

      <CommandPalette />
      <QuickOpen />
      <QuickAdd />
      <SettingsModal />
      <PromptDialog />
      <ClaudeDialog />

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span className="toast__dot" />
            {/* Selectable, not a button label: an error you cannot select is an
                error you cannot report. */}
            <span className="toast__message">{toast.message}</span>
            {toast.tone === 'error' && (
              <button
                type="button"
                className="toast__action"
                title="Copy this message"
                onClick={() => {
                  void navigator.clipboard.writeText(toast.message)
                }}
              >
                Copy
              </button>
            )}
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss"
              onClick={() => dismissToast(toast.id)}
            >
              <IconX size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

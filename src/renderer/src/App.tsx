import { useEffect } from 'react'
import { useStone } from './store'
import { today } from './lib/dates'
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
import { SidePanels } from './components/SidePanels'
import { AgendaPane } from './components/AgendaPane'
import { CommandPalette } from './components/CommandPalette'
import { QuickAdd } from './components/QuickAdd'
import { SettingsModal } from './components/SettingsModal'
import { Welcome } from './components/Welcome'

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
  const setView = useStone((s) => s.setView)
  const setPalette = useStone((s) => s.setPalette)
  const setQuickAdd = useStone((s) => s.setQuickAdd)
  const openDaily = useStone((s) => s.openDaily)
  const createNote = useStone((s) => s.createNote)
  const dismissToast = useStone((s) => s.dismissToast)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    document.documentElement.classList.add(platformClass())
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useStone.getState()
      const mod = event.metaKey || event.ctrlKey

      // Back and forward: the mouse buttons and the platform chords.
      if (mod && event.key === '[') {
        event.preventDefault()
        state.goBack()
        return
      }
      if (mod && event.key === ']') {
        event.preventDefault()
        state.goForward()
        return
      }
      if (event.altKey && !mod && event.key === 'ArrowLeft') {
        event.preventDefault()
        state.goBack()
        return
      }
      if (event.altKey && !mod && event.key === 'ArrowRight') {
        event.preventDefault()
        state.goForward()
        return
      }

      if (!mod) return

      if (event.shiftKey) {
        switch (event.key.toLowerCase()) {
          case 'f':
            event.preventDefault()
            setView('search')
            return
          case 'e':
            event.preventDefault()
            state.splitPane()
            return
          case 'o':
            event.preventDefault()
            state.togglePanel()
            return
        }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault()
          setPalette(true)
          break
        case 'n':
          event.preventDefault()
          void createNote('Untitled')
          break
        case 's': {
          event.preventDefault()
          const relPath = state.activeRelPath
          if (relPath) void state.saveDoc(relPath)
          break
        }
        case 'j':
          event.preventDefault()
          setQuickAdd(true)
          break
        case 't':
          event.preventDefault()
          void openDaily(today())
          setView('today')
          break
        case 'w': {
          event.preventDefault()
          const pane = state.panes[state.activePane]
          const tab = pane?.tabs[pane.active]
          if (tab) state.closeTab(state.activePane, tab.id)
          break
        }
        case '1':
          event.preventDefault()
          setView('today')
          break
        case '2':
          event.preventDefault()
          setView('notes')
          break
        case '3':
          event.preventDefault()
          setView('calendar')
          break
        case '4':
          event.preventDefault()
          setView('tasks')
          break
        case '5':
          event.preventDefault()
          setView('graph')
          break
        case '6':
          event.preventDefault()
          setView('views')
          break
      }
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
  }, [setPalette, setQuickAdd, setView, createNote, openDaily])

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
            ) : view === 'today' ? (
              <TodayView />
            ) : (
              <Panes />
            )}
          </main>

          {showInspector && <SidePanels />}
          {showAgenda && <AgendaPane />}
        </div>
      </div>

      <CommandPalette />
      <QuickAdd />
      <SettingsModal />

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast--${toast.tone}`}
            onClick={() => dismissToast(toast.id)}
          >
            <span className="toast__dot" />
            {toast.message}
          </button>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useMemo } from 'react'
import { useStone } from './store'
import { COMMANDS, buildKeymap, commandLabel, keysFor } from './commands'
import { chordFromEvent, toAccelerator } from './lib/keys'
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
import { Toasts } from './components/Toasts'
import { ColumnResizer, applyColumnWidths, useColumnResizer } from './components/ColumnResizer'

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

/** Commands that still work with a dialog open, because they manage dialogs. */
const ALWAYS_ALLOWED = new Set(['palette', 'settings'])

function platformClass(): string {
  if (window.stone.platform === 'darwin') return 'is-mac'
  if (window.stone.platform === 'win32') return 'is-win'
  return 'is-linux'
}

export function App() {
  const ready = useStone((s) => s.ready)
  const settings = useStone((s) => s.settings)
  const view = useStone((s) => s.view)
  const boot = useStone((s) => s.boot)

  const sidebarResize = useColumnResizer('sidebar', 'Sidebar width')
  const inspectorResize = useColumnResizer('inspector', 'Inspector width')
  const agendaResize = useColumnResizer('agenda', 'Agenda width')

  // Restore the dragged widths once settings have loaded.
  useEffect(() => {
    if (!settings) return
    applyColumnWidths(settings)
  }, [settings?.sidebarWidth, settings?.inspectorWidth, settings?.agendaWidth, settings])

  // Rebuilt only when the user rebinds something, not on every render.
  const keymap = useMemo(() => buildKeymap(settings?.keybindings ?? {}), [settings?.keybindings])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    document.documentElement.classList.add(platformClass())
  }, [])

  // Saves are debounced 900ms, which is right while the app runs and wrong at
  // the moment it stops: a sentence typed and immediately quit on was lost.
  useEffect(() => {
    const flush = (): void => {
      void useStone.getState().flushSaves()
    }
    window.addEventListener('beforeunload', flush)
    // ⌘Q and the dock menu start in main and never fire `beforeunload`, so main
    // holds the quit until this answers.
    const offFlush = window.stone.app.onFlush(() => useStone.getState().flushSaves())
    // A hidden window on macOS is the normal state of a running app, and the
    // most common way a session ends without `beforeunload` ever firing.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    return () => {
      window.removeEventListener('beforeunload', flush)
      offFlush()
    }
  }, [])

  // Main builds the application menu from this, so a rebound command shows the
  // chord it actually answers to rather than the one it shipped with.
  useEffect(() => {
    window.stone.menu.publish(
      COMMANDS.map((command) => {
        const [chord] = keysFor(command, settings?.keybindings ?? {})
        return {
          id: command.id,
          label: commandLabel(command, { query: '' }),
          accelerator: chord ? toAccelerator(chord) : undefined
        }
      })
    )
  }, [settings?.keybindings, settings?.vimMode, settings?.theme])

  useEffect(() => {
    // A menu item runs the same command body the keystroke does.
    return window.stone.menu.onInvoke((id) => {
      COMMANDS.find((c) => c.id === id)?.run({ query: '' })
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const chord = chordFromEvent(event)
      if (!chord) return
      const command = keymap.get(chord)
      if (!command) return

      // A dialog owns the keyboard while it is open. Without this, a chord
      // pressed inside the Claude dialog toggled the sidebar behind it and
      // `Mod+Shift+E` split an editor the user could not see. The palette is
      // the exception both ways: it opens over anything and closes itself.
      if (useStone.getState().modalOpen() && !ALWAYS_ALLOWED.has(command.id)) return

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
          <div className="dragstrip" />
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
          {showSidebar && (
            <>
              <Sidebar />
              <ColumnResizer side="right" {...sidebarResize} />
            </>
          )}

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

          {showInspector && (
            <>
              <ColumnResizer side="left" {...inspectorResize} />
              <SidePanels />
            </>
          )}
          {showAgenda && (
            <>
              <ColumnResizer side="left" {...agendaResize} />
              <AgendaPane />
            </>
          )}
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

      <Toasts />
    </div>
  )
}

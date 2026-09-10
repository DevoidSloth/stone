/**
 * The command registry.
 *
 * Every action a keystroke or the palette can trigger is declared once, here,
 * with an id, a default chord, and a body that reads the store directly rather
 * than closing over React state. That last part is what makes the list usable
 * from three places at once — the palette renders it, the window keydown
 * handler dispatches against it, and settings lists it for rebinding — without
 * any of them having to re-derive what a command *is*.
 *
 * Ids are stable strings because they are the key a user's rebinding is stored
 * under. Renaming one silently drops that binding, so don't.
 */

import type { ReactElement } from 'react'
import type { Settings } from '@shared/types'
import { useStone } from './store'
import { exportNoteToPdf } from './export-note'
import { describeError } from './lib/errors'
import { askForAnimation } from './editor/animate'
import { activeEditor } from './editor/insert'
import { insertPickedFiles } from './editor/slash'
import { noteSessions, notePathFacet, restartSession, runFenceAtCursor, runFences } from './editor/run-code'
import { markNow } from './editor/stamps'
import { today } from './lib/dates'
import { normaliseChord } from './lib/keys'
import {
  IconBoard,
  IconBook,
  IconBraces,
  IconCalendar,
  IconDownload,
  IconPrint,
  IconFolder,
  IconGraph,
  IconImage,
  IconLayers,
  IconMic,
  IconNote,
  IconOutline,
  IconPlay,
  IconPlus,
  IconProperties,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconSplit,
  IconSun,
  IconTable,
  IconTasks,
  IconTrash,
  IconWaveform,
  IconX
} from './ui/icons'

type IconComponent = (props: { size?: number }) => ReactElement

export type CommandGroup = 'Navigation' | 'Create' | 'Note' | 'Editor' | 'App'

export interface CommandContext {
  /** What the user has typed into the palette, for commands that consume it. */
  query: string
}

export interface CommandDef {
  id: string
  /** A function when the wording depends on state, e.g. a toggle's direction. */
  label: string | ((ctx: CommandContext) => string)
  group: CommandGroup
  icon: IconComponent
  /** Chords bound out of the box. Users override the whole list, not one entry. */
  defaultKeys: string[]
  /** Hidden from the palette — bindings only, for things it makes no sense to click. */
  paletteHidden?: boolean
  run: (ctx: CommandContext) => void
}

const s = (): ReturnType<typeof useStone.getState> => useStone.getState()

const THEME_NAME = { system: 'system', light: 'light', dark: 'dark' } as const

/** System → light → dark → system. */
function nextTheme(theme: Settings['theme']): Settings['theme'] {
  return theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
}

export const COMMANDS: CommandDef[] = [
  // ------------------------------------------------------------- navigation

  {
    id: 'palette',
    label: 'Search notes, or run a command',
    group: 'Navigation',
    icon: IconSearch,
    defaultKeys: ['Mod+K'],
    paletteHidden: true,
    run: () => s().setPalette(true)
  },
  {
    id: 'go-to-file',
    label: 'Go to a file',
    group: 'Navigation',
    icon: IconNote,
    defaultKeys: ['Mod+P'],
    run: () => s().setQuickOpen(s().activePane)
  },
  {
    id: 'search',
    label: 'Search the whole vault',
    group: 'Navigation',
    icon: IconSearch,
    defaultKeys: ['Mod+Shift+F'],
    run: () => s().setView('search')
  },
  {
    id: 'go-today',
    label: "Open today's note",
    group: 'Navigation',
    icon: IconLayers,
    defaultKeys: ['Mod+T'],
    run: () => void s().openDaily(today()).then(() => s().setView('today'))
  },
  {
    id: 'view-today',
    label: 'Go to today',
    group: 'Navigation',
    icon: IconLayers,
    defaultKeys: ['Mod+1'],
    run: () => s().setView('today')
  },
  {
    id: 'view-notes',
    label: 'Go to notes',
    group: 'Navigation',
    icon: IconNote,
    defaultKeys: ['Mod+2'],
    run: () => s().setView('notes')
  },
  {
    id: 'view-calendar',
    label: 'Go to calendar',
    group: 'Navigation',
    icon: IconCalendar,
    defaultKeys: ['Mod+3'],
    run: () => s().setView('calendar')
  },
  {
    id: 'view-tasks',
    label: 'Go to tasks',
    group: 'Navigation',
    icon: IconTasks,
    defaultKeys: ['Mod+4'],
    run: () => s().setView('tasks')
  },
  {
    id: 'view-graph',
    label: 'Go to the graph',
    group: 'Navigation',
    icon: IconGraph,
    defaultKeys: ['Mod+5'],
    run: () => s().setView('graph')
  },
  {
    id: 'view-views',
    label: 'Go to views',
    group: 'Navigation',
    icon: IconTable,
    defaultKeys: ['Mod+6'],
    run: () => s().setView('views')
  },
  {
    id: 'view-canvas',
    label: 'Go to canvas',
    group: 'Navigation',
    icon: IconBoard,
    defaultKeys: ['Mod+7'],
    run: () => s().setView('canvas')
  },
  {
    id: 'view-library',
    // Documents open in panes like notes; this is the gallery for browsing them
    // and for managing which folders are watched.
    label: 'Browse all documents',
    group: 'Navigation',
    icon: IconFolder,
    defaultKeys: ['Mod+8'],
    run: () => s().setView('library')
  },
  {
    id: 'library-add-folder',
    label: 'Add a document folder',
    group: 'Navigation',
    icon: IconFolder,
    defaultKeys: [],
    run: () => void s().addLibraryFolder('index')
  },
  {
    id: 'view-trash',
    label: 'Open the trash',
    group: 'Navigation',
    icon: IconTrash,
    defaultKeys: [],
    run: () => s().setView('trash')
  },
  {
    id: 'back',
    label: 'Back',
    group: 'Navigation',
    icon: IconLayers,
    // Not ⌥← as well: the global handler preventDefaults whatever it matches,
    // even mid-edit, and ⌥← is how macOS moves the caret a word left. Binding
    // it here took a system-wide text gesture away everywhere in the app.
    defaultKeys: ['Mod+['],
    paletteHidden: true,
    run: () => s().goBack()
  },
  {
    id: 'forward',
    label: 'Forward',
    group: 'Navigation',
    icon: IconLayers,
    // See Back: ⌥→ belongs to the text cursor.
    defaultKeys: ['Mod+]'],
    paletteHidden: true,
    run: () => s().goForward()
  },

  // ----------------------------------------------------------------- create

  {
    id: 'new-note',
    label: (ctx) => (ctx.query.trim() ? `Create note "${ctx.query.trim()}"` : 'Create a note'),
    group: 'Create',
    icon: IconPlus,
    defaultKeys: ['Mod+N'],
    run: (ctx) => void s().createNote(ctx.query.trim() || 'Untitled')
  },
  {
    id: 'new-task',
    label: 'Add a task',
    group: 'Create',
    icon: IconTasks,
    defaultKeys: ['Mod+J'],
    run: () => s().setQuickAdd(true)
  },
  {
    id: 'claude',
    label: (ctx) =>
      ctx.query.trim() ? `Ask Claude to draw "${ctx.query.trim()}"` : 'Ask Claude for a diagram',
    group: 'Create',
    icon: IconSparkle,
    // ⌘⇧A, next to nothing else: the editor owns ⌘⇧K, M and H, and this has to
    // work from inside a note, which is the only place its answer can land.
    defaultKeys: ['Mod+Shift+A'],
    run: (ctx) => s().setClaude(true, ctx.query.trim())
  },
  {
    id: 'claude-animation',
    label: (ctx) =>
      ctx.query.trim()
        ? `Animate "${ctx.query.trim()}" with Claude`
        : 'Animate an algorithm with Claude',
    group: 'Create',
    icon: IconPlay,
    // No chord of its own. It is a slow, deliberate thing to ask for — once a
    // page, not once a paragraph — and the palette is where it belongs.
    defaultKeys: [],
    run: (ctx) => void askForAnimation(ctx.query.trim())
  },
  {
    id: 'record',
    label: () => (s().recording ? 'Stop recording' : 'Record a lecture into this note'),
    group: 'Create',
    icon: IconMic,
    // ⌘⇧R, free in both the editor's keymap and the window's. The toggle is one
    // command rather than two because it is one button on the bar, and because
    // "stop" is the thing you reach for in a hurry.
    defaultKeys: ['Mod+Shift+R'],
    run: () => {
      const state = s()
      if (state.recording) void state.stopRecording()
      else void state.startRecording()
    }
  },
  {
    id: 'record-mark',
    label: 'Mark this moment in the recording',
    group: 'Editor',
    icon: IconWaveform,
    // Not ⌘⇧M: the editor already owns that for highlighting.
    defaultKeys: ['Mod+Shift+L'],
    run: () => {
      const result = markNow()
      if (result === 'not-recording') s().toast('Nothing is recording.', 'info')
      if (result === 'no-editor') s().toast('Put the caret in a note first.', 'error')
    }
  },
  {
    id: 'record-transcribe',
    label: 'Transcribe the recording that is playing',
    group: 'Note',
    icon: IconWaveform,
    defaultKeys: [],
    run: () => {
      const playback = s().playback
      if (!playback) {
        s().toast('Play a recording first.', 'info')
        return
      }
      void s().transcribe(playback.audio)
    }
  },
  {
    id: 'record-transcript-panel',
    label: 'Show the transcript',
    group: 'Note',
    icon: IconWaveform,
    defaultKeys: [],
    run: () => s().setSidePanel('transcript')
  },
  {
    id: 'run-code-block',
    label: 'Run the code block at the cursor',
    group: 'Editor',
    icon: IconPlay,
    // ⇧⌘⏎, next to the ⌘⏎ that makes a task. Bound here rather than in the
    // editor's own keymap: CodeMirror does not stop the event reaching the
    // window handler, so a chord in both places would run the block and then
    // immediately stop it.
    defaultKeys: ['Mod+Shift+Enter'],
    run: () => {
      const view = activeEditor()
      if (!view) return
      if (!runFenceAtCursor(view)) {
        s().toast('Put the cursor in a code block Stone knows how to run.', 'info')
      }
    }
  },
  {
    id: 'run-code-above',
    label: 'Run every code block down to the cursor',
    group: 'Editor',
    icon: IconPlay,
    defaultKeys: [],
    run: () => {
      const view = activeEditor()
      if (!view) return
      const ran = runFences(view, 'above')
      if (ran === 0) s().toast('No code blocks above the cursor.', 'info')
    }
  },
  {
    id: 'run-code-all',
    label: 'Run every code block in the note',
    group: 'Editor',
    icon: IconPlay,
    defaultKeys: [],
    run: () => {
      const view = activeEditor()
      if (!view) return
      const ran = runFences(view, 'all')
      if (ran === 0) s().toast('This note has no code blocks Stone can run.', 'info')
    }
  },
  {
    id: 'restart-code-session',
    label: 'Restart the note’s code session',
    group: 'Editor',
    icon: IconPlay,
    defaultKeys: [],
    run: () => {
      const view = activeEditor()
      if (!view) return
      const notePath = view.state.facet(notePathFacet)
      const live = noteSessions(notePath)
      if (live.length === 0) {
        s().toast('This note has no code session running.', 'info')
        return
      }
      restartSession(notePath, null)
      s().toast(
        `Restarted the ${live.map((session) => session.label).join(' and ')} session${live.length > 1 ? 's' : ''}. The next block starts from nothing.`,
        'info'
      )
    }
  },
  {
    id: 'insert-file',
    label: 'Embed an image or a PDF',
    group: 'Editor',
    icon: IconImage,
    defaultKeys: [],
    run: () => {
      const view = activeEditor()
      if (!view) {
        s().toast('Open a note first — an embed has to go somewhere.', 'info')
        return
      }
      void insertPickedFiles(view)
    }
  },
  {
    id: 'new-weekly',
    label: "Open this week's note",
    group: 'Create',
    icon: IconCalendar,
    defaultKeys: [],
    run: () => void s().openPeriodic('week')
  },
  {
    id: 'new-monthly',
    label: "Open this month's note",
    group: 'Create',
    icon: IconCalendar,
    defaultKeys: [],
    run: () => void s().openPeriodic('month')
  },

  // ------------------------------------------------------------------- note

  {
    id: 'save',
    label: 'Save this note',
    group: 'Note',
    icon: IconNote,
    defaultKeys: ['Mod+S'],
    paletteHidden: true,
    run: () => {
      const relPath = s().activeRelPath
      if (relPath) void s().saveDoc(relPath)
    }
  },
  {
    id: 'close-tab',
    label: 'Close this tab',
    group: 'Note',
    icon: IconX,
    defaultKeys: ['Mod+W'],
    paletteHidden: true,
    run: () => {
      const state = s()
      const pane = state.panes[state.activePane]
      const tab = pane?.tabs[pane.active]
      if (tab) state.closeTab(state.activePane, tab.id)
    }
  },
  {
    id: 'outline',
    label: 'Show the outline',
    group: 'Note',
    icon: IconOutline,
    defaultKeys: [],
    run: () => {
      s().setView('notes')
      s().setSidePanel('outline')
    }
  },
  {
    id: 'properties',
    label: 'Edit page properties',
    group: 'Note',
    icon: IconProperties,
    defaultKeys: [],
    run: () => {
      s().setView('notes')
      s().setSidePanel('properties')
    }
  },
  {
    id: 'code-inspector',
    label: 'Inspect the code in this note',
    group: 'Note',
    icon: IconBraces,
    defaultKeys: [],
    run: () => {
      s().setView('notes')
      s().setSidePanel('code')
    }
  },
  {
    // The manual lives in the inspector, which only the notes view has a column
    // for — so asking for it from the calendar goes to the note you were on,
    // which is also where an example would have been inserted.
    id: 'docs',
    label: 'Open the manual',
    group: 'Note',
    icon: IconBook,
    defaultKeys: [],
    run: () => {
      s().setView('notes')
      s().openDocs()
    }
  },
  {
    id: 'export-pdf',
    label: 'Export this note as a PDF',
    group: 'Note',
    icon: IconPrint,
    defaultKeys: ['Mod+Shift+P'],
    run: () => {
      const relPath = s().activeRelPath
      if (!relPath) {
        s().toast('Open a note first — there is nothing to export.', 'info')
        return
      }
      void s().withTask('export-pdf', 'Exporting the note as a PDF…', () =>
        exportNoteToPdf(relPath)
      )
    }
  },
  {
    id: 'export-vault',
    label: 'Export the whole vault',
    group: 'Note',
    icon: IconDownload,
    defaultKeys: [],
    run: () => {
      void s()
        .withTask('export-vault', 'Exporting the vault…', () => window.stone.exporter.vault())
        .then((result) => {
          if (result) s().toast(`${result.count} notes exported to ${result.folder}.`, 'success')
        })
        .catch((err) => s().toast(describeError(err), 'error'))
    }
  },

  // ----------------------------------------------------------------- editor

  {
    id: 'split',
    label: 'Split the editor',
    group: 'Editor',
    icon: IconSplit,
    defaultKeys: ['Mod+Shift+E'],
    run: () => s().splitPane()
  },
  {
    id: 'toggle-panel',
    label: 'Toggle the side panel',
    group: 'Editor',
    icon: IconOutline,
    defaultKeys: ['Mod+Shift+O'],
    run: () => s().togglePanel()
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle the sidebar',
    group: 'Editor',
    icon: IconLayers,
    defaultKeys: ['Mod+Shift+B'],
    run: () => s().toggleSidebar()
  },
  {
    id: 'vim',
    label: () => (s().settings?.vimMode ? 'Turn off vim mode' : 'Turn on vim mode'),
    group: 'Editor',
    icon: IconSettings,
    defaultKeys: [],
    run: () => void s().updateSettings({ vimMode: !s().settings?.vimMode })
  },

  // -------------------------------------------------------------------- app

  {
    id: 'theme',
    // Cycles rather than toggles. A two-way switch destroyed `system` on the
    // first click, and there was no way back to it outside Settings.
    label: () => {
      const next = nextTheme(s().settings?.theme ?? 'system')
      return next === 'system' ? 'Match the system theme' : `Use the ${THEME_NAME[next]} theme`
    },
    group: 'App',
    icon: IconSun,
    defaultKeys: [],
    run: () => void s().updateSettings({ theme: nextTheme(s().settings?.theme ?? 'system') })
  },
  {
    id: 'reindex',
    label: 'Rebuild the vault index',
    group: 'App',
    icon: IconRefresh,
    defaultKeys: [],
    run: () => {
      void s()
        .withTask('reindex', 'Rebuilding the vault index…', async () => {
          await window.stone.vault.reindex()
          await s().refreshVault()
        })
        .then(() => s().toast('Vault reindexed.', 'success'))
        .catch((err) => s().toast(describeError(err), 'error'))
    }
  },
  {
    id: 'settings',
    label: 'Open settings',
    group: 'App',
    icon: IconSettings,
    // ⌘, is a convention strong enough that its absence reads as a missing
    // feature, and nothing else was bound to it.
    defaultKeys: ['Mod+,'],
    run: () => s().setSettingsOpen(true)
  }
]

export const COMMANDS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function commandLabel(command: CommandDef, ctx: CommandContext): string {
  return typeof command.label === 'function' ? command.label(ctx) : command.label
}

/** The chords currently bound to a command, honouring the user's override. */
export function keysFor(command: CommandDef, overrides: Settings['keybindings']): string[] {
  const custom = overrides[command.id]
  return (custom ?? command.defaultKeys).map(normaliseChord).filter(Boolean)
}

/**
 * Flatten the registry into the lookup the keydown handler needs.
 *
 * Later commands win a collision, which only matters when a user has bound one
 * chord twice; the settings screen warns about that rather than silently
 * resolving it, so this is the fallback rather than the mechanism.
 */
export function buildKeymap(overrides: Settings['keybindings']): Map<string, CommandDef> {
  const map = new Map<string, CommandDef>()
  for (const command of COMMANDS) {
    for (const chord of keysFor(command, overrides)) map.set(chord, command)
  }
  return map
}

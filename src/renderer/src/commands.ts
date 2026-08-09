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
import { today } from './lib/dates'
import { normaliseChord } from './lib/keys'
import {
  IconBoard,
  IconCalendar,
  IconDownload,
  IconFolder,
  IconGraph,
  IconLayers,
  IconNote,
  IconOutline,
  IconPlus,
  IconProperties,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSplit,
  IconSun,
  IconTable,
  IconTasks,
  IconTrash,
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
    label: 'Go to documents',
    group: 'Navigation',
    icon: IconFolder,
    defaultKeys: ['Mod+8'],
    run: () => s().setView('library')
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
    defaultKeys: ['Mod+[', 'Alt+ArrowLeft'],
    paletteHidden: true,
    run: () => s().goBack()
  },
  {
    id: 'forward',
    label: 'Forward',
    group: 'Navigation',
    icon: IconLayers,
    defaultKeys: ['Mod+]', 'Alt+ArrowRight'],
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
    id: 'export-pdf',
    label: 'Export this note as a PDF',
    group: 'Note',
    icon: IconDownload,
    defaultKeys: [],
    run: () => {
      const relPath = s().activeRelPath
      if (!relPath) {
        s().toast('Open a note first.', 'error')
        return
      }
      void window.stone.exporter.pdf(relPath).then((saved) => {
        if (saved) s().toast(`Exported to ${saved}.`, 'success')
      })
    }
  },
  {
    id: 'export-vault',
    label: 'Export the whole vault',
    group: 'Note',
    icon: IconDownload,
    defaultKeys: [],
    run: () => {
      void window.stone.exporter.vault().then((result) => {
        if (result) s().toast(`${result.count} notes exported to ${result.folder}.`, 'success')
      })
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
    label: () => (s().settings?.theme === 'light' ? 'Use the dark theme' : 'Use the light theme'),
    group: 'App',
    icon: IconSun,
    defaultKeys: [],
    run: () => void s().updateSettings({ theme: s().settings?.theme === 'light' ? 'dark' : 'light' })
  },
  {
    id: 'reindex',
    label: 'Rebuild the vault index',
    group: 'App',
    icon: IconRefresh,
    defaultKeys: [],
    run: () => {
      void window.stone.vault
        .reindex()
        .then(() => s().refreshVault())
        .then(() => s().toast('Vault reindexed.', 'success'))
    }
  },
  {
    id: 'settings',
    label: 'Open settings',
    group: 'App',
    icon: IconSettings,
    defaultKeys: [],
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

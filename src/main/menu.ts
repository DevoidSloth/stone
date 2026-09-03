import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { checkForUpdates } from './updater'

/**
 * The application menu.
 *
 * Stone never called `Menu.setApplicationMenu`, so macOS handed users
 * Electron's default template — whose View menu offers Reload, Force Reload and
 * Toggle Developer Tools. ⌘R in a notes app is a footgun, and the menu that
 * shipped it had no File menu, no Preferences item, and no About Stone.
 *
 * The menu is built from the renderer's own command registry rather than a
 * second hardcoded list, because the registry is already the single source of
 * truth for what an action is called and what it is bound to. That is also what
 * keeps a menu accelerator correct after the user rebinds the command in
 * settings — a hand-maintained menu would go on advertising the old chord.
 */

export interface MenuCommand {
  id: string
  label: string
  /** Already an Electron accelerator; the renderer owns chord formatting. */
  accelerator?: string
}

/** Which commands appear where, and where the separators fall. */
const LAYOUT: Record<string, (string | null)[]> = {
  File: [
    'new-note',
    'new-task',
    'new-weekly',
    'new-monthly',
    null,
    'save',
    'insert-file',
    null,
    'export-pdf',
    'export-vault',
    null,
    'close-tab'
  ],
  Edit: [],
  View: [
    'view-today',
    'view-notes',
    'view-calendar',
    'view-tasks',
    'view-graph',
    'view-views',
    'view-canvas',
    'view-library',
    null,
    'go-today',
    'back',
    'forward',
    null,
    'toggle-sidebar',
    'toggle-panel',
    'split',
    null,
    'outline',
    'properties',
    null,
    'theme'
  ],
  Note: ['run-code-block', 'run-code-above', 'run-code-all', 'restart-code-session', null, 'claude'],
  Tools: [
    'palette',
    'go-to-file',
    'search',
    null,
    'record',
    'record-mark',
    'record-transcribe',
    null,
    'reindex',
    'vim'
  ]
}

let current: MenuCommand[] = []

function send(id: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.send('menu:invoke', id)
}

function itemsFor(section: string, byId: Map<string, MenuCommand>): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const entry of LAYOUT[section] ?? []) {
    if (entry === null) {
      // Never open or double up on a separator, since a command the renderer
      // did not report simply is not there.
      if (out.length > 0 && out[out.length - 1].type !== 'separator') out.push({ type: 'separator' })
      continue
    }
    const command = byId.get(entry)
    if (!command) continue
    out.push({
      label: command.label,
      accelerator: command.accelerator,
      click: () => send(command.id)
    })
  }
  while (out.length > 0 && out[out.length - 1].type === 'separator') out.pop()
  return out
}

export function buildAppMenu(commands: MenuCommand[] = current): void {
  current = commands
  const byId = new Map(commands.map((c) => [c.id, c]))
  const isMac = process.platform === 'darwin'

  const settings = byId.get('settings')
  const preferences: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: settings?.accelerator ?? 'CommandOrControl+,',
    click: () => send('settings')
  }

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Stone' },
        { type: 'separator' },
        preferences,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Stone' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Stone' }
      ]
    })
  }

  template.push({
    label: '&File',
    submenu: [
      ...itemsFor('File', byId),
      ...(isMac
        ? [{ type: 'separator' as const }, { role: 'close' as const }]
        : [
            { type: 'separator' as const },
            preferences,
            { type: 'separator' as const },
            { role: 'quit' as const, label: 'Exit' }
          ])
    ]
  })

  template.push({
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      ...(isMac
        ? ([
            { type: 'separator' },
            { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
          ] as MenuItemConstructorOptions[])
        : [])
    ]
  })

  template.push({
    label: '&View',
    submenu: [
      ...itemsFor('View', byId),
      { type: 'separator' },
      // Zoom is the accommodation people reach for most, and there was no way
      // to reach it: no menu, and no accelerators registered anywhere.
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })

  template.push({ label: '&Note', submenu: itemsFor('Note', byId) })
  template.push({ label: '&Tools', submenu: itemsFor('Tools', byId) })

  template.push({
    label: '&Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ]
      : [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }]
  })

  template.push({
    role: 'help',
    submenu: [
      {
        label: 'Check for Updates…',
        click: () => checkForUpdates(true)
      },
      { type: 'separator' },
      {
        label: 'Stone on GitHub',
        click: () => void shell.openExternal('https://github.com/DevoidSloth/Stone')
      },
      { type: 'separator' },
      {
        // Not in the View menu, where Electron's default put it and where ⌘R
        // sat next to it. Developer tools belong behind a deliberate reach.
        label: 'Toggle Developer Tools',
        accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
      }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

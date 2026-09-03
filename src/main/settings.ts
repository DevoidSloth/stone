import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  theme: 'system',
  accentHue: 210,
  dailyFolder: 'Journal',
  dailyFormat: 'yyyy-MM-dd',
  weeklyFolder: 'Journal/Weekly',
  monthlyFolder: 'Journal/Monthly',
  inboxFolder: 'Notes',
  attachmentsFolder: 'Attachments',
  templateFolder: 'Templates',
  dailyTemplate: null,
  editorFont: 'sans',
  editorFontSize: 16,
  sidebarWidth: 240,
  inspectorWidth: 300,
  agendaWidth: 300,
  editorWidth: 708,
  showStrataRail: false,
  showCanvas: false,
  weekStartsOn: 1,
  vimMode: false,
  keybindings: {},
  spellcheck: true,
  remindersEnabled: true,
  reminderLeadMinutes: 10,
  snapshotsEnabled: true,
  captureShortcut: 'CommandOrControl+Shift+Space',
  trayEnabled: true,
  clipperEnabled: false,
  clipperPort: 41999,
  clipperToken: '',
  clipFolder: 'Clippings',
  cssSnippets: [],
  themeFolder: 'Themes',
  activeTheme: null,
  enabledPlugins: [],
  pdfPageSize: 'A4',
  pdfMargin: 18,
  pdfCoverPage: true,
  pdfToc: true,
  pdfHeaderFooter: true,
  pdfAuthor: '',
  claudeModel: 'sonnet',
  claudeCommand: null,
  claudeMode: 'diagram',
  claudeTools: { write: false, web: false, shell: false },
  codeRunners: {},
  codeRunTimeout: 30,
  codeRunConfirmed: false,
  codeNotebook: true,
  whisperCommand: null,
  whisperModel: '',
  whisperLanguage: 'auto',
  audioFolder: 'Attachments/Recordings',
  audioAutoStamp: true,
  audioTranscribeOnStop: true,
  audioFollow: true,
  libraryFolders: [],
  favorites: [],
  savedViews: [],
  calendars: [],
  icsSubscriptions: [],
  firstRunComplete: false
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cache = { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

/**
 * The settings already in memory, without awaiting.
 *
 * For the few callers that cannot be async — the protocol handler runs per
 * request and must decide synchronously whether a path is allowed. Returns the
 * defaults before the first load, which denies rather than over-permits.
 */
export function peekSettings(): Settings {
  return cache ?? DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  const next = { ...current, ...patch }
  cache = next
  const file = settingsFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  // Temp-and-rename so a crash mid-write cannot leave unparseable settings.
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tmp, file)
  return next
}

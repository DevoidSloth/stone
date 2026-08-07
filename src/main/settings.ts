import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  theme: 'light',
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
  editorWidth: 708,
  showStrataRail: false,
  weekStartsOn: 1,
  vimMode: false,
  spellcheck: true,
  remindersEnabled: true,
  reminderLeadMinutes: 10,
  snapshotsEnabled: true,
  cssSnippets: [],
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

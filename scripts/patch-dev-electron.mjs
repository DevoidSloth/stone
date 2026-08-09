/**
 * Teach the development Electron binary how to ask for calendar access.
 *
 * `npm run dev` does not run Stone.app — it runs the stock
 * node_modules/electron/dist/Electron.app, whose Info.plist carries no
 * NSCalendars*UsageDescription keys. macOS refuses to show a permission prompt
 * for a process that has not declared why it wants the data, so in development
 * the calendar silently returns nothing no matter what the code does, while the
 * packaged build works fine. The usage strings live in electron-builder.yml,
 * which only applies at package time, so they are mirrored in here.
 *
 * Modifying the plist does not invalidate anything: the stock Electron bundle
 * is linker-signed with its Info.plist unsealed, so there is no signature
 * binding the file's contents.
 *
 * Runs from `postinstall`, and is safe to run repeatedly.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plist = path.join(
  root,
  'node_modules/electron/dist/Electron.app/Contents/Info.plist'
)

const CALENDAR_REASON =
  'Stone shows your Apple Calendar events alongside your notes and tasks, and writes events you create in Stone back to Calendar.'

const KEYS = {
  NSCalendarsUsageDescription: CALENDAR_REASON,
  NSCalendarsFullAccessUsageDescription: CALENDAR_REASON,
  NSRemindersUsageDescription: 'Stone can mirror tasks into Reminders.',
  NSAppleEventsUsageDescription:
    'Stone uses Apple Events to read your calendars through EventKit.'
}

if (process.platform !== 'darwin') process.exit(0)

if (!existsSync(plist)) {
  // Electron is a devDependency; a production install legitimately has none.
  process.exit(0)
}

let changed = 0

for (const [key, value] of Object.entries(KEYS)) {
  const present =
    spawnPlist(['-c', `Print :${key}`]) !== null

  const command = present ? `Set :${key} ${escape(value)}` : `Add :${key} string ${escape(value)}`
  if (spawnPlist(['-c', command]) !== null) changed += present ? 0 : 1
}

if (changed > 0) {
  console.log(`Added calendar usage strings to the development Electron build.`)
}

function escape(value) {
  // PlistBuddy takes the value as a bare argument; quoting keeps the spaces.
  return `"${value.replace(/"/g, '\\"')}"`
}

function spawnPlist(args) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', [...args, plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return null
  }
}

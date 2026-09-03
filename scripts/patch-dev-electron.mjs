/**
 * Make the development Electron binary look and behave like Stone.
 *
 * `npm run dev` does not run Stone.app — it runs the stock
 * node_modules/electron/dist/Electron.app. Two things follow from that, and
 * both are fixed here by editing that bundle in place:
 *
 *   - It carries no NSCalendars*UsageDescription keys, and macOS refuses to
 *     show a permission prompt for a process that has not declared why it wants
 *     the data. So in development the calendar silently returns nothing no
 *     matter what the code does, while the packaged build works fine. The usage
 *     strings live in electron-builder.yml, which only applies at package time,
 *     so they are mirrored in here.
 *
 *   - It is named Electron and carries Electron's icon, which is what the menu
 *     bar, the dock and Cmd-Tab then show all day. The name comes from the
 *     bundle rather than from app.setName(), so it can only be fixed here; the
 *     icon is replaced here too, and set again at runtime in src/main/index.ts
 *     because macOS caches the icon it read at launch.
 *
 * Modifying the bundle does not invalidate anything: the stock Electron build
 * is linker-signed, which seals the executable and neither the Info.plist nor
 * the resources beside it.
 *
 * Runs from `postinstall`, and is safe to run repeatedly.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/Resources')
const plist = path.join(
  root,
  'node_modules/electron/dist/Electron.app/Contents/Info.plist'
)
const sourceIcon = path.join(root, 'build/icon.png')
// The stock bundle names its icon this, and Info.plist points CFBundleIconFile
// at it, so overwriting it is less invasive than adding a file and repointing.
const devIcon = path.join(resources, 'electron.icns')
// Records which icon.png the .icns above was rendered from, so a changed icon
// is picked up and an unchanged one does not pay for iconutil on every install.
const stamp = path.join(resources, '.stone-icon-source')

const CALENDAR_REASON =
  'Stone shows your Apple Calendar events alongside your notes and tasks, and writes events you create in Stone back to Calendar.'

const KEYS = {
  // The menu bar, the dock and Cmd-Tab all read the app's name from here.
  CFBundleName: 'Stone',
  CFBundleDisplayName: 'Stone',
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
  console.log('Renamed the development Electron build and gave it calendar usage strings.')
}

syncIcon()

/**
 * Render build/icon.png into the bundle's .icns. `sips` and `iconutil` ship with
 * macOS, which is the same reason build/icon.png is a plain PNG: no toolchain
 * beyond what a Mac already has.
 */
function syncIcon() {
  if (!existsSync(sourceIcon)) return

  const digest = createHash('sha256').update(readFileSync(sourceIcon)).digest('hex')
  const current = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null
  if (current === digest && existsSync(devIcon)) return

  const work = mkdtempSync(path.join(os.tmpdir(), 'stone-icon-'))
  const iconset = path.join(work, 'icon.iconset')

  try {
    execFileSync('/bin/mkdir', ['-p', iconset])
    // The sizes iconutil expects; anything missing is simply absent from the
    // .icns, so the list has to be complete rather than representative.
    for (const size of [16, 32, 128, 256, 512]) {
      render(size, path.join(iconset, `icon_${size}x${size}.png`))
      render(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`))
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', devIcon])
    writeFileSync(stamp, `${digest}\n`)
    console.log('Gave the development Electron build the Stone icon.')
  } catch (error) {
    // A dev-only cosmetic; never fail an install over it.
    console.warn(`Could not set the development icon: ${error.message}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function render(size, out) {
  execFileSync(
    '/usr/bin/sips',
    ['-z', String(size), String(size), sourceIcon, '--out', out],
    { stdio: 'ignore' }
  )
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

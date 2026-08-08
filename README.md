# Stone

Notes, tasks, and a calendar over plain markdown files.

The premise: a note, a task, and an event are all just things that do or do not
sit on a date. Obsidian treats the calendar as a plugin afterthought; Notion can
model time but only inside slow cloud databases. Stone keeps all three in one
place, on top of files you own.

Everything is a `.md` file in a folder you choose. Open that folder in Obsidian,
VS Code, or a text editor and it reads exactly the same. There is no database,
no proprietary format, and nothing to export.

## Running it

```bash
npm install
npm run dev          # development, with hot reload
npm run build        # bundle main, preload, and renderer
npm run typecheck    # tsc over both projects
```

Packaging:

```bash
npm run dist:win     # NSIS installer, x64 + arm64
npm run dist:mac     # universal DMG
```

## How it stores things

### Tasks

A task is a markdown checkbox. Write one in any note and it appears in the Tasks
view and on the calendar:

```markdown
- [ ] Finish the parser @2026-08-12 14:30 ~2026-08-10 !high +90m #compilers
```

| Token | Means |
| --- | --- |
| `@2026-08-12` | Due date, optionally with a `HH:MM` time |
| `~2026-08-10` | Scheduled — when you plan to work on it |
| `!urgent` `!high` `!medium` `!low` | Priority |
| `+90m` `+2h` `+1d` | Estimate |
| `#tag` | Tag |

Status comes from the checkbox: `[ ]` todo, `[/]` in progress, `[x]` done,
`[-]` cancelled. Obsidian Tasks emoji syntax (📅 ⏳ ⏫ 🔺 🔽 ✅) is read on import,
but Stone always writes the token form.

### Events

A note becomes an event when its frontmatter gives it a date **and a time**:

```markdown
---
date: 2026-08-09
start: "17:00"
end: "17:30"
location: Anywhere quiet
---
```

Quote the times. `gray-matter` parses frontmatter with js-yaml 3, which still
follows the YAML 1.1 sexagesimal rule — an unquoted `17:00` becomes the integer
1020. Stone compensates for this when reading, but quoting keeps the file
unambiguous for every other tool.

A bare `date:` only files the note under that day. Without that rule every daily
note would become an all-day event and bury the real calendar.

### Links

`[[Wikilinks]]` resolve by filename or title, and each note lists its backlinks.
Renaming a note rewrites every link that pointed at it.

## Calendar integration

Stone reads four sources and merges them into one view.

| Source | Platform | How |
| --- | --- | --- |
| Vault notes and tasks | Both | Parsed from frontmatter and checkboxes |
| Apple Calendar | macOS | EventKit through a JXA bridge — read and write |
| Outlook / Windows Calendar | Both | Microsoft Graph, device-code sign-in — read and write |
| Any ICS feed | Both | Subscribed by URL, read-only, cached for 10 minutes |

**ICS is the zero-configuration path** and works immediately on both platforms.
Google Calendar publishes a secret iCal address under Settings › Integrate
calendar; Outlook has one under Settings › Shared calendars. Paste it into
Settings › Subscribe to a calendar.

**Apple Calendar** is driven through EventKit rather than by scripting
Calendar.app, because Apple Events are slow enough to make a year-wide query
visibly stall. macOS asks for calendar permission the first time.

Since macOS 14 that permission comes in two grades, and only **full access** can
read events — write-only lets Stone add an event but shows you an empty
calendar. Stone asks for full access and names the difference if it only has the
lesser one; if you see that message, switch it under System Settings › Privacy &
Security › Calendars.

**Microsoft Graph** needs a client ID from your own free Azure app registration
(public client, `Calendars.ReadWrite` scope). Stone deliberately does not ship a
shared one: that would put every install behind a single quota and a single
revocation. The refresh token is stored through Electron's `safeStorage`, so it
sits in the OS keychain rather than in a plain file.

## Sync

Stone does not implement a sync protocol. The vault lives inside a folder that
iCloud Drive, Google Drive, Dropbox, or OneDrive is already replicating, and the
first-run screen detects those folders for you.

What Stone does instead is make writes safe for that arrangement:

- **Atomic writes.** Every save goes to a temp file, is flushed with `fsync`,
  then renamed over the target. A sync client can never observe a half-written
  note.
- **Conflict copies.** Saves carry a content hash of the version that was read.
  If the file on disk no longer matches, the remote version is preserved as
  `Note (conflict 2026-08-06T12-30-00).md` before writing. Nothing is
  overwritten silently.
- **Debounced watching.** Sync engines rewrite files in bursts, so every path is
  debounced and settled before reindexing.
- **Deletes go to `.trash`** inside the vault, not to `unlink`.

For iCloud, turn off "Optimise Mac Storage" for the vault folder; for Drive and
OneDrive, mark it available offline. Stone skips `.icloud` placeholder stubs, but
an evicted file is a file it cannot read.

## Keyboard

| Key | Does |
| --- | --- |
| `Ctrl/Cmd K` | Search everything, or run a command |
| `Ctrl/Cmd J` | Quick-add a task from anywhere |
| `Ctrl/Cmd T` | Jump to today |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd 1-5` | Today, Notes, Calendar, Tasks, Graph |
| `Ctrl/Cmd B` `I` | Bold, italic |
| `Ctrl/Cmd Shift M` | Highlight |
| `Ctrl/Cmd Enter` | Turn the line into a task, or cycle its status |

## Formatting

Highlight any text and a formatting bar appears over it, the way Obsidian's
does: bold, italic, strikethrough, `==highlight==`, inline code, a link or a
`[[wikilink]]`, heading levels, quote, list, and task — plus **Tx** to strip
inline markup back out.

Every button is a toggle and shows its state, so pressing bold on text that is
already bold unwraps it rather than nesting a second pair of asterisks. The bar
waits for the pointer to come up before it appears, so it never chases a drag,
and `Esc` dismisses it without losing the selection.

## Architecture

```
src/
  shared/          types and the task syntax parser, used by both processes
  main/
    vault/         indexer, file watcher, atomic writes, link graph
    calendar/      macOS EventKit bridge, Microsoft Graph, ICS, merge service
    cloud.ts       detects iCloud/Drive/Dropbox/OneDrive folders
    ipc.ts         every channel, each returning {ok, data} or {ok, error}
  preload/         the only bridge; contextIsolation on, nodeIntegration off
  renderer/        React 19, Zustand, CodeMirror 6
```

The renderer never touches the filesystem. Paths crossing IPC are checked
against the vault root, so a crafted `..` cannot escape it, and the renderer
runs under a CSP that blocks network access entirely — nothing in the UI needs
it.

The editor is CodeMirror 6 with live-preview decorations: syntax markers are
hidden while the caret is elsewhere and revealed the moment it enters the line.
The document itself is never rewritten, so what you edit is exactly what is on
disk. Frontmatter folds to a row of property names, because raw `---` fences are
noise on a page you are reading.

## Graph

The Graph view plots every note as a node and every resolved `[[wikilink]]` as
an edge. Node size follows link count; hovering isolates a note and its
neighbours; the search box highlights matches without hiding context. Click a
node to open it, drag to reposition, scroll to zoom.

It is a canvas with a small force simulation written by hand — no physics
library, because d3-force would roughly double the renderer bundle for one
screen. Repulsion uses a uniform spatial grid rather than comparing every pair,
so cost stays near-linear instead of the O(n²) that makes naive versions stall
past a few hundred notes. The layout cools and stops rather than spinning
forever, and the view auto-frames once it has settled.

## Known gaps

- No PDF or image embedding beyond standard markdown image syntax.
- Google Calendar is read-only, via ICS subscription. Two-way Google sync would
  need OAuth and a verified app.
- Recurring events from ICS feeds are expanded up to 2000 occurrences per
  series, which is a guard against malformed `RRULE`s rather than a real limit.
- The week view lays overlapping events on top of each other instead of
  side-by-side columns.

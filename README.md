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
| `Ctrl/Cmd 1-8` | Today, Notes, Calendar, Tasks, Graph, Views, Canvas, Documents |
| `Ctrl/Cmd B` `I` | Bold, italic |
| `Ctrl/Cmd Shift M` | Highlight |
| `Ctrl/Cmd Enter` | Turn the line into a task, or cycle its status |

Every one of those is rebindable. Settings › Keyboard lists each command with the
chords bound to it; click one to remove it, or record another. A command can
answer to several, and a chord bound twice is called out rather than silently
resolved. Bindings are stored by command id, so they survive an update.

## Capture

Quick-add used to answer only when Stone had focus, which is the moment you are
least likely to need it. Three routes now bring it in from outside:

- a **global shortcut** — `Ctrl/Cmd Shift Space` by default, rebindable, and it
  says so plainly if another app already owns the combination;
- a **menu-bar icon**, so capture survives the window being closed;
- **`stone://` links** — `stone://capture?text=…`, `stone://open?path=…`,
  `stone://daily` — which any script or app can fire.

### The web clipper

Turn it on in Settings › Capture and Stone listens on `127.0.0.1` for pages sent
from the browser. Copy the bookmarklet it gives you into a bookmark; clicking it
on any page sends your selection, or the whole article when nothing is selected,
into your clippings folder as markdown with the source URL in frontmatter.

That is an inbound socket in an app that otherwise has none, so it is fenced in:
off unless you turn it on, bound to loopback so nothing off the machine can
reach it, and every request carries a secret only your bookmarklet knows —
because any page in your browser can reach a localhost port, and the token is
what separates yours from a site that guessed the number. Reissue it whenever
you like; the old bookmarklet stops working.

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

## Databases

A view is a saved query with a shape — table, board, gallery, list, timeline —
over the notes you already have. The rows are notes, the columns are frontmatter
keys Stone inferred a type for.

Views also **write back**. Drag a card between board columns and it rewrites that
note's grouping property; edit a table cell and it edits one line of YAML,
leaving the rest of the file byte-identical. **New** creates a note that already
satisfies the view's filters, so it does not vanish the moment it is created.
Columns that describe the file rather than live in it — `folder`, `edited` — stay
read-only, because you change those by moving or editing the note.

### Relations and rollups

A `[[link]]` in a frontmatter property is a *typed* link: the key says what the
relationship is.

```markdown
---
project: "[[Website rebuild]]"
---
```

Both notes then show it in the Relations panel — outward, and inward on the note
being pointed at, which is the half nobody writes by hand. A project note never
lists its own tasks, and that incoming list is what you actually want.

A **rollup** column follows one of those relations and summarises the far side:
count, sum, average, min, max, earliest, latest, or a list. "Open tasks per
project" is a rollup over the incoming `project` relation.

Write the value quoted. `project: [[X]]` unquoted is a nested sequence in YAML,
not a string — Stone reads both, but the quoted form is what every other tool
will understand.

## Queries inside notes

A ```` ```stone ```` block is a live query, rendered where you wrote it:

```stone
from: Projects
where: status is active
sort: edited desc
as: list
limit: 10
```

or naming a view you already saved:

```stone
view: Active projects
```

`from`, `source` (`notes` or `tasks`), `where`, `sort`, `group`, `columns`, `as`,
and `limit`. The syntax is `key: value` lines because that is the same shape as
the frontmatter above it, it stays readable in any other editor, and a typo
produces one wrong line rather than swallowing the query.

This is what makes a daily note assemble itself. It is always a lens — a query
block never writes.

## Canvas

An infinite board for the thinking that is not linear: cards you place yourself,
notes embedded as cards, and arrows between them. Drag from any edge of a card to
connect it; scroll to pan, `Cmd`-scroll to zoom.

It saves as a `.canvas` file in the vault in the **JSON Canvas** format
(jsoncanvas.org), which is the same format Obsidian uses — so a board made here
opens there, and vice versa. Anything in the file Stone does not understand is
carried through a save untouched rather than dropped.

## Documents

PDFs and GoodNotes notebooks, indexed where they already live. Point Stone at the
iCloud folder GoodNotes writes to and it reads them in place — nothing is moved,
copied, or rewritten. A folder can instead be set to copy into the vault, if you
would rather the vault stayed self-contained.

Text is extracted so documents turn up in search alongside notes. For a PDF that
means the text layer; for a GoodNotes package it means an imported PDF if the
notebook was built from one, and the handwriting-recognition results otherwise.
PDFs render in the app through Chromium's own viewer; a GoodNotes document opens
in GoodNotes, which is the only thing that can edit one.

Be clear about the limits, because they decide whether a document is findable:

- **Scanned PDFs have no text and never will here.** There is no OCR. They are
  findable by name.
- **Subsetted CID fonts** decode to glyph indices rather than letters. Stone
  detects that and indexes nothing rather than filling search with noise, so
  those are also name-only.
- **The GoodNotes format is undocumented**, so everything read out of a package
  is inference and a future GoodNotes release may change it. When that happens
  the document still appears with its name, date, and a working "open in
  GoodNotes" — that is the floor it degrades to, not an error.
- **An evicted iCloud file is not on the machine.** Those are listed and marked
  as not downloaded rather than silently omitted.

## Themes and plugins

A **theme** is one `.css` file in the vault's theme folder, chosen in Settings;
snippets still stack on top of whichever theme is in force. One is replaced, the
others accumulate — which is the only real difference between them.

A **plugin** is a folder under `.stone/plugins` with a `manifest.json` and a
`main.js`:

```js
stone.addCommand({
  id: 'count',
  name: 'Count my notes',
  callback: async () => {
    const notes = await stone.vault.list()
    stone.notice(`You have ${notes.length} notes.`)
  }
})
```

Plugins do **not** run in Stone's window. Obsidian's run in its renderer with
full access to the DOM and to Node, which is why its ecosystem is so large and
why a malicious plugin there owns the machine. Stone's renderer is locked down —
`contextIsolation`, no `nodeIntegration`, and a CSP with `script-src 'self'` that
makes injected script a non-event — and widening that so third-party code could
be loaded into it would trade away the app's best security property for a
feature.

So a plugin runs in an offscreen window with no vault access, no network, and no
view of the interface. Everything it can actually do arrives back over IPC as a
small set of verbs, each checked against the permissions its manifest declared
and you approved when you switched it on. Ask to write without `vault-write` and
the call is refused.

The honest cost: a plugin cannot draw its own interface, because it has no DOM to
draw into. It can add commands, respond to events, and read and write notes.

## Known gaps

- Google Calendar is read-only, via ICS subscription. Two-way Google sync would
  need OAuth and a verified app.
- Recurring events from ICS feeds are expanded up to 2000 occurrences per
  series, which is a guard against malformed `RRULE`s rather than a real limit.
- The week view lays overlapping events on top of each other instead of
  side-by-side columns.
- No OCR, so scanned PDFs are findable by name only. See **Documents** for the
  rest of what does and does not get indexed.
- Plugins cannot draw interface, by design. See **Themes and plugins**.
- Canvas has no multi-select marquee or undo of its own yet; deleting a card is
  the one destructive action and it takes the selection, not the board.
- There is still no mobile app. The vault is markdown in a synced folder, so
  Obsidian on a phone reads the notes — but not Stone's tasks or calendar.

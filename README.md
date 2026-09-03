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
npm run dist:mac     # universal DMG — compiles, signs, and verifies the signature
npm run verify:mac   # re-check an already-built dmg or an installed .app
```

`dist:mac` refuses to build without a signing certificate, because an unsigned
macOS build takes the user's calendar permission with it: macOS pins a privacy
grant to the app's code signature, and with no certificate to anchor to it pins
to the binary itself, so the next update silently revokes the access the last
one was granted. Create one — it is self-signed and takes a second — with:

```bash
npm run signing-cert                      # once, per machine
./scripts/make-signing-cert.sh --export   # print the secrets CI needs
```

Releases are built by `.github/workflows/release.yml` on a `v*` tag, and must
sign with that **same** certificate, so it is worth setting the two repository
secrets that `--export` prints. A self-signed certificate keeps the calendar
grant alive but does not clear Gatekeeper; that needs an Apple Developer ID and
notarisation, which `scripts/sign-mac.mjs` picks up automatically if the
keychain has one.

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
| `Ctrl/Cmd Shift Enter` | Run the code block the cursor is in |

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

### Hyperlinks

Three routes to `[text](url)`, because the bar only exists once something is
selected:

- **`Ctrl/Cmd Shift K`** wraps the selection, or drops an empty `[]()` with the
  caret in the address. Not `Cmd K` — that is the command palette, and shadowing
  it in the editor is a worse trade than one extra modifier. It *does* shadow
  CodeMirror's own `Cmd Shift K` (delete line), which is the price of the chord.
- **Paste a URL over selected text** and the text becomes the label rather than
  being replaced — the behaviour every other editor has. A paste that is not a
  URL, or over a selection that already contains brackets, is left alone.
- **`/hyperlink`** in the slash menu, for starting one from nothing. `/link to a
  note` is still the `[[wikilink]]` next to it.

Selecting a bare URL and pressing the shortcut makes *it* the target and leaves
the caret in the empty label, which is the order you actually work in when you
paste first and name it afterwards.

### Tables

A table is a grid you type into, not pipes you count. Click any cell and edit it
in place; the markdown underneath is rewritten and **realigned** on every commit,
so the source stays readable in any other editor rather than drifting a
character per keystroke.

| Key | Does |
| --- | --- |
| `Tab` / `Shift Tab` | Next / previous cell. From the last cell, `Tab` adds a row |
| `Enter` | New row below |
| `Alt Cmd ↓` / `↑` | Add a row below / above |
| `Alt Cmd →` / `←` | Add a column right / left |
| `Alt Cmd ⌫` | Delete this row (`Shift` for the column) |
| `Esc` | Leave the table, back to the note |

Only cells are editable — the header row defines the table's shape, so deleting
it, or the last remaining row or column, is refused rather than silently
producing something that is no longer a table.

Two details that are load-bearing rather than decorative. A cell shows rendered
markup until you put the caret in it and its own markdown once you do, because
typing against text that re-renders under the caret is worse than seeing the
asterisks. And the document is written on boundaries — blur, `Tab`, `Enter`, a
structural key — never on each keystroke, since a write rebuilds the table and
would pull the node out from under the caret. A cell edit and the row it
triggers are one write, so `Tab` off the last cell is one undo step.

Alignment colons, a malformed rule row and an escaped pipe can still only be
fixed in the source, so **Markdown** on the table's top-right corner (on hover)
drops it back to raw text. Move the caret out of the table to return to the grid.

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

## Running code blocks

A fenced block in a language Stone knows how to run gets a Run button under it,
and `Ctrl/Cmd Shift Enter` runs the one the cursor is in. Output appears below
the block as it is printed — stdout in the body colour, stderr in red — with the
exit status and how long it took. Stop kills it. Nothing is written back into
the note: a run is something you did to the file, not an edit of it, so the
markdown on disk stays exactly what you typed.

JavaScript, TypeScript, Python, Bash, Zsh, PowerShell, Ruby, PHP, Perl, Lua, R,
Go, Rust, C, C++, Swift and Java ship with a command. Each one is a single shell
line in Settings › Code, so a machine with pyenv, a project that wants `bun`
instead of `node`, or a language nothing here lists is one field to fill in:

| Placeholder | Is |
| --- | --- |
| `{file}` | the block, written to a scratch file |
| `{dir}` | the folder that file sits in |
| `{name}` | its base name, for compilers that emit a binary |

Java is three things in one fence, so Stone reads the block before running it.
A block with a `main` is a program: it goes through the source-file launcher,
which needs no `javac` step and leaves no class files behind, and on Java 25
that includes a compact source file — a bare `void main()` with no class around
it. The launcher picks the class by file name, so the scratch file is named
after whichever type declares `main` and the entry point need not be the first
thing you wrote; a block declaring a package is compiled and started by its
qualified name instead, that being the one thing the launcher will not do.

A block with no `main` is not a program, and notes are full of those. Where it
is only declarations — a couple of classes off a slide — it is compiled: the
errors are the point, and it says plainly that nothing ran. Where statements sit
loose among the declarations, the way a textbook example puts a class next to
the lines that exercise it, it is a script, and jshell runs it. Your block is
written out untouched either way. Two things follow from jshell being a REPL:
it does not echo the value of an expression loaded from a file, so print what
you want to see, and it reports an error without failing, so a red error and a
zero exit status can appear together.

The block runs through your login shell, which is what lets it find the
interpreters your terminal finds — an app launched from the Finder inherits a
PATH with no nvm, no pyenv and no homebrew in it. It runs in the note's folder,
with your permissions, and it can do anything you can. That is why the first run
asks first: a note is not always something you wrote, and a fenced block in a
clipped web page is a program by a stranger. The answer is remembered, and
Settings › Code takes it back.

Runs stop at a time limit — thirty seconds out of the box — and the whole
process group is killed, so a shell line that spawns something else does not
leave it behind.

## Program figures

Four fences for the pictures a programmer draws on a whiteboard: what refers to
what, what is in memory, what shape a tree is, and what an algorithm does over
time. They render in the editor as you type, print into an export, and are plain
text in the file like everything else, so a note that draws one still reads as
source in any other editor.

Mermaid stays the right tool for a flowchart or a class diagram. These are for
the three things it cannot do: a pointer, a lopsided binary tree, and a
sequence of states.

### `memory` — stack, heap, and the pointers between

```memory
title: Reversing a linked list
stack:
  reverse(head):
    prev -> null
    curr -> n2 *
heap:
  n1 Node { val: 1, next: null }
  n2 Node { val: 2, next -> n1 }
  n3 Node { val: 3, next -> n2 }
```

Sections are `stack:`, `heap:` and `globals:`. A box is written one of four
ways:

| Form | Is |
| --- | --- |
| `id Type { field: value, field -> target }` | Named fields, one per row |
| `id Type:` *(fields indented under it)* | The same, when it gets long |
| `id [ a, ->b, . ]` | An array — slots numbered underneath |
| `id ( a, ->b )` | A pair — the same slots, unnumbered |

A slot or a field may point at a box, which is what a bucket table, an adjacency
list and a cons cell are all made of. `-> null` (or `.` in a slot) draws a
struck slot; `-> arr[2]` points at one cell of an array.

**Nothing is positioned.** The heap lays itself out by following its own
pointers: an object nothing points at starts a row, its spine continues that
row, and any other pointer starts a new one. A linked list comes out as a chain
across the page, a tree as a fan, with no coordinates in the source. The spine
is a field called `next`, `cdr`, `tail`, `rest`, `link`, `succ`, `after` or
`down` if there is one, otherwise the last slot of a pair — so a cons cell runs
along and its `car` drops, which is the convention. A pointer that goes
backwards is routed underneath rather than across.

Two one-liners cover the common chains: `list: 1 2 3` builds `Node { val, next }`
boxes, and `pairs: 1 2 3` builds cons cells.

### Cons cells

The pair form is the SICP picture, and `pairs:` gets you one in a line:

```memory
title: (define x (list 1 2 3))
globals:
  x -> p1
pairs: 1 2 3
```

Write the pairs out when the structure is not a flat list — a shared tail, a
cycle, a `car` that is itself a list:

```memory
heap:
  p1 ( ->q1, ->p2 )
  p2 ( 3, . )
  q1 ( 1, ->q2 )
  q2 ( 2, . )
```

### `boxes` — what refers to what

The other thing "box and pointer" means: the object diagram you draw for a Java
or Python program. No stack, no heap, no boundary between them — those are facts
about storage, and this picture is about references.

```boxes
b -> board

board CBoard:
  cells -> grid

grid Int[][] [ ->r0, ->r1 ]

r0 Int[] [ 1, 2, 3 ]
r1 Int[] [ 4, 5, 6 ]
```

Three shapes, and the conventions are fixed rather than optional:

- **A variable** is `name -> target`: a small box with its name outside it,
  because the name is what the box is *called*, not what it holds. `-> null`
  strikes it through.
- **An object** is `id Type:` with its fields indented, or `id Type { … }` on one
  line. **The title is the type**, centred. The `id` never appears in the
  drawing — it is only how the source wires the arrows up, and in the program
  there is no such name.
- **A list** is `id Type [ … ]`, drawn as a column: type, then **the length**,
  then one row an element. An element is a value or `->target`.

Everything else is shared with `memory` — the same `#red`/`*`/`~` annotations,
the same pointer-following layout, the same errors naming the line. A `stack:`
or `heap:` section is refused here and told to go and be a `memory` block.

Field names are drawn inside their row rather than outside the box, which is the
one place this departs from how the diagram is usually drawn by hand; it keeps a
box self-contained so the layout can move it without dragging labels around.

A pointer to a box that does not exist is an error naming the line, rather than
a silently missing arrow — a diagram where a typo looks like an unset pointer is
worse than no diagram.

### `tree` — the shapes that arrive as arrays

```tree
bst: 50 30 70 20 40 60 80
traverse: inorder
```

| Directive | Builds |
| --- | --- |
| `bst: 50 30 70` | Inserts in the order given |
| `heap: 9 7 8 3` | An array as a complete binary tree, indices labelled |
| `level: 1 2 3 . . 4 5` | Level order with `.` for a missing child |
| *(indented outline)* | Anything that is not an array — a parse tree, a trie |

An empty slot is drawn, not omitted, and a parent sits over the midpoint of its
slots rather than its children — so a node with one child leans the way it
should. That is the whole reason not to use a `flowchart` here.

`traverse: inorder` (or `preorder`, `postorder`, `level`) numbers the nodes in
visit order and captions the sequence.

### `algo` — an algorithm, running

```algo
title: Bubble sort
array: 5 3 8 1 9
speed: 500
---
note Walk the pairs, swapping any out of order
compare 0 1
swap 0 1
compare 1 2
mark 4 sorted
```

A structure — `array:`, `stack:`, `queue:`, `list:`, or `bst:`/`heap:`/`level:`
for a traversal over a tree — then one step per line. Every step is a frame, and
the transport under the figure plays, steps and scrubs them.

| Step | Does |
| --- | --- |
| `compare i j` | Lights those slots for one frame |
| `swap i j` | Swaps them |
| `set i v` | Writes a value |
| `mark i sorted` | A lasting mark; `mark 0..3 done` for a span |
| `unmark i` / `unmark all` | Takes it off |
| `at lo 0` | A named pointer under a slot; `at lo off` removes it |
| `range window 2 5` | A bracket over a span |
| `push v` / `pop` | And `enqueue` / `dequeue`, `insert i v`, `remove i` |
| `visit 7` | In a tree, addressed by the node's label |
| `note …` | The caption for this frame onward |

Frames are folded from the start rather than stored, so stepping backwards is
exact and the scrubber can land anywhere. Values keep their identity across
frames, which is what makes a swap *slide* — the point of watching a sort rather
than reading a table of its states.

Nothing plays until it is asked to. `autoplay: true` overrides that, `loop: true`
runs it round, and `speed:` is the milliseconds a frame is held.

Printing cannot play, so an `algo` block exports as a strip of stills — the
frames that carry a note, plus the ends — which is how a textbook prints one.

### Shared annotations

After any label, in any of the three: `*` rings it, `~` fades it, `#red` (also
green, blue, yellow, purple, gray) colours it from the theme's own palette, and
`| text` adds a second, smaller line. Ask Claude for one with **Structure** mode
in the Claude dialog.

## Canvas

An infinite board for the thinking that is not linear: cards you place yourself,
notes embedded as cards, and arrows between them. Drag from any edge of a card to
connect it; scroll to pan, `Cmd`-scroll to zoom.

It saves as a `.canvas` file in the vault in the **JSON Canvas** format
(jsoncanvas.org), which is the same format Obsidian uses — so a board made here
opens there, and vice versa. Anything in the file Stone does not understand is
carried through a save untouched rather than dropped.

Canvas is **hidden from the view bar by default**: it is a surface people either
live in or never open, and an unused tab costs everyone attention. Turn it on
under Settings › Appearance, or just press `Cmd 7`.

## Documents

PDFs are ordinary citizens, not a separate feature. Point Stone at a folder of
them — an iCloud folder, a Downloads folder, a papers directory — and they
appear in the sidebar under **Docs**, answer to `[[wikilinks]]`, turn up in
`Ctrl/Cmd K`, and **open in a pane exactly like a note**, so a paper and the
notes you are taking on it sit side by side in a split. Nothing is moved,
copied, or rewritten; a folder can instead be set to copy into the vault if you
would rather it stayed self-contained.

**Add folder** is in three places, and all three do the same thing: the Docs
tab in the sidebar when it is empty, the header of the `Cmd 8` gallery, and
Settings › Documents. Adding one saves it, scans it, and shows what it found —
a folder is never watched-but-unread.

There is no Documents tab, on purpose. A screen of their own would put documents
back in a box that the rest of the app has to reach into. `Cmd 8` still opens a
gallery for browsing the whole library and managing watched folders.

### What renders

PDFs, drawn with pdf.js onto a canvas in the pane. Stone does not implement a
PDF engine — it drives the one that already ships with the app, and falls back
to Chromium's own viewer in an iframe if a document defeats it, so a file that
will not render here is still readable rather than a blank pane.

Drawing the pages rather than embedding a viewer is what makes browsing Stone's
own: a rail down the side gives every page a preview, arrow keys, Home and End
work as you would expect, the page number is typeable, and the zoom control is a
real control rather than whatever the embedded viewer decided to expose. Page
previews are rendered lazily and one at a time, so a 300-page document is
navigable immediately instead of after every page has decoded.

Nothing else renders. An `.epub` in a watched folder is listed and searchable by
name; opening it hands it to whichever app owns it.

### What is searchable

Text is extracted so documents turn up in search alongside notes. Be clear about
the limits, because they decide whether a document is findable by anything other
than its name:

- **Scanned PDFs have no text and never will here.** There is no OCR.
- **Some fonts defeat extraction.** Text is read from the content streams,
  including the kerning that many producers use in place of actual spaces. Where
  a font maps glyphs through a private encoding the result is not language, and
  Stone indexes nothing rather than filling search with noise. Documents from
  LaTeX and most typesetters come out clean; some word processors produce text
  with characters dropped or words run together.
- **Only PDFs are read.** Any other file type in a watched folder is indexed by
  name alone.
- **An evicted iCloud file is not on the machine.** Reading one blocks while
  macOS downloads it — minutes, for a big file — so Stone never touches file
  contents during a scan. Evicted documents are listed, marked, and have a
  Download button.

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
- Plugins cannot draw interface, by design. See **Themes and plugins**.
- Canvas has no multi-select marquee or undo of its own yet; deleting a card is
  the one destructive action and it takes the selection, not the board.
- There is still no mobile app. The vault is markdown in a synced folder, so
  Obsidian on a phone reads the notes — but not Stone's tasks or calendar.

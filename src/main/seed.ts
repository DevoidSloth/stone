import fs from 'node:fs/promises'
import path from 'node:path'
import { toISODate } from '@shared/task-syntax'

/**
 * What a brand new vault starts with.
 *
 * Stone's best ideas are the ones a blank folder hides completely. The task
 * syntax, `[[links]]`, embedded queries, runnable fences, timestamped audio and
 * the canvas were all documented only in the README, so a new user landed in an
 * empty Notes view with no path to any of them.
 *
 * These notes demonstrate rather than explain. Every construct on the page is
 * live — the tasks are real tasks that show up on the calendar, the link
 * resolves, the query runs — so reading the page and using the app are the same
 * action. And because they are ordinary markdown files, they can be deleted,
 * they sync, and they read correctly in Obsidian.
 */

function startHere(inbox: string, today: string, soon: string): string {
  return `---
title: Start here
tags: [stone]
---

# Start here

Everything you write is a markdown file in the folder you just picked. Open that
folder in Obsidian, VS Code, or TextEdit and it reads exactly the same. Nothing
here is a database row, and there is nothing to export.

Delete this note whenever you like — it is just a file.

## Tasks are checkboxes

A task is a markdown checkbox in any note. Write one anywhere and it appears in
the Tasks view and on the calendar. Click the box to tick it.

- [ ] Tick this box @${today} !high #stone
- [ ] Look at the calendar — this one is already on it @${soon} +30m
- [ ] Try a subtask by indenting under any line
- [x] Read this far

The tokens after the text are optional, and each one does a thing:

| Token | Means |
| --- | --- |
| \`@2026-08-12 14:30\` | when it is due |
| \`~2026-08-10\` | when to start |
| \`!high\` | priority — \`low\`, \`med\`, \`high\` |
| \`+90m\` | how long it will take |
| \`#tag\` | a tag, which is also a filter |

## Notes link to each other

Type \`[[\` anywhere to link a note. Try this one: [[Ideas]]. Links work in both
directions — open Ideas and you will find this note listed under Backlinks in
the right-hand panel.

\`![[Ideas]]\` embeds the note instead of linking it, and \`[[Ideas#A heading]]\`
jumps to a heading.

## Press / for everything else

With the cursor on an empty line, press \`/\` for callouts, tables, code blocks,
diagrams, and dates. A few worth knowing about:

> [!tip]
> Callouts like this one are \`> [!tip]\`, and take note, warning, and quote too.

Fenced code runs, if you have the language installed. Put the cursor in the
block below and press ⌘⏎:

\`\`\`js
const vault = 'plain markdown'
console.log(\`Stone keeps everything as \${vault}.\`)
\`\`\`

A query block is a live list rather than a snapshot — this one finds every
unfinished task in the vault, including the ones you just made:

\`\`\`query
task where status = open sort by due
\`\`\`

## The rest of it

- **⌘K** opens the command palette, which is the fastest route to anything.
- **⌘P** jumps to a note by name.
- **Record** from the palette captures audio into the note, and every timestamp
  it writes plays back from that moment.
- **Documents** — add a folder of PDFs in Settings and they become searchable
  and linkable exactly like notes.

Written into \`${inbox}\` because that is your inbox folder; change it in
Settings › Folders.
`
}

const IDEAS = `---
title: Ideas
tags: [stone]
---

# Ideas

A second note, so [[Start here]] has something to link to.

Anything you write in a note is searchable from ⌘K, and every note that links
here shows up in the Backlinks panel on the right — [[Start here]] should already
be listed.

- [ ] Replace this note with a real one #stone
`

/**
 * Seed a vault that has no notes at all.
 *
 * Deliberately conservative: an existing Obsidian vault opened for the first
 * time must never have files written into it, so anything that already contains
 * a single markdown file is left alone.
 */
export async function seedVault(vaultPath: string, inboxFolder: string): Promise<boolean> {
  if (await hasAnyNote(vaultPath)) return false

  const folder = inboxFolder.split('/').filter(Boolean)
  const dir = path.join(vaultPath, ...folder)
  const now = new Date()
  const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)

  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'Start here.md'),
      startHere(inboxFolder || 'the vault root', toISODate(now), toISODate(soon)),
      'utf8'
    )
    await fs.writeFile(path.join(dir, 'Ideas.md'), IDEAS, 'utf8')
    return true
  } catch {
    // A vault we cannot write to is a problem the first save will report
    // properly. Failing to seed is not worth its own error.
    return false
  }
}

/** Whether the folder holds a markdown file anywhere, ignoring dot-folders. */
async function hasAnyNote(dir: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return true // Unreadable is not empty; do not write into it.
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) return true
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue
    if (await hasAnyNote(path.join(dir, entry.name), depth + 1)) return true
  }
  return false
}

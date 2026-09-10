/**
 * The manual, as data.
 *
 * Stone's feature surface is mostly *syntax* — a token in a checkbox, a key in
 * frontmatter, a word after three backticks — and syntax is the one kind of
 * documentation that is useless anywhere but next to the note you are writing.
 * Alt-tabbing to a README to remember whether a heap is `heap:` or `level:` is
 * how a fence stops getting used at all.
 *
 * So it lives in a panel, and it is structured rather than prose: a topic is a
 * list of sections, a section a list of blocks, and every code example carries
 * the exact text it would go into a note as. That shape buys three things a
 * page of markdown would not. The search box can match a heading, a paragraph
 * and the inside of an example separately and say which it hit. Every example
 * gets an Insert button, so reading how a `tree` block works and having one in
 * the note is a single click rather than a transcription. And nothing here can
 * drift out of sync with the panel that renders it, because there is only one
 * renderer.
 *
 * Inline markup in a `text` field is deliberately two things and no more:
 * `code` and **bold**. Anything that needs more structure than that is a block.
 */

export type DocBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  /** A two-column reference table: token on the left, what it means on the right. */
  | { kind: 'table'; head: [string, string]; rows: Array<[string, string]>; mono?: boolean }
  /** A snippet the reader can drop straight into the note. */
  | { kind: 'example'; code: string; caption?: string }
  /** An aside — the caveat that would otherwise be a parenthesis three lines long. */
  | { kind: 'note'; text: string }

export interface DocSection {
  title: string
  blocks: DocBlock[]
}

export interface DocTopic {
  id: string
  title: string
  /** One line, shown in the topic list. */
  blurb: string
  /** Extra words search should match, for the names a person would actually type. */
  keywords: string
  sections: DocSection[]
}

/**
 * A fence, written as its own text.
 *
 * Examples are stored with real backticks so that Insert puts a working block
 * in the note and Copy puts one on the clipboard. Building the fence here keeps
 * the three-backtick runs out of the topic bodies, where they would have to be
 * escaped in every single one.
 */
function fence(lang: string, body: string): string {
  return ['```' + lang, body, '```'].join('\n')
}

export const DOC_TOPICS: DocTopic[] = [
  // ------------------------------------------------------------------ vault
  {
    id: 'vault',
    title: 'Notes and the vault',
    blurb: 'Plain markdown files in a folder you own.',
    keywords: 'vault folder files markdown frontmatter daily note folder note storage',
    sections: [
      {
        title: 'Where things live',
        blocks: [
          {
            kind: 'p',
            text: 'Every note is a `.md` file in the folder you chose. There is no database and no proprietary format — open the same folder in Obsidian, VS Code or a text editor and it reads exactly the same.'
          },
          {
            kind: 'p',
            text: 'Stone keeps its own bookkeeping in a `.stone` folder beside your notes: snapshots, backups, plugins and settings. Deleted notes go to `.trash` inside the vault rather than to the operating system bin.'
          }
        ]
      },
      {
        title: 'Frontmatter',
        blocks: [
          {
            kind: 'p',
            text: 'A YAML block at the very top of a note holds its properties. Stone folds it to a row of names while you read, so the `---` fences are not sitting on the page.'
          },
          {
            kind: 'example',
            code: '---\ntitle: Website rebuild\ndate: 2026-08-09\ntags: [project, active]\nstatus: active\n---',
            caption: 'Any key you invent becomes a column a view can filter on.'
          },
          {
            kind: 'note',
            text: 'Quote times. `gray-matter` parses YAML 1.1, where an unquoted `17:00` becomes the number 1020.'
          }
        ]
      },
      {
        title: 'Folder notes',
        blocks: [
          {
            kind: 'p',
            text: 'A note named after the folder it sits in describes that folder. Its Links panel lists everything inside it as **contents** rather than as mentions, because those notes are linked to it by containment rather than by anything anybody typed.'
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------ tasks
  {
    id: 'tasks',
    title: 'Tasks',
    blurb: 'A checkbox in any note, with dates, priority and repeats.',
    keywords: 'task todo checkbox due scheduled priority estimate tag repeat recurring status',
    sections: [
      {
        title: 'The syntax',
        blocks: [
          {
            kind: 'p',
            text: 'A task is a markdown checkbox. Write one anywhere and it appears in the Tasks view and on the calendar.'
          },
          {
            kind: 'example',
            code: '- [ ] Finish the parser @2026-08-12 14:30 ~2026-08-10 !high +90m #compilers'
          },
          {
            kind: 'table',
            head: ['Token', 'Means'],
            mono: true,
            rows: [
              ['@2026-08-12', 'Due date, optionally with a HH:MM time'],
              ['~2026-08-10', 'Scheduled — when you plan to work on it'],
              ['!urgent !high !medium !low', 'Priority'],
              ['+90m +2h +1d', 'Estimate'],
              ['&weekly', 'Repeat; see below'],
              ['#tag', 'Tag']
            ]
          },
          {
            kind: 'p',
            text: 'Dates can be written the way you say them — `@tomorrow`, `@next friday`, `@5 Jan`, `@friday at 9` — and are resolved as you type.'
          }
        ]
      },
      {
        title: 'Status',
        blocks: [
          {
            kind: 'table',
            head: ['Checkbox', 'Status'],
            mono: true,
            rows: [
              ['- [ ]', 'To do'],
              ['- [/]', 'In progress'],
              ['- [x]', 'Done'],
              ['- [-]', 'Cancelled']
            ]
          },
          {
            kind: 'p',
            text: '`Ctrl/Cmd Enter` turns the line the caret is on into a task, and cycles its status once it is one.'
          }
        ]
      },
      {
        title: 'Repeats',
        blocks: [
          {
            kind: 'example',
            code: '- [ ] Water the plants @monday &weekly\n- [ ] Pay rent @2026-09-01 &monthly\n- [ ] Stand-up @tomorrow &weekdays\n- [ ] Deep clean @2026-08-20 &every 3 weeks'
          },
          {
            kind: 'p',
            text: '`&daily`, `&weekly`, `&fortnightly`, `&monthly`, `&yearly`, `&weekdays`, or `&every N days/weeks/months/years`. Completing a repeating task leaves the next one behind rather than just ticking this one off.'
          },
          {
            kind: 'note',
            text: "Obsidian Tasks emoji syntax (📅 ⏳ ⏫ 🔺 🔽 ✅ 🔁) is read on import, but Stone always writes the token form."
          }
        ]
      }
    ]
  },

  // ----------------------------------------------------------------- events
  {
    id: 'events',
    title: 'Dates and events',
    blurb: 'A note becomes an event when it has a date and a time.',
    keywords: 'event calendar date start end location ics apple outlook graph subscribe',
    sections: [
      {
        title: 'Making a note an event',
        blocks: [
          {
            kind: 'example',
            code: '---\ndate: 2026-08-09\nstart: "17:00"\nend: "17:30"\nlocation: Anywhere quiet\n---'
          },
          {
            kind: 'p',
            text: 'A bare `date:` only files the note under that day. Without that rule every daily note would become an all-day event and bury the real calendar.'
          }
        ]
      },
      {
        title: 'Other calendars',
        blocks: [
          {
            kind: 'table',
            head: ['Source', 'How'],
            rows: [
              ['Vault notes and tasks', 'Parsed from frontmatter and checkboxes'],
              ['Apple Calendar (macOS)', 'EventKit — read and write, needs full access'],
              ['Outlook / Microsoft', 'Graph, device-code sign-in — read and write'],
              ['Any ICS feed', 'Subscribed by URL, read-only, cached 10 minutes']
            ]
          },
          {
            kind: 'p',
            text: '**ICS is the zero-configuration path.** Google publishes a secret iCal address under Settings › Integrate calendar; paste it into Settings › Subscribe to a calendar.'
          },
          {
            kind: 'note',
            text: 'On macOS 14 and later, calendar permission comes in two grades and only **full access** can read events. Write-only lets Stone add an event but shows an empty calendar.'
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------ links
  {
    id: 'links',
    title: 'Links, embeds and tags',
    blurb: 'Wikilinks, backlinks, transclusion, and the graph.',
    keywords: 'wikilink backlink link embed transclude tag graph rename mention alias',
    sections: [
      {
        title: 'Linking',
        blocks: [
          {
            kind: 'table',
            head: ['Write', 'Gets you'],
            mono: true,
            rows: [
              ['[[Note title]]', 'A link, resolved by filename or title'],
              ['[[Note title|label]]', 'The same link under a different name'],
              ['[[Note title#Heading]]', 'A link to one section of it'],
              ['![[Note title]]', 'The note embedded in place'],
              ['![[Note#Heading]]', 'Just that section, embedded'],
              ['![[Note#^block-id]]', 'Just that paragraph, embedded'],
              ['![[image.png]]', 'A picture from the vault'],
              ['[text](https://…)', 'An ordinary hyperlink'],
              ['#tag', 'A tag, clickable and searchable'],
              ['[^1]', 'A footnote']
            ]
          },
          {
            kind: 'p',
            text: 'Renaming a note rewrites every link that pointed at it. Hovering a wikilink shows the first few lines of its target without opening it.'
          },
          {
            kind: 'p',
            text: 'An embed with a `#Heading` brings in that heading and everything under it, down to the next heading at the same level. `#Heading#Subheading` narrows it further, and `^block-id` — an anchor you put at the end of a line — brings in that one paragraph. Rename the heading and the embed says it cannot find the section rather than quietly widening to the whole page.'
          }
        ]
      },
      {
        title: 'Backlinks and mentions',
        blocks: [
          {
            kind: 'p',
            text: 'The **Links** panel lists what links here, and separately what *names* this note without linking to it. Each unlinked mention has a Link button that rewrites it in place.'
          }
        ]
      },
      {
        title: 'Hyperlinks, three ways',
        blocks: [
          {
            kind: 'list',
            items: [
              '`Ctrl/Cmd Shift K` wraps the selection, or drops an empty `[]()` with the caret in the address.',
              'Paste a URL over selected text and the text becomes the label rather than being replaced.',
              '`/hyperlink` in the slash menu, for starting one from nothing.'
            ]
          }
        ]
      }
    ]
  },

  // ----------------------------------------------------------------- writing
  {
    id: 'writing',
    title: 'Writing and formatting',
    blurb: 'The selection bar, tables, callouts, maths and diagrams.',
    keywords:
      'bold italic highlight callout table mermaid svg math latex katex equation symbol greek autocomplete suggestion quote heading slash menu format markdown list bullet nested outline indent numbered ordered',
    sections: [
      {
        title: 'The selection bar',
        blocks: [
          {
            kind: 'p',
            text: 'Highlight any text and a bar appears over it: bold, italic, strikethrough, `==highlight==`, inline code, a link or a wikilink, heading levels, quote, list and task — plus **Tx** to strip inline markup back out. Every button is a toggle, so pressing bold on bold text unwraps it.'
          },
          {
            kind: 'p',
            text: 'The **●** button opens a row of colours: seven for the text itself, the same seven as a highlight behind it, and a crossed-out swatch on each row that takes the colour off again. Applying a second colour replaces the first rather than nesting inside it.'
          },
          {
            kind: 'note',
            text: 'Colour is written as `<span style="color: #e05252">` and `<mark style="background: #…">` — the HTML that Obsidian, GitHub and Stone\'s own PDF export all understand, so a coloured note keeps its colour outside Stone. The palette is deliberately mid-tone ink and translucent washes, because a note is read in both themes.'
          }
        ]
      },
      {
        title: 'Marks with no markdown of their own',
        blocks: [
          {
            kind: 'table',
            head: ['Write', 'Gets you'],
            mono: true,
            rows: [
              ['==text==', 'A yellow highlight'],
              ['<u>text</u>', 'Underline'],
              ['<sup>2</sup>', 'Superscript — x², a citation marker'],
              ['<sub>2</sub>', 'Subscript — H₂O, an index'],
              ['^[an aside]', 'An inline footnote, numbered where it sits'],
              ['%%private%%', 'A comment: in the file, never in the export']
            ]
          },
          {
            kind: 'p',
            text: 'CommonMark has no syntax for underline, superscript or subscript and expects the HTML instead, so the tag *is* the markdown here. Each one hides its own tags until the caret reaches the line.'
          },
          {
            kind: 'p',
            text: 'A comment can also span lines: `%%` alone on a line opens one and the next `%%` closes it. Commented text is dimmed rather than hidden — this is an editor, and text that disappears the moment the caret leaves is text you will be surprised by later — but it never reaches a PDF, an HTML export, the Tasks view or the calendar. Commenting a task out really does park it.'
          },
          {
            kind: 'example',
            code: 'Ship on Friday ^[if the review lands first].\n\n%%\n- [ ] Parked until the quarter turns @2026-01-05\n%%'
          }
        ]
      },
      {
        title: 'Emoji',
        blocks: [
          {
            kind: 'p',
            text: 'Type `:` and a word — `:tada:`, `:warning:`, `:rocket:` — and pick from the menu. What lands in the note is the character itself, never the shortcode, so it reads the same in every other editor.'
          }
        ]
      },
      {
        title: 'The slash menu',
        blocks: [
          {
            kind: 'p',
            text: 'Type `/` at the start of a line for every block Stone can insert — headings, lists, tasks, callouts, tables, code, all four figures, a query, a maths block, an image, a PDF, a recording, or an algorithm animated by Claude.'
          }
        ]
      },
      {
        title: 'Lists',
        blocks: [
          {
            kind: 'example',
            code: '- Groceries\n  - Produce\n    - Apples\n  - Tinned\n- Errands\n  1. Post office\n  2. Library'
          },
          {
            kind: 'p',
            text: 'Indentation in the file is left exactly as typed; on the page a list is drawn on a grid — one step per level, a bullet that changes shape as it nests, a guide down each ancestor\'s column, and a wrapped item continuing under its own text. The raw `-` comes back when the caret reaches into it.'
          },
          {
            kind: 'table',
            head: ['Key', 'Does'],
            mono: true,
            rows: [
              ['Tab / Shift Tab', 'Nest the item, or lift it back out'],
              ['Alt ↑ / ↓', 'Move the item past its neighbour'],
              ['Ctrl/Cmd Shift 8', 'Turn the line into a bullet'],
              ['Ctrl/Cmd Shift H', 'Collapse the item']
            ]
          },
          {
            kind: 'p',
            text: 'Every one of those carries the item\'s children with it, and renumbers the ordered list afterwards. An item with children shows a collapse arrow in the margin, and keeps a ring around its marker while it is closed.'
          },
          {
            kind: 'note',
            text: 'A list numbered `1.` on every line is left alone. CommonMark numbers it for you, and it is a style people choose on purpose so that inserting an item edits nothing below it.'
          }
        ]
      },
      {
        title: 'Callouts',
        blocks: [
          {
            kind: 'example',
            code: '> [!note] The heading\n> The body of the callout.'
          },
          { kind: 'p', text: '`[!note]`, `[!tip]` and `[!warning]` are tinted differently, and `[!danger]`, `[!quote]`, `[!success]`, `[!bug]` and `[!example]` each have a tint and a glyph of their own.' },
          {
            kind: 'example',
            code: '> [!warning]- What the fold marker does\n> A `-` after the kind makes the callout collapsible, and it opens\n> collapsed. A `+` makes it collapsible and opens it expanded.',
            caption: 'Click the twisty in the margin, or Ctrl/Cmd Shift H with the caret on the first line.'
          },
          {
            kind: 'p',
            text: 'Callouts nest. A `> >` line inside one opens a second panel held by the first, drawn inset with its own tint — which is how a warning inside a note reads as a warning rather than as a differently coloured paragraph.'
          }
        ]
      },
      {
        title: 'Contents',
        blocks: [
          {
            kind: 'example',
            code: fence('toc', 'levels: 2-3'),
            caption: 'The note\'s own headings, listed where you put the block. Click one to jump to it.'
          },
          {
            kind: 'p',
            text: 'The list is built from the document every time it is drawn, so it can never go stale — rename a heading and the contents follow. `levels:` is optional and defaults to `2-6`, because in a note with a title an `h1` is usually the title said twice.'
          }
        ]
      },
      {
        title: 'Tables',
        blocks: [
          {
            kind: 'p',
            text: 'A table is a grid you type into, not pipes you count. Click a cell and edit it in place; the markdown underneath is rewritten and realigned on every commit.'
          },
          {
            kind: 'table',
            head: ['Key', 'Does'],
            mono: true,
            rows: [
              ['Tab / Shift Tab', 'Next / previous cell. From the last, Tab adds a row'],
              ['Enter', 'New row below'],
              ['Alt Cmd ↓ / ↑', 'Add a row below / above'],
              ['Alt Cmd → / ←', 'Add a column right / left'],
              ['Alt Cmd ⌫', 'Delete this row (Shift for the column)'],
              ['Esc', 'Leave the table']
            ]
          },
          {
            kind: 'p',
            text: 'Hovering the table puts a small ⇤ on each header cell: click it to cycle that column through left, centre and right. It writes the colons in the rule row, so the file says what the page shows.'
          },
          {
            kind: 'p',
            text: 'An escaped pipe or a malformed rule row can still only be fixed in the source, so **Markdown** on the table\'s top-right corner drops it back to raw text.'
          }
        ]
      },
      {
        title: 'Maths',
        blocks: [
          {
            kind: 'example',
            code: '$$\ne = \\sum_{n=0}^{\\infty} \\frac{1}{n!}\n$$',
            caption: 'KaTeX. `$x$` for an inline equation.'
          },
          {
            kind: 'p',
            text: 'Inside an equation, `\\` opens a menu of LaTeX commands with the symbol each one draws beside its name, and the selected one rendered next to the list. Searching works on what the symbol **is** as well as what it is called, so `union`, `much less` and `fraction` all find theirs.'
          },
          {
            kind: 'p',
            text: 'Commands that take arguments arrive with them: `\\frac` puts the caret in the numerator, `\\left(` brings its `\\right)`, and `\\begin{` offers whole environments — `aligned`, `cases`, `pmatrix` — already closed and with a row of `&` showing where the columns go.'
          },
          {
            kind: 'note',
            text: 'The menu only opens where a backslash could start a command: inside `$…$`, inside `$$…$$`, and inside a ```math fence. In prose a backslash is just a backslash.'
          }
        ]
      },
      {
        title: 'Diagrams and drawings',
        blocks: [
          {
            kind: 'example',
            code: fence('mermaid', 'flowchart TD\n  A[Start] --> B[Parse]\n  B --> C[Run]'),
            caption: 'Mermaid, for flowcharts, sequence and class diagrams.'
          },
          {
            kind: 'example',
            code: fence(
              'svg',
              '<svg viewBox="0 0 200 100">\n  <circle cx="100" cy="50" r="40" fill="none"\n    stroke="currentColor" stroke-width="2" />\n</svg>'
            ),
            caption: 'An inline drawing. `currentColor` follows the theme.'
          },
          {
            kind: 'note',
            text: 'For a pointer, a lopsided tree or a running algorithm, Mermaid is the wrong tool — see **Program figures**.'
          }
        ]
      }
    ]
  },

  // ---------------------------------------------------------------- queries
  {
    id: 'queries',
    title: 'Queries inside notes',
    blurb: 'A live list of notes or tasks, rendered where you wrote it.',
    keywords: 'query stone block dataview from where sort group limit view live list embedded',
    sections: [
      {
        title: 'A query block',
        blocks: [
          {
            kind: 'example',
            code: fence(
              'stone',
              'from: Projects\nwhere: status is active\nsort: edited desc\nas: list\nlimit: 10'
            )
          },
          {
            kind: 'example',
            code: fence('stone', 'view: Active projects'),
            caption: 'Or name a view you already saved.'
          }
        ]
      },
      {
        title: 'The keys',
        blocks: [
          {
            kind: 'table',
            head: ['Key', 'Is'],
            mono: true,
            rows: [
              ['from', 'A folder to look in'],
              ['source', '`notes` or `tasks`'],
              ['where', 'A filter — `status is active`, `due before today`'],
              ['sort', 'A property and `asc` / `desc`'],
              ['group', 'A property to group rows under'],
              ['columns', 'Which properties to show'],
              ['as', '`table`, `board`, `gallery`, `list`, `timeline`'],
              ['limit', 'How many rows at most']
            ]
          },
          {
            kind: 'p',
            text: 'The syntax is `key: value` lines because that is the same shape as the frontmatter above it, and a typo produces one wrong line rather than swallowing the query.'
          },
          {
            kind: 'note',
            text: 'A query block is always a lens. It never writes — this is what makes a daily note assemble itself.'
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------ views
  {
    id: 'views',
    title: 'Views, relations and rollups',
    blurb: 'Saved queries with a shape, that write back.',
    keywords: 'view database table board gallery timeline relation rollup property column filter',
    sections: [
      {
        title: 'Views',
        blocks: [
          {
            kind: 'p',
            text: 'A view is a saved query with a shape — table, board, gallery, list or timeline — over the notes you already have. The rows are notes; the columns are frontmatter keys Stone inferred a type for.'
          },
          {
            kind: 'p',
            text: 'Views **write back**: drag a card between board columns and it rewrites that note\'s grouping property; edit a table cell and it edits one line of YAML, leaving the rest of the file byte-identical. **New** creates a note that already satisfies the view\'s filters.'
          },
          {
            kind: 'note',
            text: 'Columns that describe the file rather than live in it — `folder`, `edited` — stay read-only.'
          }
        ]
      },
      {
        title: 'Relations',
        blocks: [
          {
            kind: 'p',
            text: 'A `[[link]]` in a frontmatter property is a *typed* link: the key says what the relationship is.'
          },
          { kind: 'example', code: '---\nproject: "[[Website rebuild]]"\n---' },
          {
            kind: 'p',
            text: 'Both notes then show it in the **Relations** panel — outward, and inward on the note being pointed at, which is the half nobody writes by hand.'
          },
          {
            kind: 'note',
            text: 'Write the value quoted. `project: [[X]]` unquoted is a nested sequence in YAML, not a string.'
          }
        ]
      },
      {
        title: 'Rollups',
        blocks: [
          {
            kind: 'p',
            text: 'A rollup column follows one of those relations and summarises the far side: count, sum, average, min, max, earliest, latest, or a list. "Open tasks per project" is a rollup over the incoming `project` relation.'
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------- code
  {
    id: 'code',
    title: 'Running code blocks',
    blurb: 'Run a fence in place, with a session per note.',
    keywords:
      'run code fence execute python javascript java shell notebook session kernel output stdout stderr runner autocomplete suggestion intellisense completion keyword builtin',
    sections: [
      {
        title: 'Running one',
        blocks: [
          {
            kind: 'p',
            text: 'A fenced block in a language Stone knows how to run gets a Run button under it, and `Ctrl/Cmd Shift Enter` runs the one the caret is in. Output appears below the block as it is printed — stdout in the body colour, stderr in red — with the exit status and how long it took.'
          },
          {
            kind: 'example',
            code: fence('python', 'total = sum(range(10))\nprint(total)')
          },
          {
            kind: 'note',
            text: 'Nothing is written back into the note. A run is something you did to the file, not an edit of it.'
          },
          {
            kind: 'p',
            text: 'Every fenced block, runnable or not, is topped by a bar naming its language with a **Copy** button on the right, standing in for the ```` ``` ```` line itself. The backticks come back the moment the caret lands on it.'
          }
        ]
      },
      {
        title: 'Notebook sessions',
        blocks: [
          {
            kind: 'p',
            text: 'A note is a notebook by default: its blocks run into one session per language and go on from one another, so what the second block declares the fifth can use. The `[3]` beside a block is its place in that session.'
          },
          {
            kind: 'example',
            code: '---\nnotebook: false\n---',
            caption: 'A page of unrelated snippets can keep every block to itself.'
          }
        ]
      },
      {
        title: 'Suggestions',
        blocks: [
          {
            kind: 'p',
            text: 'Typing inside a fence suggests names. Three sources, in the order they are worth having: what the block itself declares, what the blocks above it in the same language declared — the session they all run into — and then the language\'s own keywords and builtins.'
          },
          {
            kind: 'p',
            text: 'It is not a language server. There is no toolchain and no types behind it: the declarations are read off the source, the way the **Code** inspector reads them, and a suggestion after a `.` is a common method rather than a checked one.'
          },
          {
            kind: 'example',
            code: fence('!python', 'for i in range(3):\n    print(i)'),
            caption: 'A `!` in front of the language turns suggestions off for that block.'
          },
          {
            kind: 'note',
            text: 'The `!` means nothing else. The block still highlights, still runs, still gets its header bar — it is a good fence to transcribe a listing into, where every popup is in the way.'
          }
        ]
      },
      {
        title: 'The languages',
        blocks: [
          {
            kind: 'p',
            text: 'JavaScript, TypeScript, Python, Bash, Zsh, PowerShell, Ruby, PHP, Perl, Lua, R, Go, Rust, C, C++, Swift and Java ship with a command. Each is a single shell line in Settings › Code, so a machine with pyenv, or a language nothing here lists, is one field to fill in.'
          },
          {
            kind: 'table',
            head: ['Placeholder', 'Is'],
            mono: true,
            rows: [
              ['{file}', 'The block, written to a scratch file'],
              ['{dir}', 'The folder that file sits in'],
              ['{name}', 'Its base name, for compilers that emit a binary']
            ]
          }
        ]
      },
      {
        title: 'Java, three ways',
        blocks: [
          {
            kind: 'list',
            items: [
              'A block with a `main` is a **program** — run through the source-file launcher, no `javac` step and no class files left behind.',
              'A block of only declarations is **compiled**: the errors are the point, and it says plainly that nothing ran.',
              'Statements loose among declarations make it a **script**, and jshell runs it.'
            ]
          },
          {
            kind: 'note',
            text: 'jshell does not echo the value of an expression loaded from a file, so print what you want to see; it also reports an error without failing, so a red error and a zero exit status can appear together.'
          }
        ]
      },
      {
        title: 'What it can do',
        blocks: [
          {
            kind: 'p',
            text: 'The block runs through your login shell, in the note\'s folder, with your permissions. That is why the first run asks first — a fenced block in a clipped web page is a program by a stranger. The answer is remembered, and Settings › Code takes it back.'
          },
          {
            kind: 'p',
            text: 'Runs stop at a time limit — thirty seconds out of the box — and the whole process group is killed.'
          }
        ]
      }
    ]
  },

  // ---------------------------------------------------------------- figures
  {
    id: 'figures',
    title: 'Program figures',
    blurb: 'memory, boxes, tree, types, hash, chart and algo — the pictures on the whiteboard.',
    keywords:
      'memory boxes tree types algo hash chart figure diagram pointer heap stack bst binary heap traversal animation array linked list cons pairs class interface hierarchy inheritance uml hash table bucket chaining probe load factor rehash plot graph growth big-o complexity recurrence master theorem loop invariant stills',
    sections: [
      {
        title: 'Seven fences',
        blocks: [
          {
            kind: 'p',
            text: 'What refers to what, what is in memory, what shape a tree is, how a design is put together, where a key lands, how something grows, and what an algorithm does over time. They render in the editor as you type, print into an export, and are plain text in the file — a note that draws one still reads as source in any other editor.'
          },
          {
            kind: 'note',
            text: 'A figure that will not parse is never dropped. It comes back as a dashed box naming the line it could not read, with your source still in it.'
          }
        ]
      },
      {
        title: 'tree — shapes that arrive as arrays',
        blocks: [
          {
            kind: 'example',
            code: fence('tree', 'bst: 50 30 70 20 40 60 80\ntraverse: inorder')
          },
          {
            kind: 'table',
            head: ['Directive', 'Builds'],
            mono: true,
            rows: [
              ['bst: 50 30 70', 'Inserts in the order given; equal keys go right'],
              ['heap: 9 7 8 3', 'An array as a complete binary tree, indices labelled'],
              ['level: 1 2 3 . . 4 5', 'Level order, with `.` for a missing child'],
              ['(indented outline)', 'Anything that is not an array — a parse tree, a trie'],
              ['traverse: inorder', 'Numbers the nodes in visit order and captions it'],
              ['title: / caption:', 'A line above and a line below the figure']
            ]
          },
          {
            kind: 'p',
            text: '`traverse:` also takes `preorder`, `postorder` and `level`. An empty slot is **drawn, not omitted**, and a parent sits over the midpoint of its slots rather than its children — so a node with one child leans the way it should. That is the whole reason not to use a flowchart here.'
          },
          {
            kind: 'example',
            code: fence(
              'tree',
              'title: An expression tree\n*\n  +\n    3\n    4\n  5'
            ),
            caption: 'The outline form: indent for children, one node a line.'
          },
          {
            kind: 'example',
            code: fence('tree', 'level: 1 2 3 . . 4 5'),
            caption: 'The LeetCode form. A `.` holds an empty slot open.'
          }
        ]
      },
      {
        title: 'tree — a recurrence, unrolled',
        blocks: [
          {
            kind: 'example',
            code: fence('tree', 'recurrence: 2T(n/2) + n')
          },
          {
            kind: 'p',
            text: 'Give it the right-hand side and it draws the recursion tree with what each level costs down the side, and the sum under a rule. The algebra is exact: mergesort comes out as `n`, `n`, `n`, `n` because every level really does cost the same, which is where the `log n` comes from.'
          },
          {
            kind: 'table',
            head: ['Directive', 'Does'],
            mono: true,
            rows: [
              ['recurrence: 2T(n/2) + n', 'Builds the tree and works out the levels'],
              ['recurrence: T(n-1) + n', 'Subtractive: a chain rather than a fan'],
              ['depth: 4', 'How many levels below the root — 3, or 2 when it branches wide'],
              ['cost: n, n/2, n/4', 'Write the levels yourself, on any tree'],
              ['total: Θ(n)', 'The line under the rule']
            ]
          },
          {
            kind: 'p',
            text: 'The sum is the master theorem applied, with the case it fell into as the caption: the leaves dominate, the root dominates, or every level costs the same. Costs are `1`, `n`, `n^2` and multiples of them; anything with a `log` in it is refused rather than guessed at, and `cost:` is how you write those levels out.'
          },
          {
            kind: 'example',
            code: fence('tree', 'recurrence: 3T(n/2) + n\ntitle: Karatsuba'),
            caption: 'Θ(n^log₂3) — the leaves win, and the column shows why.'
          },
          {
            kind: 'note',
            text: '`cost:` works on any tree, not only a generated one, so a BST or an outline can carry a column too.'
          }
        ]
      },
      {
        title: 'memory — stack, heap and pointers',
        blocks: [
          {
            kind: 'example',
            code: fence(
              'memory',
              'title: Reversing a linked list\nstack:\n  reverse(head):\n    prev -> null\n    curr -> n2 *\nheap:\n  n1 Node { val: 1, next: null }\n  n2 Node { val: 2, next -> n1 }\n  n3 Node { val: 3, next -> n2 }'
            )
          },
          {
            kind: 'p',
            text: 'Sections are `stack:`, `heap:` and `globals:`. A box is written one of four ways:'
          },
          {
            kind: 'table',
            head: ['Form', 'Is'],
            mono: true,
            rows: [
              ['id Type { field: v, field -> target }', 'Named fields, one per row'],
              ['id Type:  (fields indented under it)', 'The same, when it gets long'],
              ['id [ a, ->b, . ]', 'An array — slots numbered underneath'],
              ['id ( a, ->b )', 'A pair — the same slots, unnumbered']
            ]
          },
          {
            kind: 'p',
            text: '**Nothing is positioned.** The heap lays itself out by following its own pointers: a linked list comes out as a chain across the page, a tree as a fan, with no coordinates in the source. A pointer that goes backwards is routed underneath rather than across.'
          },
          {
            kind: 'p',
            text: '`-> null` (or `.` in a slot) draws a struck slot; `-> arr[2]` points at one cell of an array.'
          },
          {
            kind: 'example',
            code: fence('memory', 'globals:\n  x -> p1\npairs: 1 2 3'),
            caption: 'Two one-liners: `list: 1 2 3` for Node chains, `pairs:` for cons cells.'
          }
        ]
      },
      {
        title: 'boxes — what refers to what',
        blocks: [
          {
            kind: 'example',
            code: fence(
              'boxes',
              'b -> board\n\nboard CBoard:\n  cells -> grid\n\ngrid Int[][] [ ->r0, ->r1 ]\n\nr0 Int[] [ 1, 2, 3 ]\nr1 Int[] [ 4, 5, 6 ]'
            )
          },
          {
            kind: 'list',
            items: [
              '**A variable** is `name -> target`: a small box with its name outside it. `name = 5` writes a value in the same little box.',
              '**An object** is `id Type:` with its fields indented, or `id Type { … }` on one line. The title is the type; the `id` never appears in the drawing.',
              '**A list** is `id Type [ … ]`, drawn as a column: type, then the length, then one row an element.'
            ]
          },
          {
            kind: 'note',
            text: 'No stack, no heap, no boundary between them — those are facts about storage, and this picture is about references. A `stack:` section here is refused and told to go and be a `memory` block.'
          }
        ]
      },
      {
        title: 'types — a hierarchy of classes and interfaces',
        blocks: [
          {
            kind: 'example',
            code: fence(
              'types',
              'abstract class Animal\ninterface Winged\nclass Dog extends Animal\nclass Bird extends Animal implements Winged'
            )
          },
          {
            kind: 'p',
            text: 'One type a line, written the way you would declare it. Nothing in the source positions anything: a type sits one row below the deepest thing it inherits from, and slides along that row to keep its edges short and uncrossed.'
          },
          {
            kind: 'table',
            head: ['Written', 'Draws'],
            mono: true,
            rows: [
              ['class Dog', 'A plain box'],
              ['abstract class Animal', 'The name in italics, `abstract class` under it'],
              ['interface Winged', 'A dashed box — also `enum` and `record`'],
              ['class Dog extends Animal', 'A solid edge up to Animal'],
              ['class Bird implements Winged', 'A dashed edge — realising, not extending'],
              ['class Bird < Animal, Winged', 'The short form: a subtype of both'],
              ['(indented under a type)', 'Fields and methods, in a compartment']
            ]
          },
          {
            kind: 'p',
            text: 'The arrowhead is UML\u2019s hollow triangle and always points at the **supertype**, so the figure says which way the relation runs without a legend. A class under an interface is drawn dashed whether or not you wrote `implements` — it is the only thing it could be doing.'
          },
          {
            kind: 'example',
            code: fence(
              'types',
              'title: Ciphers\ninterface Cipher\n  encrypt(String): String\n  decrypt(String): String\nabstract class Substitution implements Cipher\n  alphabet: char[]\nclass Caesar extends Substitution\nclass Vigenere extends Substitution\n  key: String'
            ),
            caption: 'Indent under a type to list what it holds and what it can do.'
          },
          {
            kind: 'note',
            text: 'A supertype nothing declares is drawn as a plain class, which is what makes `Dog < Animal` a two-box figure on its own — and what makes a misspelt supertype show up as a box of its own rather than nothing at all.'
          }
        ]
      },
      {
        title: 'hash — a table, with the collisions in it',
        blocks: [
          {
            kind: 'example',
            code: fence('hash', 'buckets: 7\nkeys: 12 44 13 88 23 94 11')
          },
          {
            kind: 'p',
            text: 'This is the one figure the fence **computes**. You give it the keys and the table size; it hashes them, resolves the collisions, and draws where they actually went — which is the point, because where a key lands is never where you guessed. The line underneath counts the load factor, the longest chain and how much of the table is empty.'
          },
          {
            kind: 'table',
            head: ['Directive', 'Does'],
            mono: true,
            rows: [
              ['buckets: 7', 'How big the table is — 8 by default'],
              ['keys: 12 44 13', 'Inserted in this order'],
              ['probe: chain', 'Or linear, quadratic, double — open addressing'],
              ['hash: mod', 'Or java, length, first, sum — guessed from the keys'],
              ['load: 0.75', 'Double and rehash when it gets fuller than this'],
              ['remove: 44', 'Deletes — a tombstone, where a probe has to run past it'],
              ['show: hash', "Each key's raw hash under it"]
            ]
          },
          {
            kind: 'p',
            text: 'Numbers go through `k mod m` and words through Java\u2019s `String.hashCode`, so a figure claiming to be a `HashMap` is one. Under open addressing each key carries how many probes it cost, and an arc runs from the bucket it wanted to the one it settled for.'
          },
          {
            kind: 'example',
            code: fence('hash', 'buckets: 8\nprobe: linear\nkeys: 12 20 28 5 13'),
            caption: 'Five keys, four of them colliding — the arcs are the walk.'
          },
          {
            kind: 'note',
            text: 'To draw a table from a book instead, write the buckets out as `3: apple banana` and leave `keys:` off. You cannot do both: a computed table and a typed one would disagree, and the computed one is the reason for the fence.'
          }
        ]
      },
      {
        title: 'chart — growth, predicted or measured',
        blocks: [
          {
            kind: 'example',
            code: fence('chart', 'x: 1..64\nn\nn log n\nn^2')
          },
          {
            kind: 'p',
            text: 'A series is either an expression in `n` or a row of numbers, and both draw on the same axes. Juxtaposition is multiplication, so `n log n` is what it looks like, and `log` is base two. Curves are named at their right-hand end rather than in a legend.'
          },
          {
            kind: 'table',
            head: ['Line or directive', 'Does'],
            mono: true,
            rows: [
              ['n^2 / 4', 'A curve, labelled with itself'],
              ['f = 3n + 40', 'The same, named'],
              ['measured: 12 26 55', 'Readings — drawn dashed, with dots'],
              ['x: 1..64', 'The domain; or `x: 1 2 4 8` to name the points'],
              ['y: 0..500', 'Fix the vertical range'],
              ['log: xy', 'Logarithmic axes — `log: y` for one of them'],
              ['mark: 14 n₀', 'A rule across, labelled'],
              ['bars:', 'Bars rather than lines'],
              ['xlabel: / ylabel:', 'Names the axes — x is `n` unless you say otherwise']
            ]
          },
          {
            kind: 'example',
            code: fence('chart', 'x: 1..40\nmark: 14 n₀\nf = 3n + 40\ncg = n^2 / 4'),
            caption: 'The definition of big-O, drawn: f under c·g from n₀ on.'
          },
          {
            kind: 'p',
            text: 'On log-log axes a polynomial is a straight line whose slope is its exponent, which turns "is this quadratic or is it n log n" from an opinion about a shape into something you can read off the page. Functions are: log, ln, log10, sqrt, exp, abs, floor, ceil.'
          }
        ]
      },
      {
        title: 'algo — an algorithm, running',
        blocks: [
          {
            kind: 'example',
            code: fence(
              'algo',
              'title: Bubble sort\narray: 5 3 8 1 9\nspeed: 500\n---\nnote Walk the pairs, swapping any out of order\ncompare 0 1\nswap 0 1\ncompare 1 2\nmark 4 sorted'
            )
          },
          {
            kind: 'p',
            text: 'A structure — `array:`, `stack:`, `queue:`, `list:`, or `bst:`/`heap:`/`level:` for a traversal over a tree — then one step per line. Every step is a frame, and the transport under the figure plays, steps and scrubs them.'
          },
          {
            kind: 'table',
            head: ['Step', 'Does'],
            mono: true,
            rows: [
              ['compare i j', 'Lights those slots for one frame'],
              ['swap i j', 'Swaps them'],
              ['set i v', 'Writes a value'],
              ['mark i sorted', 'A lasting mark; `mark 0..3 done` for a span'],
              ['unmark i / unmark all', 'Takes it off'],
              ['at lo 0', 'A named pointer under a slot; `at lo off` removes it'],
              ['range 2 5', 'A bracket over a span; `range window 2 5` labels it'],
              ['push v / pop', 'And enqueue / dequeue, insert i v, remove i'],
              ['visit 7', "In a tree, addressed by the node's label"],
              ['note …', 'The caption for this frame onward']
            ]
          },
          {
            kind: 'p',
            text: 'Nothing plays until it is asked to. `autoplay: true` overrides that, `loop: true` runs it round, and `speed:` is the milliseconds a frame is held. Printing cannot play, so an `algo` block exports as a strip of stills.'
          },
          {
            kind: 'p',
            text: '`stills:` asks for that strip on screen as well, and then you choose the frames. That is what a **loop invariant** is: not an animation but three pictures — on entry, held, on exit — with the argument being what stayed true across them. A block with `stills:` gets no transport, because the figure is not about time.'
          },
          {
            kind: 'example',
            code: fence(
              'algo',
              'array: 5 3 8 1 9 2\nstills: 0 4 -1\n---\nrange sorted 0 0\nnote On entry: b = 0, nothing is sorted\ncompare 0 1\nswap 0 1\nrange sorted 0 1\nnote Held: 0..b is sorted, b..n is not\nmark 0..5 sorted\nrange sorted 0 5\nnote On exit: b = n, so all of it is sorted'
            ),
            caption: 'Step numbers, counting from 0. A negative one counts from the end.'
          },
          {
            kind: 'note',
            text: 'A bare `stills:` picks the frames the way printing does — the ones carrying a `note`, plus the ends.'
          }
        ]
      },
      {
        title: 'Shared annotations',
        blocks: [
          {
            kind: 'table',
            head: ['After a label', 'Does'],
            mono: true,
            rows: [
              ['*', 'Rings it'],
              ['~', 'Fades it'],
              ['#red', 'Colours it — also green, blue, yellow, purple, gray'],
              ['| text', 'Adds a second, smaller line']
            ]
          }
        ]
      },
      {
        title: 'Asking Claude for one',
        blocks: [
          {
            kind: 'p',
            text: '**Animate an algorithm** in the command palette, or `/animated` in a note, asks Claude for the whole run. The block appears immediately as a placeholder and is replaced in one edit when the answer lands — keep writing underneath it.'
          },
          {
            kind: 'example',
            code: fence('algo', 'pending: mtsr2tuc1\nprompt: Selection sort over 7 2 9 4'),
            caption: 'The placeholder is ordinary source, legible after a restart.'
          }
        ]
      },
      {
        title: "Drawing a Java block's objects",
        blocks: [
          {
            kind: 'p',
            text: 'A Java block has a second button: **Diagram**. It runs the block and writes a `boxes` figure under it of the objects it left behind — drawn from the heap, not from the source, so two variables that turned out to be one object come out as one box with two arrows into it.'
          },
          {
            kind: 'table',
            head: ['Block', 'Roots'],
            rows: [
              ['Statements, with or without classes', 'Every variable it declares'],
              ['A class with a `main`', 'The locals of `main`']
            ]
          },
          {
            kind: 'note',
            text: 'Pressing Diagram again replaces the one it wrote last time — a `# drawn from the Java block above` comment is how it knows which is its. Edit that figure and it is yours; the next press leaves it alone. Needs a JDK 11 or newer.'
          }
        ]
      }
    ]
  },

  // ----------------------------------------------------------------- canvas
  {
    id: 'canvas',
    title: 'Canvas',
    blurb: 'An infinite board, saved as JSON Canvas.',
    keywords: 'canvas board card arrow jsoncanvas obsidian infinite whiteboard',
    sections: [
      {
        title: 'The board',
        blocks: [
          {
            kind: 'p',
            text: 'Cards you place yourself, notes embedded as cards, and arrows between them. Drag from any edge of a card to connect it; scroll to pan, `Cmd`-scroll to zoom.'
          },
          {
            kind: 'p',
            text: 'It saves as a `.canvas` file in the vault in the **JSON Canvas** format, which is what Obsidian uses — so a board made here opens there. Anything in the file Stone does not understand is carried through a save untouched.'
          },
          {
            kind: 'note',
            text: 'Canvas is hidden from the view bar by default. Turn it on under Settings › Appearance, or press `Cmd 7`.'
          }
        ]
      }
    ]
  },

  // -------------------------------------------------------------- documents
  {
    id: 'documents',
    title: 'Documents',
    blurb: 'PDFs in watched folders, opened in a pane like a note.',
    keywords: 'pdf document library folder watch search extract text epub paper',
    sections: [
      {
        title: 'Watched folders',
        blocks: [
          {
            kind: 'p',
            text: 'Point Stone at a folder of PDFs and they appear in the sidebar under **Docs**, answer to `[[wikilinks]]`, turn up in `Ctrl/Cmd K`, and open in a pane exactly like a note. Nothing is moved, copied or rewritten unless you ask for it.'
          },
          {
            kind: 'p',
            text: '**Add folder** is in three places and all three do the same thing: the Docs tab when it is empty, the header of the `Cmd 8` gallery, and Settings › Documents.'
          }
        ]
      },
      {
        title: 'What is searchable',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Scanned PDFs have no text and never will here.** There is no OCR.',
              '**Some fonts defeat extraction.** Where a font maps glyphs through a private encoding, Stone indexes nothing rather than filling search with noise.',
              '**Only PDFs are read.** Any other file type is indexed by name alone.',
              '**An evicted iCloud file is not on the machine.** Those are listed, marked, and have a Download button.'
            ]
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------ audio
  {
    id: 'audio',
    title: 'Recording and transcripts',
    blurb: 'Record a lecture; every block is stamped with its moment.',
    keywords: 'audio record recording lecture transcript transcribe stamp timestamp playback mic',
    sections: [
      {
        title: 'Stamped notes',
        blocks: [
          {
            kind: 'p',
            text: 'While a recording runs, every new block you start gets the moment it was started written in front of it. Click one during playback and the audio jumps there; while it plays, the block whose moment has just passed is lit.'
          },
          {
            kind: 'example',
            code: '[04:12](recording.webm#t=252) The bit about eigenvalues',
            caption: 'The stamp is an ordinary markdown link — the note keeps working elsewhere.'
          },
          {
            kind: 'p',
            text: 'The **Transcript** panel holds the transcription once it has been made, and follows along with playback.'
          }
        ]
      }
    ]
  },

  // ----------------------------------------------------------------- claude
  {
    id: 'claude',
    title: 'Asking Claude',
    blurb: 'Six modes, from a diagram to an agent with tools.',
    keywords: 'claude ai ask agent diagram drawing structure code markdown prompt',
    sections: [
      {
        title: 'The modes',
        blocks: [
          {
            kind: 'table',
            head: ['Mode', 'Asks for'],
            rows: [
              ['Diagram', 'A Mermaid diagram of what you describe'],
              ['Drawing', 'An inline SVG picture'],
              ['Structure', 'A `memory`, `boxes`, `tree` or `algo` figure'],
              ['Code', 'A fenced block in a language you name'],
              ['Markdown', 'Ordinary prose, a table, a list'],
              ['Agent', 'Work done in the vault, with tools']
            ]
          },
          {
            kind: 'p',
            text: 'A selection is context rather than the question: highlight your own quicksort, ask for "this, on 7 2 9 4", and it animates what you highlighted. The answer goes in below the caret, never over the selection.'
          }
        ]
      }
    ]
  },

  // ---------------------------------------------------------------- capture
  {
    id: 'capture',
    title: 'Capture and the web clipper',
    blurb: 'Get something into the vault without opening the window.',
    keywords: 'capture quick add global shortcut menu bar url scheme stone:// clipper bookmarklet browser',
    sections: [
      {
        title: 'From outside the app',
        blocks: [
          {
            kind: 'list',
            items: [
              'A **global shortcut** — `Ctrl/Cmd Shift Space` by default, rebindable.',
              'A **menu-bar icon**, so capture survives the window being closed.',
              '**`stone://` links**, which any script or app can fire.'
            ]
          },
          {
            kind: 'example',
            code: 'stone://capture?text=Buy%20milk\nstone://open?path=Projects/Website.md\nstone://daily',
            caption: 'The three URL routes.'
          }
        ]
      },
      {
        title: 'The web clipper',
        blocks: [
          {
            kind: 'p',
            text: 'Turn it on in Settings › Capture and Stone listens on `127.0.0.1` for pages sent from the browser. Clicking its bookmarklet sends your selection — or the whole article when nothing is selected — into your clippings folder as markdown, with the source URL in frontmatter.'
          },
          {
            kind: 'note',
            text: 'It is off unless you turn it on, bound to loopback, and every request carries a secret only your bookmarklet knows: any page in your browser can reach a localhost port, and the token is what separates yours from a site that guessed the number.'
          }
        ]
      }
    ]
  },

  // ------------------------------------------------------------------- sync
  {
    id: 'sync',
    title: 'Sync, versions and backups',
    blurb: 'Safe writes over iCloud, Drive, Dropbox or OneDrive.',
    keywords: 'sync icloud dropbox onedrive drive conflict atomic snapshot backup version history restore trash',
    sections: [
      {
        title: 'What Stone guarantees',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Atomic writes.** Every save goes to a temp file, is flushed, then renamed over the target. A sync client can never see a half-written note.',
              '**Conflict copies.** A file changed underneath you is preserved as `Note (conflict …).md` before writing. Nothing is overwritten silently.',
              '**Debounced watching**, because sync engines rewrite files in bursts.',
              '**Deletes go to `.trash`** inside the vault, not to `unlink`.'
            ]
          }
        ]
      },
      {
        title: 'Version history',
        blocks: [
          {
            kind: 'p',
            text: 'Every save that changes a note archives the version it replaced. `.stone/snapshots` keeps a rolling 25 per note and can be switched off; `.stone/backups` keeps every one permanently, is never pruned, and cannot be switched off. The **Versions** panel shows one row per version and marks the permanent ones `kept`.'
          },
          {
            kind: 'note',
            text: 'Backups are immutable — written once under a name never reused, then made read-only. No save, rename, delete or plugin can write inside `.stone/backups`.'
          }
        ]
      }
    ]
  },

  // ----------------------------------------------------------------- extend
  {
    id: 'extend',
    title: 'Themes and plugins',
    blurb: 'One CSS file, or a sandboxed folder of JavaScript.',
    keywords: 'theme css snippet plugin manifest permission sandbox extension api',
    sections: [
      {
        title: 'Themes',
        blocks: [
          {
            kind: 'p',
            text: "A theme is one `.css` file in the vault's theme folder, chosen in Settings. Snippets stack on top of whichever theme is in force — one is replaced, the others accumulate."
          }
        ]
      },
      {
        title: 'Plugins',
        blocks: [
          {
            kind: 'p',
            text: 'A plugin is a folder under `.stone/plugins` with a `manifest.json` and a `main.js`:'
          },
          {
            kind: 'example',
            code: "stone.addCommand({\n  id: 'count',\n  name: 'Count my notes',\n  callback: async () => {\n    const notes = await stone.vault.list()\n    stone.notice(`You have ${notes.length} notes.`)\n  }\n})"
          },
          {
            kind: 'p',
            text: 'A plugin runs in an offscreen window with no vault access, no network and no view of the interface. Everything it can do arrives back over IPC as a small set of verbs, each checked against the permissions its manifest declared and you approved.'
          },
          {
            kind: 'note',
            text: 'The honest cost: a plugin cannot draw its own interface, because it has no DOM to draw into. It can add commands, respond to events, and read and write notes.'
          }
        ]
      }
    ]
  },

  // -------------------------------------------------------------- keyboard
  {
    id: 'keyboard',
    title: 'Keyboard',
    blurb: 'Every chord, and how to change it.',
    keywords: 'keyboard shortcut chord binding key rebind palette',
    sections: [
      {
        title: 'The defaults',
        blocks: [
          {
            kind: 'table',
            head: ['Key', 'Does'],
            mono: true,
            rows: [
              ['Ctrl/Cmd K', 'Search everything, or run a command'],
              ['Ctrl/Cmd J', 'Quick-add a task from anywhere'],
              ['Ctrl/Cmd T', 'Jump to today'],
              ['Ctrl/Cmd N', 'New note'],
              ['Ctrl/Cmd 1–8', 'Today, Notes, Calendar, Tasks, Graph, Views, Canvas, Documents'],
              ['Ctrl/Cmd B, I', 'Bold, italic'],
              ['Ctrl/Cmd Shift M', 'Highlight'],
              ['Ctrl/Cmd Shift 8', 'Bullet list'],
              ['Tab / Shift Tab', 'Nest a list item, or lift it out'],
              ['Alt ↑ / ↓', 'Move a list item, with its children'],
              ['Ctrl/Cmd Shift K', 'Hyperlink'],
              ['Ctrl/Cmd Enter', 'Turn the line into a task, or cycle its status'],
              ['Ctrl/Cmd Shift Enter', 'Run the code block the caret is in'],
              ['Ctrl/Cmd Shift Space', 'Capture, from any app']
            ]
          },
          {
            kind: 'p',
            text: 'Every one is rebindable. Settings › Keyboard lists each command with the chords bound to it; click one to remove it, or record another. Bindings are stored by command id, so they survive an update.'
          }
        ]
      }
    ]
  }
]

/** A topic by id, for opening the panel straight at one. */
export function docTopic(id: string): DocTopic | null {
  return DOC_TOPICS.find((topic) => topic.id === id) ?? null
}

/** Every string in a block that search should look inside. */
function blockText(block: DocBlock): string {
  switch (block.kind) {
    case 'p':
    case 'note':
      return block.text
    case 'list':
      return block.items.join(' ')
    case 'table':
      return [...block.head, ...block.rows.flat()].join(' ')
    case 'example':
      return `${block.code} ${block.caption ?? ''}`
  }
}

export interface DocHit {
  topic: DocTopic
  /** The section that matched, when the match was inside one. */
  section: DocSection | null
  /** A line of context under the title, already trimmed to something readable. */
  excerpt: string
}

/**
 * Search the manual.
 *
 * Every term has to appear somewhere in the topic, which is what makes "tree
 * traverse" find the one section rather than every topic mentioning a tree. A
 * topic whose own title or keywords match is returned whole; otherwise the
 * hits are its sections, so searching for `swap` lands on `algo` rather than on
 * the top of a long page about figures.
 */
export function searchDocs(query: string): DocHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return DOC_TOPICS.map((topic) => ({ topic, section: null, excerpt: topic.blurb }))

  const hits: DocHit[] = []

  for (const topic of DOC_TOPICS) {
    const heading = `${topic.title} ${topic.blurb} ${topic.keywords}`.toLowerCase()
    if (terms.every((term) => heading.includes(term))) {
      hits.push({ topic, section: null, excerpt: topic.blurb })
      continue
    }

    for (const section of topic.sections) {
      const body = `${heading} ${section.title} ${section.blocks.map(blockText).join(' ')}`.toLowerCase()
      if (!terms.every((term) => body.includes(term))) continue

      // The excerpt is the first prose in the section, since a table of tokens
      // read out as one line is noise rather than context.
      const prose = section.blocks.find((block) => block.kind === 'p' || block.kind === 'note')
      hits.push({
        topic,
        section,
        excerpt: prose ? blockText(prose).replace(/[`*]/g, '').slice(0, 120) : topic.blurb
      })
    }
  }

  return hits
}

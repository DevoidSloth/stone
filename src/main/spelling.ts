import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'

/**
 * The right-click menu for a misspelled word.
 *
 * Chromium already finds the misspellings — `webPreferences.spellcheck` turns
 * that on, and macOS lends its own dictionaries — but Electron ships no menu to
 * act on them. Without this the red underline is decoration: there is nowhere
 * to accept a correction or teach the dictionary a word, which is most of what
 * a spellchecker is for.
 *
 * The editing items come along because a context menu inside a text field that
 * offers no Cut or Paste reads as broken, and the renderer has no way to draw a
 * native one.
 */
export function registerSpellingMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    const { editFlags, isEditable, misspelledWord, selectionText } = params

    if (misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
      }
      // A word the dictionary cannot guess at still deserves the row that says
      // so, rather than a menu that opens onto "Add to dictionary" alone.
      if (params.dictionarySuggestions.length === 0) {
        items.push({ label: 'No spelling suggestions', enabled: false })
      }
      items.push(
        { type: 'separator' },
        {
          label: `Add “${misspelledWord}” to dictionary`,
          click: () => contents.session.addWordToSpellCheckerDictionary(misspelledWord)
        },
        { type: 'separator' }
      )
    }

    if (isEditable || selectionText) {
      items.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    }

    // Right-clicking the page background is not a request for an empty menu.
    if (items.length === 0) return

    const win = BrowserWindow.fromWebContents(contents)
    Menu.buildFromTemplate(items).popup(win ? { window: win } : undefined)
  })
}

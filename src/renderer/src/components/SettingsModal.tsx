import { useRef } from 'react'
import { useStone } from '../store'
import { KeybindingSettings } from './KeybindingSettings'
import { CaptureSettings } from './CaptureSettings'
import { ExtensionSettings } from './ExtensionSettings'
import { ClaudeSettings } from './ClaudeSettings'
import { CodeSettings } from './CodeSettings'
import { PdfSettings } from './PdfSettings'
import { IconPlus, IconTrash, IconX } from '../ui/icons'
import { useFocusTrap } from '../lib/focus-trap'

/**
 * System first, because that is what a Mac app is expected to do and what the
 * default now is. The two named themes are the override, not the choice.
 */
const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Limestone' },
  { id: 'dark', label: 'Basalt' },
  { id: 'tango', label: 'Tango' }
] as const

/** Below 11 the live-preview widgets stop lining up; above 28 nothing fits. */
const MIN_FONT = 11
const MAX_FONT = 28

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

export function SettingsModal() {
  const open = useStone((s) => s.settingsOpen)
  const setOpen = useStone((s) => s.setSettingsOpen)
  const settings = useStone((s) => s.settings)
  const vaultPath = useStone((s) => s.vaultPath)
  const updateSettings = useStone((s) => s.updateSettings)
  const openFolderHere = useStone((s) => s.openFolderHere)
  const openFolderInNewWindow = useStone((s) => s.openFolderInNewWindow)
  const addLibraryFolder = useStone((s) => s.addLibraryFolder)
  const removeLibraryFolder = useStone((s) => s.removeLibraryFolder)
  const refreshVault = useStone((s) => s.refreshVault)
  const toast = useStone((s) => s.toast)
  const dialog = useRef<HTMLDivElement>(null)

  useFocusTrap(dialog, open)

  if (!open || !settings) return null

  return (
    <div className="overlay overlay--center" onMouseDown={() => setOpen(false)} role="presentation">
      <div
        className="modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title">Settings</h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            style={{ marginLeft: 'auto' }}
            aria-label="Close settings"
            onClick={() => setOpen(false)}
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="modal__body">
          {/* ---------------------------------------------------------- vault */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Vault
            </div>
            <div className="row">
              <div className="row__label">
                <b>Folder</b>
                <span className="mono truncate">{vaultPath ?? 'No vault chosen'}</span>
              </div>
              <div className="chips" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openFolderInNewWindow()}>
                  Open in new window…
                </button>
                <button type="button" className="btn" onClick={() => void openFolderHere()}>
                  Change
                </button>
              </div>
            </div>
            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>New notes folder</b>
                <span>Where notes land when created from the palette.</span>
              </div>
              <input
                className="field"
                style={{ width: 160 }}
                value={settings.inboxFolder}
                onChange={(e) => void updateSettings({ inboxFolder: e.target.value })}
              />
            </div>
          </section>

          <div className="divider" />

          {/* ----------------------------------------------------- appearance */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Appearance
            </div>
            <div className="row">
              <div className="row__label">
                <b>Theme</b>
                <span>Limestone, basalt, Tango, or whichever the system is using.</span>
              </div>
              <div className="segmented">
                {THEMES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className="segmented__btn"
                    aria-selected={settings.theme === id}
                    onClick={() => void updateSettings({ theme: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Editor text size</b>
                <span>The prose measure grows with it, so the line length stays right.</span>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label="Smaller"
                  disabled={settings.editorFontSize <= MIN_FONT}
                  onClick={() =>
                    void updateSettings({
                      editorFontSize: Math.max(MIN_FONT, settings.editorFontSize - 1)
                    })
                  }
                >
                  −
                </button>
                <span className="stepper__value mono">{settings.editorFontSize}px</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label="Larger"
                  disabled={settings.editorFontSize >= MAX_FONT}
                  onClick={() =>
                    void updateSettings({
                      editorFontSize: Math.min(MAX_FONT, settings.editorFontSize + 1)
                    })
                  }
                >
                  +
                </button>
              </div>
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Editor typeface</b>
                <span>Serif reads best for long prose; mono for code-heavy notes.</span>
              </div>
              <div className="segmented">
                {(['serif', 'sans', 'mono'] as const).map((font) => (
                  <button
                    key={font}
                    type="button"
                    className="segmented__btn"
                    aria-selected={settings.editorFont === font}
                    onClick={() => void updateSettings({ editorFont: font })}
                  >
                    {font[0].toUpperCase() + font.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Line width</b>
                <span>{settings.editorWidth}px of measure.</span>
              </div>
              <input
                type="range"
                min={560}
                max={1000}
                step={20}
                value={settings.editorWidth}
                aria-label="Editor line width"
                onChange={(e) => void updateSettings({ editorWidth: Number(e.target.value) })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Show Canvas in the view bar</b>
                <span>
                  Off by default. The palette and {window.stone.platform === 'darwin' ? '⌘7' : 'Ctrl 7'}{' '}
                  still open it either way.
                </span>
              </div>
              <Toggle
                label="Show Canvas"
                checked={settings.showCanvas}
                onChange={(next) => void updateSettings({ showCanvas: next })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Week starts on Monday</b>
                <span>Affects the month grid and week view.</span>
              </div>
              <Toggle
                label="Week starts on Monday"
                checked={settings.weekStartsOn === 1}
                onChange={(next) => void updateSettings({ weekStartsOn: next ? 1 : 0 })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>CSS snippets</b>
                <span>
                  Stylesheets inside the vault, applied on top of the theme. They sync with the
                  folder, so a look travels with the notes.
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  void window.stone.vault
                    .pickCssSnippet()
                    .then((relPath) => {
                      if (!relPath) return
                      const next = [...new Set([...settings.cssSnippets, relPath])]
                      void updateSettings({ cssSnippets: next })
                    })
                    .catch((err: Error) => toast(err.message, 'error'))
                }}
              >
                Add a snippet
              </button>
            </div>
            {settings.cssSnippets.length > 0 && (
              <div className="chips">
                {settings.cssSnippets.map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    className="tagchip"
                    data-tip="Remove this snippet"
                    onClick={() =>
                      void updateSettings({
                        cssSnippets: settings.cssSnippets.filter((s) => s !== snippet)
                      })
                    }
                  >
                    {snippet}
                    <b>remove</b>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="divider" />

          <KeybindingSettings />

          <div className="divider" />

          <CaptureSettings />

          <div className="divider" />

          <ExtensionSettings />

          <div className="divider" />

          <ClaudeSettings />

          <div className="divider" />

          <CodeSettings />

          <div className="divider" />

          <PdfSettings />

          <div className="divider" />

          {/* --------------------------------------------------------- editor */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Editing
            </div>

            <div className="row">
              <div className="row__label">
                <b>Vim keybindings</b>
                <span>Modal editing, with a status line under the page.</span>
              </div>
              <Toggle
                label="Vim keybindings"
                checked={settings.vimMode}
                onChange={(next) => void updateSettings({ vimMode: next })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Check spelling</b>
                <span>Uses the operating system dictionaries.</span>
              </div>
              <Toggle
                label="Check spelling"
                checked={settings.spellcheck}
                onChange={(next) => void updateSettings({ spellcheck: next })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Keep earlier versions</b>
                <span>
                  A copy of each note is kept under <code>.stone/snapshots</code> when it changes,
                  so a bad edit is recoverable after autosave has run.
                </span>
              </div>
              <Toggle
                label="Keep earlier versions"
                checked={settings.snapshotsEnabled}
                onChange={(next) => void updateSettings({ snapshotsEnabled: next })}
              />
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Remind me</b>
                <span>
                  A notification when a task with a time falls due, or an event is about to start.
                </span>
              </div>
              <Toggle
                label="Reminders"
                checked={settings.remindersEnabled}
                onChange={(next) => void updateSettings({ remindersEnabled: next })}
              />
            </div>

            {settings.remindersEnabled && (
              <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
                <div className="row__label">
                  <b>How much warning</b>
                  <span>{settings.reminderLeadMinutes} minutes beforehand.</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={settings.reminderLeadMinutes}
                  aria-label="Reminder lead time"
                  onChange={(e) =>
                    void updateSettings({ reminderLeadMinutes: Number(e.target.value) })
                  }
                />
              </div>
            )}
          </section>

          <div className="divider" />

          {/* ------------------------------------------------------- transfer */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Import and export
            </div>

            <div className="row">
              <div className="row__label">
                <b>Import notes</b>
                <span>
                  Notion and Apple Notes export folders, Evernote <code>.enex</code> files, or any
                  folder of markdown. Notion&rsquo;s hashed filenames and property blocks are
                  converted as they come in.
                </span>
              </div>
              <div className="chips">
                {(
                  [
                    ['notion', 'Notion'],
                    ['evernote', 'Evernote'],
                    ['appleNotes', 'Apple Notes'],
                    ['markdown', 'Markdown']
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      void window.stone.importer
                        .run(kind, `Imported/${label}`)
                        .then((result) => {
                          if (!result) return
                          void refreshVault()
                          toast(
                            `${result.imported} note${result.imported === 1 ? '' : 's'} imported into ${result.folder}.`,
                            'success'
                          )
                          for (const warning of result.warnings.slice(0, 3)) toast(warning, 'error')
                        })
                        .catch((err: Error) => toast(err.message, 'error'))
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Export the vault</b>
                <span>A plain copy of every note, with the folder tree intact.</span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  void window.stone.exporter
                    .vault()
                    .then((result) => {
                      if (result) {
                        toast(`${result.count} notes exported to ${result.folder}.`, 'success')
                      }
                    })
                    .catch((err: Error) => toast(err.message, 'error'))
                }}
              >
                Choose a folder
              </button>
            </div>
          </section>

          <div className="divider" />

          {/* ------------------------------------------------------ documents */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Documents
            </div>

            <div className="row">
              <div className="row__label">
                <b>Watched folders</b>
                <span>
                  Folders of PDFs Stone indexes. They appear under Docs in the sidebar, answer to{' '}
                  <code>[[wikilinks]]</code>, and their text turns up in search. Nothing is moved or
                  rewritten.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void addLibraryFolder('index')}
                >
                  <IconPlus size={13} />
                  Watch a folder
                </button>
                <button
                  type="button"
                  className="btn"
                  data-tip="Copy anything new into the vault's attachments folder, so the vault stays self-contained"
                  onClick={() => void addLibraryFolder('copy')}
                >
                  Import a folder
                </button>
              </div>
            </div>

            {settings.libraryFolders.length === 0 ? (
              <p className="hint" style={{ marginTop: 'var(--sp-3)' }}>
                No folders yet.
              </p>
            ) : (
              <div style={{ marginTop: 'var(--sp-3)' }}>
                {settings.libraryFolders.map((folder) => (
                  <div key={folder.id} className="row" style={{ marginTop: 'var(--sp-2)' }}>
                    <div className="row__label">
                      <b>{folder.label}</b>
                      <span className="mono truncate">{folder.path}</span>
                    </div>
                    <span className="hint">{folder.mode === 'copy' ? 'copies in' : 'in place'}</span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      aria-label={`Stop watching ${folder.label}`}
                      data-tip="Stop watching this folder. The files themselves are left alone."
                      onClick={() => void removeLibraryFolder(folder.id)}
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

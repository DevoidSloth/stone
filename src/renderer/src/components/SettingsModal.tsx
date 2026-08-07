import { useEffect, useState } from 'react'
import { useStone } from '../store'
import { IconCloud, IconPlus, IconRefresh, IconTrash, IconX } from '../ui/icons'

const FEED_COLORS = ['#e0a94a', '#45c79a', '#8891ff', '#ee6b6b', '#4fa8d8', '#b07ce0']

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
  const accounts = useStone((s) => s.accounts)
  const errors = useStone((s) => s.calendarErrors)
  const updateSettings = useStone((s) => s.updateSettings)
  const refreshAccounts = useStone((s) => s.refreshAccounts)
  const loadCalendar = useStone((s) => s.loadCalendar)
  const refreshVault = useStone((s) => s.refreshVault)
  const toast = useStone((s) => s.toast)

  const [feedName, setFeedName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [msConnected, setMsConnected] = useState(false)
  const [devicePrompt, setDevicePrompt] = useState<{ userCode: string; uri: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void window.stone.microsoft.status().then((s) => setMsConnected(s.connected))
    void refreshAccounts()
  }, [open, refreshAccounts])

  if (!open || !settings) return null

  const chooseVault = async (): Promise<void> => {
    const picked = await window.stone.vault.choose()
    if (!picked) return
    await window.stone.vault.open(picked)
    await updateSettings({ vaultPath: picked })
    window.location.reload()
  }

  const addFeed = async (): Promise<void> => {
    if (!feedUrl.trim()) return
    try {
      const color = FEED_COLORS[settings.icsSubscriptions.length % FEED_COLORS.length]
      await window.stone.calendar.addSubscription(
        feedName.trim() || 'Subscribed calendar',
        feedUrl.trim(),
        color
      )
      setFeedName('')
      setFeedUrl('')
      await refreshAccounts()
      await loadCalendar(true)
      toast('Calendar subscribed.', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const connectMicrosoft = async (): Promise<void> => {
    if (!clientId.trim()) {
      toast('Paste the application (client) ID from your Azure app registration first.', 'error')
      return
    }
    setBusy(true)
    try {
      const prompt = await window.stone.microsoft.begin(clientId.trim())
      setDevicePrompt({ userCode: prompt.userCode, uri: prompt.verificationUri })
      await window.stone.shell.openExternal(prompt.verificationUri)
      await window.stone.microsoft.complete(
        clientId.trim(),
        prompt.deviceCode,
        prompt.interval,
        prompt.expiresIn
      )
      setMsConnected(true)
      setDevicePrompt(null)
      await refreshAccounts()
      await loadCalendar(true)
      toast('Outlook calendar connected.', 'success')
    } catch (err) {
      setDevicePrompt(null)
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay overlay--center" onMouseDown={() => setOpen(false)} role="presentation">
      <div
        className="modal"
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
                <span className="mono truncate">{settings.vaultPath ?? 'No vault chosen'}</span>
              </div>
              <button type="button" className="btn" onClick={() => void chooseVault()}>
                Change
              </button>
            </div>
            <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="row__label">
                <b>Daily notes folder</b>
                <span>Where day notes are filed, named by date.</span>
              </div>
              <input
                className="field"
                style={{ width: 160 }}
                value={settings.dailyFolder}
                onChange={(e) => void updateSettings({ dailyFolder: e.target.value })}
              />
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
                <span>Basalt or limestone.</span>
              </div>
              <div className="segmented">
                {(['dark', 'light'] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    className="segmented__btn"
                    aria-selected={settings.theme === theme}
                    onClick={() => void updateSettings({ theme })}
                  >
                    {theme === 'dark' ? 'Basalt' : 'Limestone'}
                  </button>
                ))}
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
                    title="Remove this snippet"
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

          {/* ------------------------------------------------------ calendars */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)' }}>
              Calendars
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                style={{ marginLeft: 'auto' }}
                aria-label="Refresh calendars"
                title="Refresh calendars"
                onClick={() => {
                  void refreshAccounts()
                  void loadCalendar(true)
                }}
              >
                <IconRefresh size={13} />
              </button>
            </div>

            {errors.length > 0 && (
              <div className="banner" style={{ marginBottom: 'var(--sp-3)' }}>
                <span>{errors.join(' · ')}</span>
              </div>
            )}

            <div className="callist">
              {accounts.map((account) => (
                <div key={account.id} className="calrow">
                  <span className="calrow__swatch" style={{ background: account.color }} />
                  <span className="calrow__name truncate">{account.name}</span>
                  <span className="calrow__src">
                    {account.source === 'macos'
                      ? 'Apple'
                      : account.source === 'graph'
                        ? 'Outlook'
                        : account.source === 'ics'
                          ? 'Feed'
                          : 'Vault'}
                  </span>
                  <Toggle
                    label={`Show ${account.name}`}
                    checked={account.enabled}
                    onChange={(next) => {
                      void window.stone.calendar
                        .setEnabled(account.id, next)
                        .then(() => refreshAccounts())
                        .then(() => loadCalendar(true))
                    }}
                  />
                  {account.source === 'ics' && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Remove ${account.name}`}
                      onClick={() => {
                        void window.stone.calendar
                          .removeSubscription(account.id)
                          .then(() => refreshAccounts())
                          .then(() => loadCalendar(true))
                      }}
                    >
                      <IconTrash size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {window.stone.platform === 'darwin' && (
              <p className="row__label" style={{ marginTop: 'var(--sp-3)' }}>
                <span>
                  Apple Calendar is read and written directly through EventKit. macOS will ask for
                  permission the first time.
                </span>
              </p>
            )}
          </section>

          <div className="divider" />

          {/* ---------------------------------------------------- subscribe */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Subscribe to a calendar
            </div>
            <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
              <span>
                Paste a secret iCal address. Google Calendar publishes one under Settings › Integrate
                calendar, and Outlook under Settings › Shared calendars. Works on both platforms with
                no sign-in.
              </span>
            </p>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <input
                className="field"
                style={{ flex: '0 0 150px' }}
                placeholder="Name"
                value={feedName}
                onChange={(e) => setFeedName(e.target.value)}
              />
              <input
                className="field"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addFeed()
                }}
              />
              <button type="button" className="btn btn--primary" onClick={() => void addFeed()}>
                <IconPlus size={13} />
                Add
              </button>
            </div>
          </section>

          <div className="divider" />

          {/* ---------------------------------------------------- microsoft */}
          <section>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
              Outlook and Windows Calendar
            </div>

            {msConnected ? (
              <div className="row">
                <div className="row__label">
                  <b>Connected</b>
                  <span>Events sync both ways with your Microsoft account.</span>
                </div>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    void window.stone.microsoft
                      .signOut()
                      .then(() => setMsConnected(false))
                      .then(() => refreshAccounts())
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <>
                <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
                  <span>
                    Windows Calendar and Outlook are both views onto a Microsoft account, so Stone
                    talks to it through Microsoft Graph. Register a free public client app in the
                    Azure portal, allow the <span className="mono">Calendars.ReadWrite</span> scope,
                    then paste its application ID here. Using your own registration keeps the
                    connection yours to revoke.
                  </span>
                </p>
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <input
                    className="field"
                    placeholder="Application (client) ID"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => void connectMicrosoft()}
                  >
                    <IconCloud size={13} />
                    {busy ? 'Waiting…' : 'Connect'}
                  </button>
                </div>
                {devicePrompt && (
                  <div className="banner banner--info" style={{ marginTop: 'var(--sp-3)' }}>
                    <span>
                      Enter code <b className="mono">{devicePrompt.userCode}</b> at{' '}
                      {devicePrompt.uri}. This window will finish once you approve.
                    </span>
                  </div>
                )}
              </>
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

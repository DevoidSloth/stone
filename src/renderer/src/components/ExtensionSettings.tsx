import { useEffect, useState } from 'react'
import type { LoadedPlugin, ThemeInfo } from '@shared/types'
import { useStone } from '../store'
import { IconPalette, IconPuzzle, IconRefresh } from '../ui/icons'

/**
 * Themes and plugins.
 *
 * Both live inside the vault, so they travel with the notes rather than with
 * the install — move the folder to another machine and the look and the
 * behaviour come with it.
 *
 * The permissions a plugin declares are listed before it can be switched on,
 * because that switch is the only point at which anyone is in a position to
 * decide. Once it is running the decision has already been made.
 */
export function ExtensionSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const toast = useStone((s) => s.toast)

  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([])

  useEffect(() => {
    void window.stone.vault.themes().then(setThemes).catch(() => setThemes([]))
    void window.stone.plugins.list().then(setPlugins).catch(() => setPlugins([]))
  }, [])

  if (!settings) return null

  const togglePlugin = async (plugin: LoadedPlugin): Promise<void> => {
    try {
      setPlugins(await window.stone.plugins.setEnabled(plugin.id, !plugin.enabled))
      toast(
        plugin.enabled ? `${plugin.name} stopped.` : `${plugin.name} is running.`,
        'success'
      )
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Themes and plugins
      </div>

      <div className="row">
        <div className="row__label">
          <b>
            <IconPalette size={13} /> Theme
          </b>
          <span>
            Stylesheets in <code>{settings.themeFolder}</code> inside the vault. One is in force at a
            time; snippets stack on top of whichever it is.
          </span>
        </div>
        <select
          className="field"
          style={{ width: 200 }}
          value={settings.activeTheme ?? ''}
          onChange={(e) => void updateSettings({ activeTheme: e.target.value || null })}
        >
          <option value="">Stone's own</option>
          {themes.map((theme) => (
            <option key={theme.relPath} value={theme.relPath}>
              {theme.name}
            </option>
          ))}
        </select>
      </div>

      {settings.activeTheme && (
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
          {themes.find((t) => t.relPath === settings.activeTheme)?.description ?? ''}
        </p>
      )}

      <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="row__label">
          <b>
            <IconPuzzle size={13} /> Plugins
          </b>
          <span>
            Folders under <code>.stone/plugins</code>, each with a <code>manifest.json</code> and a{' '}
            <code>main.js</code>. They run in an isolated window with no access to your screen or
            the network — only to the vault, and only as far as their permissions allow.
          </span>
        </div>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            void window.stone.plugins
              .reload()
              .then(setPlugins)
              .then(() => toast('Plugins reloaded.', 'success'))
              .catch((err: Error) => toast(err.message, 'error'))
          }}
        >
          <IconRefresh size={13} /> Reload
        </button>
      </div>

      {plugins.length === 0 && (
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
          Nothing installed yet.
        </p>
      )}

      {plugins.map((plugin) => (
        <div className="row" key={plugin.id} style={{ marginTop: 'var(--sp-3)' }}>
          <div className="row__label">
            <b>
              {plugin.name} <span className="mono">{plugin.version}</span>
            </b>
            {plugin.error ? (
              <span style={{ color: 'var(--danger, #ee6b6b)' }}>{plugin.error}</span>
            ) : (
              <span>
                {plugin.description}
                {plugin.permissions.length > 0 && (
                  <>
                    {plugin.description ? ' ' : ''}
                    Wants: {plugin.permissions.join(', ')}.
                  </>
                )}
              </span>
            )}
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={plugin.enabled}
            aria-label={plugin.name}
            disabled={Boolean(plugin.error)}
            onClick={() => void togglePlugin(plugin)}
          />
        </div>
      ))}
    </section>
  )
}

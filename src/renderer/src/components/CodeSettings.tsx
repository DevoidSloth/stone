import { CODE_LANGUAGES, commandFor } from '@shared/code-langs'
import { useStone } from '../store'
import { COMMANDS_BY_ID, keysFor } from '../commands'
import { formatChord } from '../lib/keys'

/**
 * What a code block runs, and for how long.
 *
 * Every language is one shell command line, which is why this can be a list of
 * text fields rather than a plugin: a machine with pyenv, a project that wants
 * `bun` instead of `node`, a language Stone has never heard of — all of them
 * are the same edit here.
 */
export function CodeSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)

  if (!settings) return null

  const runners = settings.codeRunners
  const command = COMMANDS_BY_ID.get('run-code-block')
  const chord = command ? keysFor(command, settings.keybindings)[0] : null

  const setRunner = (id: string, value: string): void => {
    const next = { ...runners }
    // A cleared field means "use what Stone ships", not "run nothing".
    if (value.trim()) next[id] = value.trim()
    else delete next[id]
    void updateSettings({ codeRunners: next })
  }

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Code
      </div>

      <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
        <span>
          A fenced block in one of these languages gets a Run button under it
          {chord ? `, and ${formatChord(chord)} runs the one the caret is in` : ''}. The block is
          written to a scratch file and run through your login shell, in the note’s folder, with
          your permissions — so it can do anything you can. Stone asks before the first run.
        </span>
      </p>

      <div className="row">
        <div className="row__label">
          <b>Time limit</b>
          <span>Seconds a block may run before it is stopped.</span>
        </div>
        <input
          className="field"
          type="number"
          min={1}
          max={3600}
          style={{ width: 90 }}
          value={settings.codeRunTimeout}
          aria-label="Seconds before a run is stopped"
          onChange={(e) =>
            void updateSettings({
              codeRunTimeout: Math.min(3600, Math.max(1, Number(e.target.value) || 30))
            })
          }
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Shared session</b>
          <span>
            A note’s blocks run into one session per language and go on from one another, the way
            the cells of a notebook do: what the second block declares, the fifth can use, without
            the second being run again. Java, Python, JavaScript and the shells have one; anything
            else runs each block on its own. Add <code>notebook: false</code> to a note’s
            frontmatter to keep its blocks separate, or <code>notebook: true</code> to make one
            note a notebook when this is off.
          </span>
        </div>
        <button
          type="button"
          className="btn"
          role="switch"
          aria-checked={settings.codeNotebook}
          onClick={() => void updateSettings({ codeNotebook: !settings.codeNotebook })}
        >
          {settings.codeNotebook ? 'On' : 'Off'}
        </button>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Confirmation</b>
          <span>
            {settings.codeRunConfirmed
              ? 'Blocks run as soon as you press Run.'
              : 'The next run will ask first.'}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!settings.codeRunConfirmed}
          onClick={() => void updateSettings({ codeRunConfirmed: false })}
        >
          Ask again
        </button>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-4)', alignItems: 'flex-start' }}>
        <div className="row__label">
          <b>Commands</b>
          <span>
            Leave one blank for the default. {'{file}'} is the block, {'{dir}'} the folder it sits
            in, {'{name}'} its base name. A language not listed here becomes runnable as soon as it
            has a command. Python, JavaScript and the shells use theirs for the shared session
            too; Java’s session is jshell, which takes no block of its own, so a command here
            means its blocks run one at a time instead.
          </span>
        </div>
      </div>

      <div className="run-commands">
        {CODE_LANGUAGES.map((language) => (
          <label className="run-commands__row" key={language.id}>
            <span className="run-commands__name">{language.label}</span>
            <input
              className="field"
              spellCheck={false}
              placeholder={commandFor(language, {}, window.stone.platform)}
              value={runners[language.id] ?? ''}
              aria-label={`Command that runs a ${language.label} block`}
              onChange={(e) => setRunner(language.id, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  )
}

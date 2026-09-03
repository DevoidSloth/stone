import { useEffect, useState } from 'react'
import type { ClaudeStatus, ClaudeTools } from '@shared/types'
import { useStone } from '../store'
import { COMMANDS_BY_ID, keysFor } from '../commands'
import { formatChord } from '../lib/keys'

const MODELS = ['sonnet', 'opus', 'fable', 'haiku']

/** The agent's permissions, worst consequence last. */
const TOOLS: Array<{ key: keyof ClaudeTools; title: string; detail: string }> = [
  {
    key: 'write',
    title: 'Write notes',
    detail: 'Create and edit files in the vault. Changes land on disk, not in the undo history.'
  },
  {
    key: 'web',
    title: 'Search the web',
    detail: 'Look things up and fetch pages, which sends the query off this machine.'
  },
  {
    key: 'shell',
    title: 'Run commands',
    detail: 'Run shell commands in the vault folder, with your account\u2019s permissions.'
  }
]

/**
 * Where Claude is, which model answers, and what the agent may do.
 *
 * There is no key to paste: the CLI already holds the user's credentials, so
 * the only things worth settling here are which model to spend on, — for the
 * machines where a login shell hides the binary from a Finder-launched app —
 * where the CLI actually lives, and how far the agent's reach goes.
 *
 * The three switches are separate on purpose. They are not degrees of the same
 * trust: a person who wants Claude to draft notes for them has said nothing
 * about wanting it to run shell commands, and one checkbox covering both would
 * make that decision for them.
 */
export function ClaudeSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = (): void => {
    setChecking(true)
    void window.stone.claude
      .status()
      .then(setStatus)
      .finally(() => setChecking(false))
  }

  useEffect(check, [])

  if (!settings) return null

  const command = COMMANDS_BY_ID.get('claude')
  const chord = command ? keysFor(command, settings.keybindings)[0] : null

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Claude
      </div>

      <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
        <span>
          {chord ? `${formatChord(chord)} asks` : 'Ask'} Claude for a diagram, a drawing, a block of
          code or a block of markdown, inserted below the cursor. Those run the Claude Code CLI on
          this machine with its tools switched off: nothing in the vault is read or written except
          what you insert.
        </span>
      </p>

      <div className="row">
        <div className="row__label">
          <b>Model</b>
          <span>An alias like sonnet, or a full model id.</span>
        </div>
        <input
          className="field"
          style={{ width: 200 }}
          list="claude-models"
          value={settings.claudeModel}
          aria-label="Claude model"
          onChange={(e) => void updateSettings({ claudeModel: e.target.value })}
        />
        <datalist id="claude-models">
          {MODELS.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>

      <div className="eyebrow" style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>
        Agent
      </div>

      <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
        <span>
          The dialog&rsquo;s Agent mode runs in the vault folder and can read the notes there, so it
          can answer from what you have actually written. Everything past reading is off until you
          turn it on here, and it stays off for a reason: a note can arrive from the web clipper or
          a shared folder, and text inside one is not something to hand a shell to.
        </span>
      </p>

      {TOOLS.map((tool) => (
        <label className="row" key={tool.key} style={{ marginTop: 'var(--sp-2)' }}>
          <div className="row__label">
            <b>{tool.title}</b>
            <span>{tool.detail}</span>
          </div>
          <input
            type="checkbox"
            checked={settings.claudeTools[tool.key]}
            onChange={(e) =>
              void updateSettings({
                claudeTools: { ...settings.claudeTools, [tool.key]: e.target.checked }
              })
            }
          />
        </label>
      ))}

      <div className="eyebrow" style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>
        Where it lives
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Command</b>
          <span>
            {status?.available
              ? `Found at ${status.binary}.`
              : 'Not found — set the full path to the claude binary.'}
          </span>
        </div>
        <input
          className="field"
          style={{ width: 240 }}
          placeholder="/usr/local/bin/claude"
          value={settings.claudeCommand ?? ''}
          aria-label="Path to the Claude CLI"
          onChange={(e) => void updateSettings({ claudeCommand: e.target.value.trim() || null })}
        />
        <button type="button" className="btn" disabled={checking} onClick={check}>
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>
    </section>
  )
}

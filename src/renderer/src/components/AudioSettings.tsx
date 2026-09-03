import { useEffect, useState } from 'react'
import type { WhisperStatus } from '@shared/types'
import { useStone } from '../store'
import { COMMANDS_BY_ID, keysFor } from '../commands'
import { formatChord } from '../lib/keys'

/**
 * Where the recordings go, and what turns them into words.
 *
 * The transcription runs on this machine, through a Whisper command line the
 * user already has — the same bargain the Claude section makes, and for the
 * same reasons: no key to paste, no bill, and an hour of lecture that never
 * leaves the laptop. What is worth settling here is which of the front ends to
 * use when there are several, and which model, since that is the whole of the
 * speed-against-accuracy trade.
 */

/** The languages worth a one-click choice; anything else can be typed. */
const LANGUAGES = [
  { code: 'auto', label: 'Detect' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' }
]

function modelName(file: string): string {
  return file.split(/[\\/]/).pop()?.replace(/^ggml-/, '').replace(/\.bin$/, '') ?? file
}

export function AudioSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = (): void => {
    setChecking(true)
    void window.stone.audio
      .whisperStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setChecking(false))
  }

  useEffect(check, [])

  if (!settings) return null

  const record = COMMANDS_BY_ID.get('record')
  const mark = COMMANDS_BY_ID.get('record-mark')
  const recordChord = record ? keysFor(record, settings.keybindings)[0] : null
  const markChord = mark ? keysFor(mark, settings.keybindings)[0] : null

  /** whisper.cpp is the only one that wants a file; the rest take a name. */
  const wantsModelFile = status?.flavor === 'whisper-cpp' || status === null

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        Audio
      </div>

      <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
        <span>
          {recordChord ? `${formatChord(recordChord)} records` : 'Record'} a lecture into the note
          you are in. Every new block you start while it runs is stamped with the moment it was
          started, so playing the recording back walks down your notes with it
          {markChord ? `, and ${formatChord(markChord)} stamps a line by hand` : ''}.
        </span>
      </p>

      <div className="row">
        <div className="row__label">
          <b>Recordings folder</b>
          <span>Inside the vault. Files are named for the note and the time.</span>
        </div>
        <input
          className="field"
          style={{ width: 240 }}
          value={settings.audioFolder}
          aria-label="Folder for recordings"
          onChange={(e) => void updateSettings({ audioFolder: e.target.value })}
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Stamp every new block</b>
          <span>
            Off means only the lines you mark by hand. The stamp is an ordinary markdown link, so a
            stamped note still works anywhere else.
          </span>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={settings.audioAutoStamp}
          aria-label="Stamp every new block"
          onClick={() => void updateSettings({ audioAutoStamp: !settings.audioAutoStamp })}
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Follow along</b>
          <span>Scroll the note to the line being spoken while a recording plays.</span>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={settings.audioFollow}
          aria-label="Follow along while playing"
          onClick={() => void updateSettings({ audioFollow: !settings.audioFollow })}
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Transcribe when a recording stops</b>
          <span>Otherwise there is a button on the player.</span>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={settings.audioTranscribeOnStop}
          aria-label="Transcribe when a recording stops"
          onClick={() =>
            void updateSettings({ audioTranscribeOnStop: !settings.audioTranscribeOnStop })
          }
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Whisper command</b>
          <span>
            {status?.available
              ? `Found ${status.flavor} at ${status.binary}.`
              : 'Not found. Install one — `brew install whisper-cpp`, or `pip install openai-whisper` — or set the full path here.'}
          </span>
        </div>
        <input
          className="field"
          style={{ width: 240 }}
          placeholder="/opt/homebrew/bin/whisper-cli"
          value={settings.whisperCommand ?? ''}
          aria-label="Path to the Whisper command"
          onChange={(e) => void updateSettings({ whisperCommand: e.target.value.trim() || null })}
        />
        <button type="button" className="btn" disabled={checking} onClick={check}>
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Model</b>
          <span>
            {wantsModelFile
              ? status?.models.length
                ? 'Bigger is more accurate and slower. Blank picks the best one found.'
                : 'No ggml model was found. Download one and give its full path here.'
              : 'A name like base.en — the front end downloads it on first use.'}
          </span>
        </div>
        <input
          className="field"
          style={{ width: 240 }}
          list="whisper-models"
          placeholder={wantsModelFile ? (status?.models[0] ?? 'ggml-base.en.bin') : 'base.en'}
          value={settings.whisperModel}
          aria-label="Whisper model"
          onChange={(e) => void updateSettings({ whisperModel: e.target.value })}
        />
        <datalist id="whisper-models">
          {(status?.models ?? []).map((model) => (
            <option key={model} value={model}>
              {modelName(model)}
            </option>
          ))}
        </datalist>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Language</b>
          <span>Naming it stops the model guessing wrong on a quiet opening minute.</span>
        </div>
        <select
          className="field"
          style={{ width: 160 }}
          value={settings.whisperLanguage}
          aria-label="Transcription language"
          onChange={(e) => void updateSettings({ whisperLanguage: e.target.value })}
        >
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

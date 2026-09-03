import type { Settings } from '@shared/types'
import { useStone } from '../store'
import { COMMANDS_BY_ID, keysFor } from '../commands'
import { formatChord } from '../lib/keys'

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

const PAGE_SIZES: Settings['pdfPageSize'][] = ['A4', 'Letter', 'Legal', 'A3', 'A5']

/**
 * How a note is laid out when it becomes a PDF.
 *
 * Everything here is about paper rather than about the note, which is why none
 * of it lives in frontmatter: the same note printed for a binder and printed
 * for a screen wants different margins, and that is a property of the printing,
 * not of the writing.
 */
export function PdfSettings() {
  const settings = useStone((s) => s.settings)
  const updateSettings = useStone((s) => s.updateSettings)

  if (!settings) return null

  const command = COMMANDS_BY_ID.get('export-pdf')
  const chord = command ? keysFor(command, settings.keybindings)[0] : null

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
        PDF export
      </div>

      <p className="row__label" style={{ marginBottom: 'var(--sp-3)' }}>
        <span>
          {chord ? `${formatChord(chord)}, ` : ''}the button in the title bar, or “Export as → PDF”
          on any note. Maths, diagrams and images are rendered the way the editor draws them.
        </span>
      </p>

      <div className="row">
        <div className="row__label">
          <b>Paper</b>
          <span>The sheet the document is laid out for.</span>
        </div>
        <div className="segmented">
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className="segmented__btn"
              aria-selected={settings.pdfPageSize === size}
              onClick={() => void updateSettings({ pdfPageSize: size })}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Margin</b>
          <span>Millimetres, on all four sides.</span>
        </div>
        <input
          className="field"
          type="number"
          min={5}
          max={40}
          step={1}
          style={{ width: 80 }}
          aria-label="Page margin in millimetres"
          value={settings.pdfMargin}
          onChange={(e) => {
            const next = Number(e.target.value)
            // A margin of nothing prints to the edge of a sheet no printer can
            // reach, and a huge one leaves a column of text in a field of white.
            if (Number.isFinite(next)) {
              void updateSettings({ pdfMargin: Math.min(40, Math.max(5, Math.round(next))) })
            }
          }}
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Cover page</b>
          <span>Opens with the title, the author and the date.</span>
        </div>
        <Toggle
          checked={settings.pdfCoverPage}
          onChange={(pdfCoverPage) => void updateSettings({ pdfCoverPage })}
          label="Include a cover page"
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Contents</b>
          <span>A table of contents, skipped on notes with few headings.</span>
        </div>
        <Toggle
          checked={settings.pdfToc}
          onChange={(pdfToc) => void updateSettings({ pdfToc })}
          label="Include a table of contents"
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Header and footer</b>
          <span>The note's title on each page, and a page number.</span>
        </div>
        <Toggle
          checked={settings.pdfHeaderFooter}
          onChange={(pdfHeaderFooter) => void updateSettings({ pdfHeaderFooter })}
          label="Print a running header and footer"
        />
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row__label">
          <b>Author</b>
          <span>Printed on the cover. Blank uses the vault's name.</span>
        </div>
        <input
          className="field"
          style={{ width: 200 }}
          placeholder="Your name"
          aria-label="Author printed on the cover page"
          value={settings.pdfAuthor}
          onChange={(e) => void updateSettings({ pdfAuthor: e.target.value })}
        />
      </div>
    </section>
  )
}

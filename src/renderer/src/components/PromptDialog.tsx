import { useEffect, useRef, useState } from 'react'
import { useStone } from '../store'

/**
 * The one-line text dialog.
 *
 * It exists because `window.prompt` is not merely unstyled in Electron, it is
 * overridden to throw — so "New folder" and both renames were dead the moment
 * they were clicked, failing inside the event handler with nothing shown. Every
 * one of those now awaits `askText`, which puts this on screen.
 *
 * Deliberately not a general-purpose modal: one field, Enter to accept, Escape
 * to dismiss, and a promise that resolves either way so no caller is left
 * hanging on a dialog the user closed.
 */
export function PromptDialog() {
  const request = useStone((s) => s.textRequest)
  const resolveText = useStone((s) => s.resolveText)

  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // Each new question reseeds the field, and a rename arrives with its current
  // name selected so it can be typed straight over.
  useEffect(() => {
    if (!request) return
    setValue(request.value ?? '')
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [request])

  if (!request) return null

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    resolveText(trimmed)
  }

  return (
    <div
      className="overlay overlay--center"
      onMouseDown={() => resolveText(null)}
      role="presentation"
    >
      <form
        className="modal modal--prompt"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <header className="modal__head">
          <h2 className="modal__title">{request.title}</h2>
        </header>

        <div className="modal__body">
          <input
            ref={input}
            className="field"
            value={value}
            placeholder={request.placeholder}
            aria-label={request.title}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                resolveText(null)
              }
            }}
          />
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => resolveText(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!value.trim()}>
            {request.confirmLabel ?? 'Create'}
          </button>
        </footer>
      </form>
    </div>
  )
}

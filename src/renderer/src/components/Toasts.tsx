import { useEffect, useState } from 'react'
import { useStone } from '../store'
import { IconSpinner, IconX } from '../ui/icons'

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

/**
 * The update notice.
 *
 * Deliberately the quietest thing on screen: one line, once the download has
 * already finished, saying the new version will be there next time. Nothing
 * modal, and nothing that restarts the app under someone mid-sentence.
 */
function UpdateNotice() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    void window.stone.updates.state().then((value) => setState(value as UpdateState))
    return window.stone.updates.onState((value) => setState(value as UpdateState))
  }, [])

  if (state.status !== 'ready') return null

  return (
    <div className="toast toast--update" role="status" aria-live="polite">
      <span className="toast__dot" />
      <span className="toast__message">
        Stone {state.version} is ready. It installs the next time you quit.
      </span>
    </div>
  )
}

/**
 * The toast stack.
 *
 * Two live regions rather than one: a single `polite` region carried every
 * tone, and polite means the screen reader finishes its current sentence first
 * — right for "Vault reindexed", wrong for a save that just failed.
 *
 * Hovering holds the dismissal timers, because a message that deletes itself
 * while it is being read is worse than no message.
 */
export function Toasts() {
  const toasts = useStone((s) => s.toasts)
  const dismissToast = useStone((s) => s.dismissToast)
  const dismissAllToasts = useStone((s) => s.dismissAllToasts)
  const holdToasts = useStone((s) => s.holdToasts)

  const running = useStone((s) => s.running)
  const errors = toasts.filter((t) => t.tone === 'error')

  return (
    <div
      className="toasts"
      onPointerEnter={() => holdToasts(true)}
      onPointerLeave={() => holdToasts(false)}
    >
      {errors.length > 1 && (
        <button type="button" className="toasts__clear" onClick={dismissAllToasts}>
          Dismiss all {errors.length}
        </button>
      )}

      <UpdateNotice />

      {running.map((task) => (
        <div key={task.id} className="toast toast--task" role="status" aria-live="polite">
          <IconSpinner size={13} />
          <span className="toast__message">{task.label}</span>
        </div>
      ))}

      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast__dot" />
          {/* Selectable, not a button label: an error you cannot select is an
              error you cannot report. */}
          <span className="toast__message">{toast.message}</span>
          {toast.count > 1 && (
            <span className="toast__count" aria-label={`${toast.count} times`}>
              ×{toast.count}
            </span>
          )}
          {toast.tone === 'error' && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                void navigator.clipboard.writeText(toast.message)
              }}
            >
              Copy
            </button>
          )}
          <button
            type="button"
            className="toast__close"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            <IconX size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

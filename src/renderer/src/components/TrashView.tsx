import { useEffect, useState } from 'react'
import { useStone } from '../store'
import { relativeDay, toISODate } from '../lib/dates'
import { IconRestore, IconTrash } from '../ui/icons'

/**
 * The trash.
 *
 * Deletes have always gone to `.trash` inside the vault rather than to
 * `unlink`, but until now the only way to see what was in there was a file
 * manager. Restore puts a note back where it came from, using the origin
 * recorded alongside it.
 */
export function TrashView() {
  const trash = useStone((s) => s.trash)
  const loadTrash = useStone((s) => s.loadTrash)
  const restore = useStone((s) => s.restoreFromTrash)
  const empty = useStone((s) => s.emptyTrash)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    void loadTrash()
  }, [loadTrash])

  return (
    <div className="tasks">
      <div className="tasks__main">
        <div className="tasks__head">
          <h1 className="tasks__title">Trash</h1>
          <span className="cal__year">
            {trash.length} note{trash.length === 1 ? '' : 's'}
          </span>
          <div className="cal__tools">
            {confirming ? (
              <>
                <span className="searchview__warn">This cannot be undone.</span>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => {
                    void empty()
                    setConfirming(false)
                  }}
                >
                  Delete them all
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={trash.length === 0}
                onClick={() => setConfirming(true)}
              >
                <IconTrash size={13} />
                Empty trash
              </button>
            )}
          </div>
        </div>

        <div className="tasks__list">
          {trash.length === 0 && (
            <div className="empty">
              <div className="empty__inner">
                <p className="empty__title">The trash is empty</p>
                <p className="empty__body">
                  Deleted notes are moved to <code>.trash</code> inside the vault, so they stay
                  recoverable from any device the folder syncs to.
                </p>
              </div>
            </div>
          )}

          {trash.map((entry) => (
            <div key={entry.relPath} className="trashrow">
              <div className="trashrow__main">
                <b className="truncate">{entry.title}</b>
                <span>
                  deleted {relativeDay(toISODate(new Date(entry.deletedAt)))} ·{' '}
                  {(entry.size / 1024).toFixed(1)} kB
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void restore(entry.relPath)}
              >
                <IconRestore size={12} />
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

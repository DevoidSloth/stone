import { useStone } from './store'

/**
 * Exporting a note to PDF, from wherever it was asked for.
 *
 * The title bar, the command palette, the sidebar's context menu and the note's
 * own `…` menu all reach this, so all four behave identically — including the
 * two things the palette command used to get wrong: an error from main became
 * an unhandled rejection with no toast, and the finished file was never
 * revealed.
 *
 * The save comes first on purpose. `export:pdf` reads the note from disk, so
 * without a flush the PDF quietly misses whatever was typed in the last second
 * before the button was pressed.
 */

/** One at a time. The print window is a shared, single-document surface. */
let running = false

export async function exportNoteToPdf(relPath: string | null): Promise<void> {
  const store = useStone.getState()

  if (!relPath) {
    store.toast('Open a note first.', 'error')
    return
  }
  if (running) return
  running = true

  try {
    await store.saveDoc(relPath)
    const saved = await window.stone.exporter.pdf(relPath)
    // No path means the save dialog was dismissed, which is not an error.
    if (!saved) return
    useStone.getState().toast(`Exported to ${saved}.`, 'success')
    void window.stone.exporter.reveal(saved)
  } catch (err) {
    useStone.getState().toast((err as Error).message, 'error')
  } finally {
    running = false
  }
}

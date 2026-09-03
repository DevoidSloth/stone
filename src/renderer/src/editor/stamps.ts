import {
  Annotation,
  EditorSelection,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateEffect,
  StateField
} from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { assetPathOf } from '@shared/attachments'
import {
  readStamp,
  stampAt,
  stampIndex,
  stampInsertPoint,
  stampMarkdown,
  type StampEntry
} from '@shared/audio'
import { useStone, recordingElapsed } from '../store'
import { activeEditor } from './insert'

/**
 * Writing the timestamps, and following them back.
 *
 * Two halves of the same idea. While a recording runs, every new block the
 * person starts gets the moment it was started written in front of it; while
 * that recording plays back, the block whose moment has just passed is lit up.
 * The markdown in between is the whole state — there is no side table mapping
 * lines to times that goes stale the moment the note is edited, and a stamped
 * note carried to another machine or another editor keeps working.
 */

/** Marks the transactions this module makes, so they do not stamp themselves. */
const STAMPED = Annotation.define<boolean>()

/** Where the recorder is, or null when nothing is recording. */
function recordingContext(): { seconds: number; target: string } | null {
  const recording = useStone.getState().recording
  if (!recording || recording.pausedAt !== null) return null
  return { seconds: recordingElapsed(recording), target: recording.target }
}

// ------------------------------------------------------------ stepping over

/** A range with nothing in it; the set is what matters, not the values. */
class Marker extends RangeValue {}
const MARKER = new Marker()

function buildAtomic(state: EditorState): RangeSet<Marker> {
  const builder = new RangeSetBuilder<Marker>()
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const at = stampInsertPoint(line.text)
    const stamp = readStamp(line.text.slice(at))
    if (stamp) builder.add(line.from + at, line.from + at + stamp.length, MARKER)
  }
  return builder.finish()
}

/**
 * The stamps, as ranges the caret treats as a single character.
 *
 * Without this, editing a stamped line walks the caret through forty hidden
 * characters of link drawn as one small clock, and a backspace at the head of
 * the line breaks the marker into raw text instead of removing it. This is what
 * makes the widget behave like the one glyph it looks like.
 */
const atomicStamps = StateField.define<RangeSet<Marker>>({
  create: (state) => buildAtomic(state),
  update: (value, tr) => (tr.docChanged ? buildAtomic(tr.state) : value),
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field))
})

// -------------------------------------------------------------- writing them

/**
 * Stamp the caret's line, from the mark button or its chord.
 *
 * Returns false only when there is no editor to write into; a line that is
 * already stamped is a success that does nothing, because pressing mark twice
 * on one thought should not produce two of them.
 */
export function stampHere(seconds: number, target: string): boolean {
  const view = activeEditor()
  if (!view) return false

  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const at = line.from + stampInsertPoint(line.text)
  if (readStamp(line.text.slice(at - line.from))) return true

  const text = stampMarkdown(seconds, target)
  view.dispatch({
    changes: { from: at, insert: text },
    selection: EditorSelection.cursor(Math.max(head, at) + text.length),
    annotations: STAMPED.of(true)
  })
  return true
}

/**
 * Stamp each new block as it is begun.
 *
 * On the newline rather than on the first character of the line. Waiting for a
 * character would give a truer answer to "when did this thought start", but it
 * would also mean deciding whether a lone `-` is the start of a list item or
 * the start of a word, and getting that wrong puts the marker in the middle of
 * the syntax. The lines that end up stamped and empty are cleaned up when the
 * recording stops.
 *
 * A filter rather than a second dispatch from an update listener: this way the
 * stamp and the newline are one transaction, so one undo takes back both.
 */
export const autoStamp = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(STAMPED)) return tr
  // A paste, a plugin, or a whole-document replacement is not someone starting
  // a new thought — only actual typing is.
  if (!tr.isUserEvent('input')) return tr
  if (!useStone.getState().settings?.audioAutoStamp) return tr

  const context = recordingContext()
  if (!context) return tr

  let end: number | null = null
  tr.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
    // Exactly one line break, opening an empty line: Enter, with or without
    // the list marker the markdown mode continues for you.
    if (inserted.lines !== 2 || inserted.line(1).length !== 0) return
    end = toB
  })
  if (end === null) return tr

  const line = tr.newDoc.lineAt(end)
  if (readStamp(line.text.slice(stampInsertPoint(line.text)))) return tr

  const at = line.from + stampInsertPoint(line.text)
  const text = stampMarkdown(context.seconds, context.target)
  return [
    tr,
    {
      changes: { from: at, insert: text },
      // Positions are in the document the newline just made, not the one before
      // it. Without this the offsets are resolved against the original doc and
      // every Enter at the end of a note is an out-of-range change.
      sequential: true,
      // Spelled out rather than mapped: an insertion at the caret maps the
      // caret to *before* it by default, which would leave the person typing
      // in front of the marker they just made.
      selection: EditorSelection.cursor(at + text.length),
      annotations: STAMPED.of(true)
    }
  ]
})

// ------------------------------------------------------------ following them

/** The line to light up, or null. Set from outside, by the player's clock. */
const setFollowed = StateEffect.define<number | null>()

const FOLLOWED = Decoration.line({ class: 'cm-stamp-now' })

const followField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setFollowed)) continue
      const line = effect.value
      if (line === null || line > tr.state.doc.lines) return Decoration.none
      return Decoration.set([FOLLOWED.range(tr.state.doc.line(line).from)])
    }
    // Mapped rather than dropped, so the highlight survives typing elsewhere
    // in the note between one clock tick and the next.
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** The stamps in this document that point at `audio`, in document order. */
function stampsFor(doc: string, audio: string, attachments: string): StampEntry[] {
  return stampIndex(doc).filter((entry) => assetPathOf(entry.target, attachments) === audio)
}

/**
 * Watch the player and light the line it has reached.
 *
 * Subscribed to the store rather than driven by a prop, because the clock
 * ticks several times a second and re-rendering the editor's React wrapper at
 * that rate would be a waste of the whole tree. The index is rebuilt only when
 * the document changes, not on every tick.
 */
const followPlugin = ViewPlugin.define((view: EditorView) => {
  let index: StampEntry[] = []
  let audio: string | null = null
  let current: number | null = null
  let frame: number | null = null

  const rebuild = (): void => {
    const state = useStone.getState()
    const playing = state.playback?.audio ?? null
    audio = playing
    index =
      playing === null
        ? []
        : stampsFor(
            view.state.doc.toString(),
            playing,
            state.settings?.attachmentsFolder ?? 'Attachments'
          )
  }

  const apply = (): void => {
    frame = null
    const state = useStone.getState()
    const playback = state.playback

    if (audio !== (playback?.audio ?? null)) rebuild()

    const found = playback && index.length > 0 ? stampAt(index, playback.time) : null
    const line = found?.line ?? null
    if (line === current) return
    current = line
    view.dispatch({ effects: setFollowed.of(line) })

    if (line !== null && state.settings?.audioFollow && playback?.playing) {
      const target = view.state.doc.line(Math.min(line, view.state.doc.lines))
      view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
    }
  }

  /*
   * Never synchronously, and never more than once a frame.
   *
   * A zustand subscriber runs inside the `set` that woke it, and one of the
   * sets that reaches here is the editor's own change handler — dispatching a
   * transaction from there is a dispatch during an update, which CodeMirror
   * refuses outright. A frame is also the right rate for the highlight: the
   * player's clock ticks four times a second and the store is written to for a
   * dozen other reasons in between.
   */
  const schedule = (): void => {
    if (frame === null) frame = requestAnimationFrame(apply)
  }

  const unsubscribe = useStone.subscribe(schedule)
  rebuild()

  return {
    update(update) {
      if (!update.docChanged) return
      rebuild()
      // The lines have moved under the highlight; recompute rather than trust it.
      current = null
      schedule()
    },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame)
      unsubscribe()
    }
  }
})

/**
 * Stamp the caret's line with the moment the recording is at now.
 *
 * Lives here rather than in the store so the store does not have to reach into
 * the editor — the caret is the editor's business, and this is the one thing
 * the mark button and its chord both want.
 */
export function markNow(): 'stamped' | 'not-recording' | 'no-editor' {
  const context = recordingContext()
  if (!context) return 'not-recording'
  return stampHere(context.seconds, context.target) ? 'stamped' : 'no-editor'
}

export function stamps() {
  return [autoStamp, atomicStamps, followField, followPlugin]
}

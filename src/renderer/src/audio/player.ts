/**
 * The one `<audio>` element, and how everything else reaches it.
 *
 * Playback lives in the bar at the bottom of the window rather than in the
 * embed inside the note, so that scrolling away from the embed — or opening
 * another note entirely — does not stop the lecture. A timestamp chip, a
 * transcript line and a citation in Claude's answer all want to seek that one
 * element, and none of them are anywhere near it in the tree.
 *
 * The same shape as `editor/insert.ts`: the component that owns the element
 * registers it, and callers ask for it by function.
 */

let element: HTMLAudioElement | null = null

export function setPlayerElement(next: HTMLAudioElement | null): void {
  element = next
}

export function playerElement(): HTMLAudioElement | null {
  return element && element.isConnected ? element : null
}

/** Jump to a moment and keep playing. Returns false when there is no player. */
export function seekPlayer(seconds: number, play = true): boolean {
  const audio = playerElement()
  if (!audio) return false
  // A hair early, because a stamp records when a thought *started* being
  // written and the sentence that prompted it is a beat before that.
  audio.currentTime = Math.max(0, seconds - 0.35)
  if (play && audio.paused) void audio.play().catch(() => undefined)
  return true
}

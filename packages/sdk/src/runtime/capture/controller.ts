// Capture mode: ties the session, marking and the app state together. Point and Record are two
// separate actions; a capture is one or the other.
import { getState, setState } from '../state.ts'
import { MAX_NOTE } from '../ui/limits.ts'
import { guard, log } from '../safe.ts'
import { clearMarks, getMarked, startMarking, stopMarking } from './marking.ts'
import { startSession, type CaptureKind, type Session } from './session.ts'
import { insertToken, nextNumber, stripToken, type Caret } from './tokens.ts'

let session: Session | null = null
/** The textarea selection when Point or Record was clicked; the token goes after it when the capture is added. */
let caret: Caret | undefined

/** Escape cancels, in both modes, and the page never sees it. Only listening while a capture is active. */
const onKey = guard((event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  event.stopImmediatePropagation()
  event.preventDefault()
  cancelCapture()
})

function begin(kind: CaptureKind, at?: Caret): boolean {
  const state = getState()
  if (!state.open || !state.draft || state.captureMode || session) return false
  clearMarks()
  session = startSession(kind, () => stopRecord())
  if (!session) return false
  caret = at
  window.addEventListener('keydown', onKey, true)
  if (kind === 'point') {
    setState({ captureMode: { kind: 'point', selected: 0 }, captureNotice: undefined })
    startMarking((selected) => {
      const mode = getState().captureMode
      if (mode?.kind === 'point') setState({ captureMode: { kind: 'point', selected } })
    })
  } else {
    setState({ captureMode: { kind: 'record', startedAt: Date.now() }, captureNotice: undefined })
  }
  return true
}

/**
 * Point: the page is intercepted and the user marks elements. Returns false if it can't start (window
 * not open, already capturing, rrweb failed). `at` is the textarea selection: the controller inserts
 * the token into the note itself (the window is unmounted while capturing, so it can't), and hands the
 * caret back through `state.editorCaret` for the window to restore on mount.
 */
export const startPoint = (at?: Caret): boolean => begin('point', at)

/** Record: recording starts at once and the page stays fully interactive. */
export const startRecord = (at?: Caret): boolean => begin('record', at)

function leave(): void {
  window.removeEventListener('keydown', onKey, true)
  caret = undefined
  stopMarking()
  clearMarks()
  session = null
  setState({ captureMode: undefined })
}

function complete(): void {
  const current = session
  const draft = getState().draft
  if (!current || !draft) return leave()
  const { capture, dropped } = current.finish([...getMarked()])
  let note = getState().note
  let editorCaret = caret
  if (capture) {
    const n = nextNumber(draft.captures.map((c) => c.n), draft.lastN)
    draft.captures = [...draft.captures, { n, ...capture }]
    draft.lastN = n
    const inserted = insertToken(note, caret ?? { start: note.length, end: note.length }, n, MAX_NOTE)
    note = inserted.note
    editorCaret = inserted.caret
  } else {
    log.warn('capture failed')
  }
  const notice = !capture
    ? "The capture couldn't be taken."
    : dropped > 0
      ? `${dropped} marked ${dropped === 1 ? 'element' : 'elements'} left the page and ${dropped === 1 ? 'was' : 'were'} not included.`
      : undefined
  leave()
  setState({ draft, note, captureNotice: notice, editorCaret })
}

/** Done in Point mode: adds a point capture (no marks means the whole page). */
export function finishPoint(): void {
  if (getState().captureMode?.kind === 'point') complete()
}

/** Stop in Record mode (and the 60 s limit): adds a recording capture. */
export function stopRecord(): void {
  if (getState().captureMode?.kind === 'record') complete()
}

/** Cancel, Escape, turn-off and closing the window: nothing is added. Safe to call when not capturing. */
export function cancelCapture(): void {
  if (!session && !getState().captureMode) return
  session?.cancel()
  const back = caret
  leave()
  if (back && getState().open) setState({ editorCaret: back })
}

/** Remove on a card: drops the capture and every `[n]` token for it from the note. */
export function removeCapture(n: number): void {
  const draft = getState().draft
  if (!draft) return
  draft.captures = draft.captures.filter((c) => c.n !== n)
  setState({ draft, note: stripToken(getState().note, n) })
}

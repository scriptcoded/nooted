// Tiny app state store shared by the trigger code and the Preact UI.
import type { Capture } from '@nooted/shared'
import type { StoredToken } from './auth/token.ts'

/** The report being written. A stable object per report; the re-send cache is keyed by it. */
export interface ReportDraft {
  note: string
  captures: Capture[]
  /** The highest capture number issued in this report, so numbers aren't reused after a removal. */
  lastN: number
  /** Date.now() when the window opened (ms). */
  openedAt: number
  /** location.href when the window opened. */
  url: string
}

export interface AppState {
  /** The report window is showing. */
  open: boolean
  /** Set while the window is open; discarded on close. The report as it will be sent. */
  draft?: ReportDraft
  /** The note being written. Lives here (not in the component) so it survives the switch to sign-in and back. */
  note: string
  /** The upload token for this tab, null when signed out. Set when the window opens, on sign-in and on sign-out. */
  token: StoredToken | null
  /** Reports waiting to upload (shown as a badge on the floating button; group 8 sets it). */
  pending: number
  /** A capture is being taken (window and button hidden, capture bar shown): Point or Record. Set by capture/controller.ts. */
  captureMode?: { kind: 'point'; selected: number } | { kind: 'record'; startedAt: number }
  /** A note about the capture just added (a mark left the page, or the capture failed). Shown in the report window. */
  captureNotice?: string
  /** Where the report window puts the caret when it next mounts (after Point or Record ended). */
  editorCaret?: { start: number; end: number }
  /** The report window is hidden behind the bubble (open stays true: the draft is kept in memory). */
  minimized: boolean
  /** Show the floating button (`init({ button: false })` turns it off). */
  button: boolean
}

type Listener = (state: AppState) => void

let state: AppState = { open: false, note: '', token: null, pending: 0, button: true, minimized: false }
const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const listener of [...listeners]) listener(state)
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

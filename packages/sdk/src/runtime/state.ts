// Tiny app state store shared by the trigger code and the Preact UI.
import type { StoredToken } from './auth/token.ts'
import type { BufferEvent } from './buffer.ts'

export interface FrozenReport {
  /** The buffer as it was at the moment of the trigger. */
  events: readonly BufferEvent[]
  /** Date.now() at the trigger (ms), the shape ReportPayload.capturedAt expects. */
  capturedAt: number
  /** location.href at the trigger. */
  url: string
}

export interface AppState {
  /** The report window is showing. */
  open: boolean
  /** Set while the window is open; discarded on close. */
  frozen?: FrozenReport
  /** The note being written. Lives here (not in the component) so it survives the switch to sign-in and back. */
  note: string
  /** Focus range chosen on the timeline (absolute timestamps). undefined = no focus. Kept while the recording is toggled off. */
  focus?: { start: number; end: number }
  /** Send the recording. On for every new report. */
  includeRecording: boolean
  /** The upload token for this tab, null when signed out. Set when the window opens, on sign-in and on sign-out. */
  token: StoredToken | null
  /** Reports waiting to upload (shown as a badge on the floating button; group 8 sets it). */
  pending: number
  /** Show the floating button (`init({ button: false })` turns it off). */
  button: boolean
}

type Listener = (state: AppState) => void

let state: AppState = { open: false, note: '', includeRecording: true, token: null, pending: 0, button: true }
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

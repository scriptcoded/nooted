// The single path every trigger (shake, shortcut, button, nooted.open()) goes through.
import { currentToken } from './auth/sign-in.ts'
import { cancelCapture } from './capture/controller.ts'
import { getState, setState } from './state.ts'

/** Opens the report window with a fresh draft. Ignored (returns false) when it is already open or a capture is being taken. */
export function trigger(): boolean {
  if (getState().open || getState().captureMode) return false
  const draft = { note: '', captures: [], lastN: 0, openedAt: Date.now(), url: location.href }
  setState({ open: true, draft, note: '', token: currentToken(), editorCaret: undefined })
  // Observable by tests and by the host page.
  document.documentElement.dataset.nootedOpened = String(Number(document.documentElement.dataset.nootedOpened ?? 0) + 1)
  window.dispatchEvent(new CustomEvent('nooted:open'))
  return true
}

/** Closes the window and discards the draft and the note. */
export function close(): void {
  cancelCapture()
  setState({ open: false, draft: undefined, note: '', captureNotice: undefined, editorCaret: undefined })
}

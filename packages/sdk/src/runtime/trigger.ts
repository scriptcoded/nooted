// The single path every trigger (shake, shortcut, button, nooted.open()) goes through.
import { currentToken } from './auth/sign-in.ts'
import { cancelCapture } from './capture/controller.ts'
import { getState, setState } from './state.ts'

/**
 * Opens the report window with a fresh draft, or restores a minimized one with its draft. Ignored (returns
 * false) when it is already showing or a capture is being taken.
 */
export function trigger(): boolean {
  const { open, minimized, captureMode } = getState()
  if (captureMode) return false
  if (open && minimized) {
    setState({ minimized: false })
    return true
  }
  if (open) return false
  const draft = { note: '', captures: [], lastN: 0, openedAt: Date.now(), url: location.href }
  setState({ open: true, minimized: false, draft, note: '', token: currentToken(), editorCaret: undefined })
  // Observable by tests and by the host page.
  document.documentElement.dataset.nootedOpened = String(Number(document.documentElement.dataset.nootedOpened ?? 0) + 1)
  window.dispatchEvent(new CustomEvent('nooted:open'))
  return true
}

/** Closes the window and discards the draft and the note. */
export function close(): void {
  cancelCapture()
  setState({ open: false, minimized: false, draft: undefined, note: '', captureNotice: undefined, editorCaret: undefined })
}

// The single path every trigger (shake, shortcut, button, nooted.open()) goes through.
import { currentToken } from './auth/sign-in.ts'
import { buffer } from './buffer.ts'
import { getState, setState } from './state.ts'
import { exposeFrozen } from './test-hook.ts'

/**
 * Freezes the buffer and opens the report window. Ignored (returns false) when the window is
 * already open, so the first freeze is kept.
 */
export function trigger(): boolean {
  if (getState().open) return false
  const frozen = { events: buffer.freeze(), capturedAt: Date.now(), url: location.href }
  setState({ open: true, frozen, note: '', focus: undefined, includeRecording: true, token: currentToken() })
  exposeFrozen(frozen)
  // Observable by tests and by the host page.
  document.documentElement.dataset.nootedOpened = String(Number(document.documentElement.dataset.nootedOpened ?? 0) + 1)
  window.dispatchEvent(new CustomEvent('nooted:open'))
  return true
}

/** Closes the window and discards the frozen copy and the note. */
export function close(): void {
  setState({ open: false, frozen: undefined, note: '', focus: undefined, includeRecording: true })
}

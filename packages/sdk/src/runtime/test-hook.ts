// TEST HOOKS. Active only when localStorage['nooted:test'] === '1' (set by e2e tests).
import { getState, setState } from './state.ts'

export function enabled(): boolean {
  try {
    return localStorage.getItem('nooted:test') === '1'
  } catch {
    return false
  }
}

/** Lets tests set the pending count directly. */
export function installTestHooks(): void {
  if (!enabled()) return
  const w = window as unknown as Record<string, unknown>
  w.__nootedSetPending = (n: number) => setState({ pending: n })
  /** The draft of the open report window (undefined when closed). */
  w.__nootedDraft = () => getState().draft
  /** Pads the draft with copies of its first capture until it has `count` (numbers 1..count), to reach the limit without recording ten times. */
  w.__nootedFillCaptures = (count: number) => {
    const draft = getState().draft
    const first = draft?.captures[0]
    if (!draft || !first) return
    draft.captures = Array.from({ length: count }, (_, i) => ({ ...first, n: i + 1 }))
    draft.lastN = count
    setState({ draft })
  }
}

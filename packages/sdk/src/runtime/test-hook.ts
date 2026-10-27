// TEST HOOKS. Active only when localStorage['nooted:test'] === '1' (set by e2e tests).
import { buffer } from './buffer.ts'
import { setState } from './state.ts'
import type { FrozenReport } from './state.ts'

export function enabled(): boolean {
  try {
    return localStorage.getItem('nooted:test') === '1'
  } catch {
    return false
  }
}

/** Exposes what trigger() froze as window.__nootedTestFrozen (events) and __nootedTestReport (whole record). */
export function exposeFrozen(report: FrozenReport): void {
  if (!enabled()) return
  const w = window as unknown as Record<string, unknown>
  w.__nootedTestFrozen = report.events
  w.__nootedTestReport = report
}

/** Lets tests set the pending count directly. */
export function installTestHooks(): void {
  if (!enabled()) return
  const w = window as unknown as Record<string, unknown>
  w.__nootedSetPending = (n: number) => setState({ pending: n })
  /** Number of events currently in the recording buffer (0 after "Turn off"). */
  w.__nootedBufferSize = () => buffer.freeze().length
}

/** Exposes the preview's live state as window.__nootedPreview (undefined while no replayer exists). */
export function exposePreview(info: { time: number; playing: boolean; duration: number } | undefined): void {
  if (!enabled()) return
  ;(window as unknown as Record<string, unknown>).__nootedPreview = info
}

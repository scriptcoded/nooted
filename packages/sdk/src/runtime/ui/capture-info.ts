// What a capture says about itself, in words: shared by the rows and the large view.
import type { Capture } from '@nooted/shared'

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Last event timestamp minus the first. */
export function recordingMs(capture: Capture): number {
  const events = capture.events as { timestamp?: number }[]
  const first = events[0]?.timestamp
  const last = events[events.length - 1]?.timestamp
  return typeof first === 'number' && typeof last === 'number' ? Math.max(0, last - first) : 0
}

/** "Screenshot" or "Recording". */
export function captureLabel(capture: Capture): string {
  return capture.demo ? 'Recording' : 'Screenshot'
}

/** The large view's title text: "Screenshot of Add to cart", "Screenshot of the whole page" or "Recording · m:ss". */
export function captureTitle(capture: Capture): string {
  if (capture.demo) return `Recording · ${formatClock(recordingMs(capture))}`
  return capture.marks.length > 0 ? `Screenshot of ${pointedNames(capture)}` : 'Screenshot of the whole page'
}

/** The selected elements' names, or "Whole page". */
export function pointedNames(capture: Capture): string {
  return capture.marks.map((m) => m.name || m.text || m.tag).join(', ') || 'Whole page'
}

/** "Ends on /checkout", or '' when the URL can't be read. */
export function endsOn(capture: Capture): string {
  try {
    return `Ends on ${new URL(capture.url).pathname}`
  } catch {
    return ''
  }
}

/** Row line 2: the names for points, "0:08 · Ends on /checkout" for recordings. */
export function captureDetail(capture: Capture): string {
  if (!capture.demo) return pointedNames(capture)
  return [formatClock(recordingMs(capture)), endsOn(capture)].filter(Boolean).join(' · ')
}

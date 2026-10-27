// Pure model for the report window's timeline: span, handles, error markers, focus.
// No DOM and no JSX so it runs under `node --test`.
import type { BufferEvent } from '../buffer.ts'
import type { FrozenReport } from '../state.ts'

export interface Span {
  start: number
  end: number
}
export type Range = Span
export type Handle = 'start' | 'end'

/** Smallest distance between the handles (ms). */
export const MIN_GAP = 500
/** Handles within this distance of their ends count as "no focus" (ms). */
export const SNAP = 250

const CUSTOM = 5
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** [first event timestamp, capturedAt]. The end is never before the last event; no events gives an empty span at capturedAt. */
export function timelineSpan(frozen: Pick<FrozenReport, 'events' | 'capturedAt'>): Span {
  const { events, capturedAt } = frozen
  if (events.length === 0) return { start: capturedAt, end: capturedAt }
  let start = events[0]!.timestamp
  let last = start
  for (const e of events) {
    if (e.timestamp < start) start = e.timestamp
    if (e.timestamp > last) last = e.timestamp
  }
  return { start, end: Math.max(capturedAt, last) }
}

/** Position of `t` on the span as 0..1, clamped. A zero-length span gives 0. */
export function toFraction(span: Span, t: number): number {
  const length = span.end - span.start
  if (length <= 0) return 0
  return clamp((t - span.start) / length, 0, 1)
}

/** Timestamp at fraction `f` (clamped to 0..1) of the span. */
export function fromFraction(span: Span, f: number): number {
  return span.start + clamp(f, 0, 1) * (span.end - span.start)
}

/** The gap actually enforced: MIN_GAP, or half the span when the span is shorter than that. */
function gapFor(span: Span): number {
  return Math.min(MIN_GAP, Math.max(0, span.end - span.start) / 2)
}

/** Moves one handle to `t`, clamped to the span and kept at least the minimum gap from the other. */
export function moveHandle(range: Range, span: Span, which: Handle, t: number): Range {
  const gap = gapFor(span)
  if (which === 'start') {
    const limit = Math.max(span.start, Math.min(range.end, span.end) - gap)
    return { start: clamp(t, span.start, limit), end: range.end }
  }
  const limit = Math.min(span.end, Math.max(range.start, span.start) + gap)
  return { start: range.start, end: clamp(t, limit, span.end) }
}

/** Keyboard step: 1% of the span, 10% when `big`. */
export function stepHandle(range: Range, span: Span, which: Handle, direction: -1 | 1, big: boolean): Range {
  const step = (span.end - span.start) * (big ? 0.1 : 0.01)
  return moveHandle(range, span, which, range[which] + direction * step)
}

/**
 * Times (ms) of `nooted:error` custom events, ascending.
 * Uses `payload.time` when it is a finite number inside the span: for errors the loader
 * caught before recording started, the event timestamp is the replay moment while the
 * payload carries the real error time. For live errors the two match. Otherwise
 * (missing or outside the span) the event timestamp is used.
 */
export function errorMarkers(events: readonly BufferEvent[], span?: Span): number[] {
  const bounds = span ?? timelineSpan({ events, capturedAt: -Infinity })
  const times: number[] = []
  for (const e of events) {
    if (e.type !== CUSTOM) continue
    const data = e.data as { tag?: unknown; payload?: { time?: unknown } } | null
    if (!data || data.tag !== 'nooted:error') continue
    const time = data.payload?.time
    const usable = typeof time === 'number' && Number.isFinite(time) && time >= bounds.start && time <= bounds.end
    times.push(usable ? time : e.timestamp)
  }
  return times.sort((a, b) => a - b)
}

/** The focus to send, or undefined when both handles are within SNAP of their ends. */
export function toFocus(range: Range, span: Span): Span | undefined {
  if (range.start - span.start <= SNAP && span.end - range.end <= SNAP) return undefined
  return { start: range.start, end: range.end }
}

/** aria-valuetext: the offset from the start of the recording, e.g. "12.3 s". */
export function formatOffset(span: Span, t: number): string {
  const seconds = Math.max(0, t - span.start) / 1000
  return `${seconds.toFixed(1)} s`
}

/** Offset from the recording start as m:ss (whole seconds, rounded down). */
export function formatClock(span: Span, t: number): string {
  const total = Math.floor(Math.max(0, t - span.start) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

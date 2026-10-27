// The single buffer module: the only subscriber to rrweb's emit callback.
// Keeps the current and previous checkout segments and hands out frozen copies.

/** Minimal rrweb event envelope (rrweb's `eventWithTime`). */
export interface BufferEvent {
  type: number
  timestamp: number
  data: unknown
}

const META = 4
const FULL_SNAPSHOT = 2
const KEPT_SEGMENTS = 2

export interface Buffer {
  /** rrweb emit signature: `(event, isCheckout?)`. */
  push(event: BufferEvent, isCheckout?: boolean): void
  /** Immutable shallow copy of everything currently held. */
  freeze(): readonly BufferEvent[]
  /** Drops everything ("Turn off"). */
  clear(): void
}

export function createBuffer(): Buffer {
  let segments: BufferEvent[][] = [[]]
  // rrweb passes isCheckout=true on BOTH the Meta and the FullSnapshot event of a
  // checkout. Only the Meta starts a segment; the snapshot that follows it joins it.
  let awaitingSnapshot = false

  return {
    push(event, isCheckout = false) {
      if (isCheckout) {
        if (awaitingSnapshot && event.type === FULL_SNAPSHOT) {
          awaitingSnapshot = false
        } else {
          segments.push([])
          if (segments.length > KEPT_SEGMENTS) segments = segments.slice(-KEPT_SEGMENTS)
          awaitingSnapshot = event.type === META
        }
      } else {
        awaitingSnapshot = false
      }
      segments[segments.length - 1]!.push(event)
    },
    freeze() {
      return Object.freeze(segments.flat())
    },
    clear() {
      segments = [[]]
      awaitingSnapshot = false
    },
  }
}

/** The page-wide buffer used by the runtime. */
export const buffer: Buffer = createBuffer()

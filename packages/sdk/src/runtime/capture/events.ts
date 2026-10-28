// Pure logic of a capture session: which of the recorded events belong to the capture, and
// which marked elements make it into the capture. No DOM and no rrweb, so it is unit-tested.

/** rrweb event types the slicing relies on (EventType.FullSnapshot, EventType.Meta). */
const FULL_SNAPSHOT = 2
const META = 4

/**
 * The events a capture keeps. Call this after the closing `takeFullSnapshot()`.
 * - Point (`demo` false): from the last Meta event, which is the closing snapshot's.
 * - Record (`demo` true): from the first Meta event, which is the recording's start, to the end, so
 *   the clip ends with the closing snapshot.
 * Returns [] when no Meta event is found.
 */
export function selectEvents<T extends { type: number }>(events: readonly T[], demo: boolean): T[] {
  if (demo) {
    const first = events.findIndex((event) => event.type === META)
    return first < 0 ? [] : events.slice(first)
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === META) return events.slice(i)
  return []
}

/** A capture needs at least two events, one of them a full snapshot. */
export function isUsable(events: readonly { type: number }[]): boolean {
  return events.length >= 2 && events.some((event) => event.type === FULL_SNAPSHOT)
}

export interface ResolveHooks<E, M> {
  isConnected: (element: E) => boolean
  /** The element's node id in the closing snapshot, -1 when it has none. */
  getId: (element: E) => number
  describe: (element: E, nodeId: number) => M
}

/** Describes the marked elements that are still in the snapshot. `dropped` counts the rest. */
export function resolveMarks<E, M>(elements: readonly E[], hooks: ResolveHooks<E, M>): { marks: M[]; dropped: number } {
  const marks: M[] = []
  let dropped = 0
  for (const element of elements) {
    const id = hooks.isConnected(element) ? hooks.getId(element) : -1
    if (id < 0) {
      dropped++
      continue
    }
    marks.push(hooks.describe(element, id))
  }
  return { marks, dropped }
}

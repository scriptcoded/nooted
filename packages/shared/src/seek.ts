// Seeking a rrweb replay to a point in a recording. Zod-free, so the SDK runtime bundle can use it.

/** The earliest time a seek can draw: seeking before the first full snapshot (a few ms in) leaves rrweb on the current frame. */
export const MIN_SEEK_MS = 10

/**
 * Times (ms from the first event) of the later full snapshots a recording takes (its checkpoints). rrweb
 * applies a checkpoint wrongly when one seek fast-forwards across both it and earlier mutations (attributes
 * changed before it come back stale), so seeks past a checkpoint hop to just before it first.
 */
export function checkpointTimes(events: readonly unknown[]): number[] {
  const list = events as ReadonlyArray<{ type?: number; timestamp?: number } | undefined>
  const start = list[0]?.timestamp
  if (typeof start !== 'number') return []
  const times: number[] = []
  list.forEach((event, i) => {
    // A checkpoint is a Meta event (4) followed by a full snapshot (2); the first pair is the recording's start.
    if (event?.type === 4 && i > 0 && list[i + 1]?.type === 2 && typeof event.timestamp === 'number') times.push(event.timestamp - start)
  })
  return times
}

/**
 * The times to pause at, in order, to land on `target` (ms from the first event, clamped to at least
 * MIN_SEEK_MS and at most `duration`): a hop to 1 ms before each checkpoint at or before the target that an
 * earlier hop has not passed, then the target itself.
 */
export function seekSteps(checkpoints: readonly number[], target: number, duration: number = Infinity): number[] {
  const end = Math.min(duration, Math.max(MIN_SEEK_MS, target))
  const steps: number[] = []
  let at = 0
  for (const checkpoint of checkpoints) {
    const before = checkpoint - 1
    if (checkpoint <= end && before > at && before >= MIN_SEEK_MS) {
      steps.push(before)
      at = before
    }
  }
  steps.push(end)
  return steps
}

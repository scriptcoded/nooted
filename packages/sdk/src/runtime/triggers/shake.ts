// Pure shake detector, fed from `devicemotion` accelerationIncludingGravity.
//
// Deviation from the literal design ("change in magnitude between consecutive
// samples"): at 60 Hz a vigorous 5 Hz shake of +-25 m/s2 changes by at most
// about 25 * 2 * pi * 5 / 60 = 13 m/s2 per sample, so a per-sample delta can't
// reach a 15 m/s2 threshold. Instead a peak is a magnitude excursion above a
// slow-moving baseline vector (per-axis exponential moving average, ~1 s time
// constant, which tracks gravity) by more than the threshold. The vector is used
// rather than its magnitude because a shake along one axis only rectifies the
// magnitude (hypot(a, g)) and shrinks the excursion. Walking (a few m/s2) and scrolling (constant
// gravity) stay far below it, and a phone set down is a single peak.

export interface ShakeSample {
  /** accelerationIncludingGravity, m/s2. */
  x: number
  y: number
  z: number
  /** Timestamp in ms. */
  t: number
}

export interface ShakeOptions {
  /** Excursion above baseline, m/s2. */
  threshold?: number
}

export interface ShakeState {
  baseline: [number, number, number] | null
  lastT: number | null
  /** True while the signal is above the threshold; re-arms once it falls back. */
  above: boolean
  /** Timestamps of recent peaks. */
  peaks: number[]
  /** No detection before this time. */
  cooldownUntil: number
}

export const SHAKE_THRESHOLD = 15
export const SHAKE_MIN_PEAK_GAP_MS = 100
export const SHAKE_PEAKS = 3
export const SHAKE_WINDOW_MS = 1000
export const SHAKE_COOLDOWN_MS = 2000
export const SHAKE_BASELINE_TAU_MS = 1000

export function initialShakeState(): ShakeState {
  return { baseline: null, lastT: null, above: false, peaks: [], cooldownUntil: 0 }
}

export function detectShake(
  sample: ShakeSample,
  state: ShakeState,
  options: ShakeOptions = {},
): { fired: boolean; state: ShakeState } {
  const threshold = options.threshold ?? SHAKE_THRESHOLD
  const { t } = sample
  const baseline = state.baseline ?? [sample.x, sample.y, sample.z]
  const dt = state.lastT === null ? 0 : Math.max(0, t - state.lastT)
  const alpha = 1 - Math.exp(-dt / SHAKE_BASELINE_TAU_MS)
  const next: ShakeState = {
    baseline: [
      baseline[0] + (sample.x - baseline[0]) * alpha,
      baseline[1] + (sample.y - baseline[1]) * alpha,
      baseline[2] + (sample.z - baseline[2]) * alpha,
    ],
    lastT: t,
    above: state.above,
    peaks: state.peaks,
    cooldownUntil: state.cooldownUntil,
  }

  if (t < state.cooldownUntil) {
    next.above = false
    next.peaks = []
    return { fired: false, state: next }
  }

  const deviation = Math.hypot(sample.x - baseline[0], sample.y - baseline[1], sample.z - baseline[2])
  if (deviation > threshold) {
    if (!state.above) {
      next.above = true
      const last = state.peaks[state.peaks.length - 1]
      if (last === undefined || t - last >= SHAKE_MIN_PEAK_GAP_MS) {
        next.peaks = [...state.peaks.filter((p) => t - p <= SHAKE_WINDOW_MS), t]
      }
    }
  } else if (deviation < threshold / 2) {
    next.above = false
  }

  if (next.peaks.length >= SHAKE_PEAKS) {
    next.peaks = []
    next.above = false
    next.cooldownUntil = t + SHAKE_COOLDOWN_MS
    return { fired: true, state: next }
  }
  return { fired: false, state: next }
}

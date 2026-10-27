import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectShake, initialShakeState, type ShakeSample } from './shake.ts'

const G = 9.81
const DT = 1000 / 60

/** Runs a stream through the detector; returns the timestamps at which it fired. */
function run(samples: ShakeSample[], threshold?: number): number[] {
  let state = initialShakeState()
  const fired: number[] = []
  for (const s of samples) {
    const r = detectShake(s, state, threshold === undefined ? undefined : { threshold })
    state = r.state
    if (r.fired) fired.push(s.t)
  }
  return fired
}

/** 60 Hz stream; `f(tMs)` gives the acceleration vector. */
function stream(durationMs: number, f: (t: number) => [number, number, number], start = 0): ShakeSample[] {
  const out: ShakeSample[] = []
  for (let t = 0; t <= durationMs; t += DT) {
    const [x, y, z] = f(t)
    out.push({ x, y, z, t: start + t })
  }
  return out
}

/** Shake along x at `hz` with `amp` m/s2 amplitude on top of gravity on z, with a little sensor noise. */
const shake = (durationMs: number, hz: number, amp: number, start = 0) =>
  stream(
    durationMs,
    (t) => [amp * Math.sin(2 * Math.PI * hz * (t / 1000)), 0.3 * Math.sin(t), G],
    start,
  )

describe('shake detector', () => {
  it('fires once for a firm shake', () => {
    const fired = run(shake(800, 5, 25))
    assert.equal(fired.length, 1)
    assert.ok(fired[0]! < 1000)
  })

  it('does not fire while walking', () => {
    // ~1.8 Hz bobbing, a few m/s2 on all axes.
    const s = stream(10_000, (t) => {
      const p = 2 * Math.PI * 1.8 * (t / 1000)
      return [1.5 * Math.sin(p), 2 * Math.sin(2 * p), G + 3.5 * Math.sin(p)]
    })
    assert.deepEqual(run(s), [])
  })

  it('does not fire while scrolling (near-constant gravity)', () => {
    const s = stream(10_000, (t) => [0.2 * Math.sin(t / 50), 0.8 * Math.sin(t / 300), G + 0.3 * Math.sin(t / 70)])
    assert.deepEqual(run(s), [])
  })

  it('does not fire when a phone is set down on a table (one big jolt)', () => {
    const s = stream(3000, (t) => {
      if (t < 1000) return [0, 2, G]
      // One jolt that decays within ~150 ms, then lying flat.
      const k = Math.exp(-(t - 1000) / 40)
      return [0, 2 * (1 - k), G + (t < 1050 ? 35 : 0) * k]
    })
    assert.deepEqual(run(s), [])
  })

  it('ignores peaks during the 2 s cooldown, then fires again', () => {
    const fired = run(shake(6000, 5, 25))
    assert.ok(fired.length >= 2, `expected repeated firing, got ${fired.length}`)
    for (let i = 1; i < fired.length; i++) {
      assert.ok(fired[i]! - fired[i - 1]! >= 2000, `fired ${fired[i]! - fired[i - 1]!} ms apart`)
    }
    // Continuous shaking for 6 s: roughly every 2.4 s, so at most 3 firings.
    assert.ok(fired.length <= 3)
  })

  it('needs 3 peaks within 1 second', () => {
    // Each swing is a peak in both directions, so 0.7 Hz gives peaks ~714 ms apart:
    // never 3 inside 1 s.
    assert.deepEqual(run(shake(6000, 0.7, 25)), [])
  })

  it('threshold override: a gentler shake fires only with a lower threshold', () => {
    const gentle = shake(1500, 5, 14)
    assert.deepEqual(run(gentle), [])
    assert.equal(run(gentle, 7).length >= 1, true)
  })

  it('state is not mutated between calls', () => {
    const s0 = initialShakeState()
    const snapshot = structuredClone(s0)
    detectShake({ x: 0, y: 0, z: G, t: 0 }, s0)
    assert.deepEqual(s0, snapshot)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkpointTimes, seekSteps } from './seek.ts'

const ev = (type: number, timestamp: number) => ({ type, timestamp })

describe('checkpointTimes', () => {
  it('finds Meta + full snapshot pairs after the first, relative to the first event', () => {
    const events = [ev(4, 1000), ev(2, 1000), ev(3, 1100), ev(4, 1500), ev(2, 1500), ev(3, 1600), ev(4, 1700)]
    assert.deepEqual(checkpointTimes(events), [500])
  })
  it('has none without events or a timestamp', () => {
    assert.deepEqual(checkpointTimes([]), [])
    assert.deepEqual(checkpointTimes([{}, ev(4, 5), ev(2, 5)]), [])
  })
})

describe('seekSteps', () => {
  it('goes straight to the target without checkpoints', () => {
    assert.deepEqual(seekSteps([], 800, 1000), [800])
  })
  it('clamps to at least 10 ms and at most the duration', () => {
    assert.deepEqual(seekSteps([], 0), [10])
    assert.deepEqual(seekSteps([], 5000, 1000), [1000])
  })
  it('hops to 1 ms before each checkpoint at or before the target', () => {
    assert.deepEqual(seekSteps([300, 600, 900], 600, 1000), [299, 599, 600])
    assert.deepEqual(seekSteps([300, 600, 900], 1000, 1000), [299, 599, 899, 1000])
  })
  it('skips checkpoints after the target or too close to the start', () => {
    assert.deepEqual(seekSteps([5, 300], 200, 1000), [200])
    assert.deepEqual(seekSteps([11], 500, 1000), [10, 500])
  })
  it('skips a hop an earlier hop already passed', () => {
    assert.deepEqual(seekSteps([300, 300], 400, 1000), [299, 400])
  })
})

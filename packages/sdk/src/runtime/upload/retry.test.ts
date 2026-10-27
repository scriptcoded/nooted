import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backoffDelay } from './retry.ts'

describe('backoffDelay', () => {
  it('starts at 30 s and doubles', () => {
    assert.deepEqual([0, 1, 2, 3].map(backoffDelay), [30_000, 60_000, 120_000, 240_000])
  })
  it('caps at 30 minutes', () => {
    assert.equal(backoffDelay(6), 30 * 60_000) // 32 min uncapped
    assert.equal(backoffDelay(100), 30 * 60_000)
  })
  it('treats negative attempts as the first', () => assert.equal(backoffDelay(-3), 30_000))
})

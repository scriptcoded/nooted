import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FEEDBACK_STATUSES, STATUS_LABELS, isFeedbackStatus } from './status.ts'

describe('status', () => {
  it('accepts exactly the defined statuses', () => {
    for (const s of FEEDBACK_STATUSES) assert.ok(isFeedbackStatus(s))
    for (const s of ['archived', '', 'New', null, 3, undefined]) assert.ok(!isFeedbackStatus(s))
  })
  it('has a label for each', () => {
    assert.deepEqual(Object.keys(STATUS_LABELS), [...FEEDBACK_STATUSES])
    assert.equal(STATUS_LABELS.in_progress, 'In progress')
  })
})

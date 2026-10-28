import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stringifyReason, toPayload } from './errors.ts'

test('early error keeps its fields and time', () => {
  assert.deepEqual(
    toPayload({ type: 'error', message: 'boom', source: 'a.js', line: 3, column: 4, stack: 's', time: 7 }),
    { message: 'boom', stack: 's', source: 'a.js', line: 3, column: 4, time: 7 },
  )
  assert.deepEqual(toPayload({ type: 'error', message: 'x', time: 1 }), { message: 'x', time: 1 })
})

test('Error rejection uses message and stack', () => {
  const error = new Error('nope')
  const payload = toPayload({ type: 'rejection', reason: error, time: 5 })
  assert.equal(payload.message, 'nope')
  assert.equal(payload.stack, error.stack)
  assert.equal(payload.time, 5)
})

test('plain rejection values are stringified', () => {
  assert.equal(toPayload({ type: 'rejection', reason: { code: 42 }, time: 1 }).message, '{"code":42}')
  assert.equal(stringifyReason('text'), 'text')
  assert.equal(stringifyReason(undefined), 'undefined')
  assert.equal(stringifyReason(12), '12')
})

test('unserializable reasons fall back to String()', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.equal(stringifyReason(circular), '[object Object]')
  assert.equal(stringifyReason(1n), '1')
})

test('long reasons are truncated to 1000 characters', () => {
  assert.equal(stringifyReason('a'.repeat(5000)).length, 1000)
})

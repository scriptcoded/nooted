import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isUsable, resolveMarks, selectEvents } from './events.ts'

const e = (type: number, id = 0) => ({ type, id })

describe('selectEvents', () => {
  it('for a point capture keeps from the last Meta', () => {
    const events = [e(4, 1), e(2, 2), e(3, 3), e(4, 4), e(2, 5)]
    assert.deepEqual(selectEvents(events, false).map((x) => x.id), [4, 5])
  })

  it('for a recording keeps from the first Meta to the end', () => {
    const events = [e(3, 0), e(4, 1), e(2, 2), e(3, 3), e(4, 4), e(2, 5)]
    assert.deepEqual(selectEvents(events, true).map((x) => x.id), [1, 2, 3, 4, 5])
  })

  it('returns nothing without a Meta', () => {
    assert.deepEqual(selectEvents([e(2), e(3)], false), [])
    assert.deepEqual(selectEvents([e(2), e(3)], true), [])
    assert.deepEqual(selectEvents([], true), [])
  })
})

describe('isUsable', () => {
  it('needs two events with a full snapshot', () => {
    assert.equal(isUsable([e(4), e(2)]), true)
    assert.equal(isUsable([e(2)]), false)
    assert.equal(isUsable([e(4), e(3)]), false)
  })
})

describe('resolveMarks', () => {
  it('drops disconnected elements and elements without an id, and counts them', () => {
    const els = [{ n: 'a', ok: true, id: 3 }, { n: 'b', ok: false, id: 4 }, { n: 'c', ok: true, id: -1 }, { n: 'd', ok: true, id: 0 }]
    const { marks, dropped } = resolveMarks(els, {
      isConnected: (x) => x.ok,
      getId: (x) => x.id,
      describe: (x, id) => `${x.n}:${id}`,
    })
    assert.deepEqual(marks, ['a:3', 'd:0'])
    assert.equal(dropped, 2)
  })

  it('does not ask for the id of a disconnected element', () => {
    let asked = 0
    resolveMarks([1], { isConnected: () => false, getId: () => (asked++, 1), describe: () => 1 })
    assert.equal(asked, 0)
  })
})

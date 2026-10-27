import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BufferEvent } from '../buffer.ts'
import {
  errorMarkers,
  formatClock,
  formatOffset,
  fromFraction,
  moveHandle,
  stepHandle,
  timelineSpan,
  toFocus,
  toFraction,
} from './timeline.ts'

const ev = (timestamp: number, type = 3, data: unknown = {}): BufferEvent => ({ type, timestamp, data })
const err = (timestamp: number, time?: number): BufferEvent =>
  ev(timestamp, 5, { tag: 'nooted:error', payload: { message: 'x', ...(time === undefined ? {} : { time }) } })
const span = { start: 1000, end: 41000 } // 40 s

describe('timelineSpan', () => {
  it('runs from the first event to capturedAt', () => {
    assert.deepEqual(timelineSpan({ events: [ev(1000), ev(5000)], capturedAt: 41000 }), span)
  })
  it('empty events give an empty span at capturedAt', () => {
    assert.deepEqual(timelineSpan({ events: [], capturedAt: 7 }), { start: 7, end: 7 })
  })
  it('end is at least the last event', () => {
    assert.deepEqual(timelineSpan({ events: [ev(1000), ev(9000)], capturedAt: 5000 }), { start: 1000, end: 9000 })
  })
})

describe('fractions', () => {
  it('converts both ways', () => {
    assert.equal(toFraction(span, 21000), 0.5)
    assert.equal(fromFraction(span, 0.25), 11000)
  })
  it('clamps', () => {
    assert.equal(toFraction(span, -5), 0)
    assert.equal(toFraction(span, 99999), 1)
    assert.equal(fromFraction(span, -1), 1000)
    assert.equal(fromFraction(span, 2), 41000)
  })
  it('zero-length span', () => {
    assert.equal(toFraction({ start: 5, end: 5 }, 5), 0)
    assert.equal(fromFraction({ start: 5, end: 5 }, 0.5), 5)
  })
})

describe('moveHandle', () => {
  const full = { ...span }
  it('moves a handle', () => {
    assert.deepEqual(moveHandle(full, span, 'start', 13000), { start: 13000, end: 41000 })
    assert.deepEqual(moveHandle(full, span, 'end', 21000), { start: 1000, end: 21000 })
  })
  it('clamps beyond the span', () => {
    assert.equal(moveHandle(full, span, 'start', -100).start, 1000)
    assert.equal(moveHandle(full, span, 'end', 1e9).end, 41000)
  })
  it('start stops 500 ms before end', () => {
    const r = { start: 1000, end: 20000 }
    assert.deepEqual(moveHandle(r, span, 'start', 30000), { start: 19500, end: 20000 })
  })
  it('end stops 500 ms after start', () => {
    const r = { start: 20000, end: 41000 }
    assert.deepEqual(moveHandle(r, span, 'end', 3000), { start: 20000, end: 20500 })
  })
  it('handles a span shorter than the gap', () => {
    const tiny = { start: 0, end: 300 }
    const r = moveHandle({ ...tiny }, tiny, 'start', 300)
    assert.deepEqual(r, { start: 150, end: 300 })
    assert.deepEqual(moveHandle(r, tiny, 'end', 0), { start: 150, end: 300 })
  })
  it('handles a zero-length span', () => {
    const z = { start: 5, end: 5 }
    assert.deepEqual(moveHandle(z, z, 'start', 9), { start: 5, end: 5 })
  })
})

describe('stepHandle', () => {
  it('steps 1%', () => {
    assert.deepEqual(stepHandle({ ...span }, span, 'start', 1, false), { start: 1400, end: 41000 })
    assert.deepEqual(stepHandle({ ...span }, span, 'end', -1, false), { start: 1000, end: 40600 })
  })
  it('steps 10% when big', () => {
    assert.deepEqual(stepHandle({ ...span }, span, 'start', 1, true), { start: 5000, end: 41000 })
  })
  it('clamps at the span and at the other handle', () => {
    assert.equal(stepHandle({ ...span }, span, 'start', -1, true).start, 1000)
    assert.deepEqual(stepHandle({ start: 1000, end: 1700 }, span, 'start', 1, true), { start: 1200, end: 1700 })
  })
})

describe('errorMarkers', () => {
  it('returns error times sorted, ignoring other events', () => {
    const events = [ev(1000), err(30000), ev(2000, 5, { tag: 'other', payload: {} }), err(26000)]
    assert.deepEqual(errorMarkers(events, span), [26000, 30000])
  })
  it('prefers payload.time for replayed early errors', () => {
    assert.deepEqual(errorMarkers([ev(1000), err(1100, 1050)], span), [1050])
  })
  it('falls back to event timestamp when payload.time is missing or outside the span', () => {
    assert.deepEqual(errorMarkers([err(2000), err(3000, 5), err(4000, 1e12)], span), [2000, 3000, 4000])
  })
  it('works without an explicit span and with malformed data', () => {
    assert.deepEqual(errorMarkers([ev(1000), err(2000, 1500), ev(3000, 5, null), ev(3500, 5, 'x')]), [1500])
    assert.deepEqual(errorMarkers([]), [])
  })
})

describe('toFocus', () => {
  it('no focus at the ends', () => {
    assert.equal(toFocus({ ...span }, span), undefined)
  })
  it('snaps within 250 ms of both ends', () => {
    assert.equal(toFocus({ start: 1250, end: 40750 }, span), undefined)
  })
  it('focus when either handle moved further', () => {
    assert.deepEqual(toFocus({ start: 1251, end: 41000 }, span), { start: 1251, end: 41000 })
    assert.deepEqual(toFocus({ start: 1000, end: 40749 }, span), { start: 1000, end: 40749 })
    assert.deepEqual(toFocus({ start: 12000, end: 20000 }, span), { start: 12000, end: 20000 })
  })
})

describe('formatOffset', () => {
  it('formats seconds from the start', () => {
    assert.equal(formatOffset(span, 13300), '12.3 s')
    assert.equal(formatOffset(span, 1000), '0.0 s')
  })
  it('never negative', () => {
    assert.equal(formatOffset(span, 0), '0.0 s')
  })
})

it('formatClock gives m:ss from the span start', () => {
  const span = { start: 1000, end: 200_000 }
  assert.equal(formatClock(span, 1000), '0:00')
  assert.equal(formatClock(span, 13_900), '0:12')
  assert.equal(formatClock(span, 66_000), '1:05')
})

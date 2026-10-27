import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NOOTED_ERROR_TAG, REPORT_LIMITS, ReportPayload } from './report.ts'

const valid = () => ({
  clientReportId: '2f0c6f0e-5b0e-4c52-9d6e-0a9d3f1b7a11',
  note: 'The button does nothing',
  url: 'https://example.com/page?x=1',
  capturedAt: 1_700_000_000_000,
  release: 'v1.2.3',
  device: {
    userAgent: 'Mozilla/5.0',
    viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
  },
  events: [{ type: 4, timestamp: 1_700_000_000_000, data: { href: 'x' }, extra: 'kept' }],
})

describe('ReportPayload', () => {
  it('parses a valid payload and preserves extra event fields', () => {
    const result = ReportPayload.parse(valid())
    assert.equal((result.events[0] as Record<string, unknown>).extra, 'kept')
  })

  it('rejects an empty note', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), note: '' }).success, false)
  })

  it('rejects a whitespace-only note', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), note: '   \n\t ' }).success, false)
  })

  it('rejects a note over the max length', () => {
    const note = 'a'.repeat(REPORT_LIMITS.maxNoteLength + 1)
    assert.equal(ReportPayload.safeParse({ ...valid(), note }).success, false)
  })

  it('rejects empty events', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), events: [] }).success, false)
  })

  it('rejects a non-http url', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), url: 'ftp://example.com' }).success, false)
    assert.equal(ReportPayload.safeParse({ ...valid(), url: 'javascript:alert(1)' }).success, false)
  })

  it('rejects a non-uuid id', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), clientReportId: 'nope' }).success, false)
  })

  it('rejects unknown top-level keys', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), extra: 1 }).success, false)
  })

  it('rejects a missing device', () => {
    const { device: _device, ...rest } = valid()
    assert.equal(ReportPayload.safeParse(rest).success, false)
  })

  it('treats release as optional', () => {
    const { release: _release, ...rest } = valid()
    assert.equal(ReportPayload.safeParse(rest).success, true)
  })
})

describe('ReportPayload focus and recording', () => {
  const T = 1_700_000_000_000
  const events = () => [
    { type: 4, timestamp: T, data: {} },
    { type: 2, timestamp: T + 5000, data: {} },
  ]
  const errorEvent = (timestamp = T) => ({ type: 5, timestamp, data: { tag: NOOTED_ERROR_TAG, payload: { message: 'x' } } })
  const issuePaths = (input: unknown) => {
    const r = ReportPayload.safeParse(input)
    return r.success ? null : r.error.issues.map((i) => i.path.join('.'))
  }

  it('accepts a valid focus, including an end within 1 s after the last event', () => {
    assert.ok(ReportPayload.safeParse({ ...valid(), events: events(), focus: { start: T, end: T + 6000 } }).success)
    const parsed = ReportPayload.parse({ ...valid(), events: events(), focus: { start: T + 1, end: T + 2 } })
    assert.deepEqual(parsed.focus, { start: T + 1, end: T + 2 })
  })

  it('rejects focus with start >= end', () => {
    assert.deepEqual(issuePaths({ ...valid(), events: events(), focus: { start: T + 10, end: T + 10 } }), ['focus'])
    assert.deepEqual(issuePaths({ ...valid(), events: events(), focus: { start: T + 20, end: T + 10 } }), ['focus'])
  })

  it('rejects focus outside the event span', () => {
    assert.deepEqual(issuePaths({ ...valid(), events: events(), focus: { start: T - 1, end: T + 10 } }), ['focus.start'])
    assert.deepEqual(issuePaths({ ...valid(), events: events(), focus: { start: T, end: T + 6001 } }), ['focus.end'])
  })

  it('rejects unknown keys in focus and non-numeric values', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), events: events(), focus: { start: T, end: T + 1, x: 1 } }).success, false)
    assert.equal(ReportPayload.safeParse({ ...valid(), events: events(), focus: { start: 'a', end: 'b' } }).success, false)
  })

  it('rejects empty events when recording is not false', () => {
    assert.deepEqual(issuePaths({ ...valid(), events: [] }), ['events'])
  })

  it('accepts recording false with no events or only error events', () => {
    assert.ok(ReportPayload.safeParse({ ...valid(), recording: false, events: [] }).success)
    assert.ok(ReportPayload.safeParse({ ...valid(), recording: false, events: [errorEvent(), errorEvent(T + 1)] }).success)
  })

  it('rejects recording true (only false or absent)', () => {
    assert.equal(ReportPayload.safeParse({ ...valid(), recording: true }).success, false)
  })

  it('rejects non-error events when recording is false', () => {
    assert.deepEqual(issuePaths({ ...valid(), recording: false, events: [errorEvent(), { type: 2, timestamp: T, data: {} }] }), ['events.1'])
    assert.deepEqual(issuePaths({ ...valid(), recording: false, events: [{ type: 5, timestamp: T, data: { tag: 'other' } }] }), ['events.0'])
    assert.deepEqual(issuePaths({ ...valid(), recording: false, events: [{ type: 3, timestamp: T, data: { tag: NOOTED_ERROR_TAG } }] }), ['events.0'])
    assert.deepEqual(issuePaths({ ...valid(), recording: false, events: [{ type: 5, timestamp: T, data: null }] }), ['events.0'])
  })

  it('rejects focus when recording is false', () => {
    assert.deepEqual(issuePaths({ ...valid(), recording: false, events: [errorEvent()], focus: { start: T, end: T + 1 } }), ['focus'])
  })
})

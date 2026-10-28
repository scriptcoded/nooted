import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Capture, Mark, REPORT_LIMITS, ReportPayload } from './report.ts'

const mark = (): Mark => ({
  nodeId: 7,
  tag: 'button',
  role: 'button',
  name: 'Save',
  text: 'Save',
  selector: '#save',
  rect: { x: 10, y: 20, width: 80, height: 32 },
})
const capture = (n = 1): Capture => ({
  n,
  url: 'https://example.com/page',
  capturedAt: 1_700_000_000_000,
  viewport: { width: 1280, height: 720 },
  scroll: { x: 0, y: 120 },
  demo: false,
  events: [
    { type: 4, timestamp: 1, data: { href: 'x' }, extra: 'kept' },
    { type: 2, timestamp: 2, data: {} },
  ],
  marks: [mark()],
})
const valid = (): Record<string, unknown> => ({
  clientReportId: '2f0c6f0e-5b0e-4c52-9d6e-0a9d3f1b7a11',
  note: 'The button does nothing',
  url: 'https://example.com/page?x=1',
  capturedAt: 1_700_000_000_000,
  release: 'v1.2.3',
  device: { userAgent: 'Mozilla/5.0', viewport: { width: 1280, height: 720, devicePixelRatio: 2 } },
  captures: [],
})
const ok = (input: unknown) => ReportPayload.safeParse(input).success
const issuePaths = (input: unknown) => {
  const r = ReportPayload.safeParse(input)
  return r.success ? null : r.error.issues.map((i) => i.path.join('.'))
}
const withCaptures = (captures: unknown[], note = 'see [1]') => ({ ...valid(), note, captures })

describe('ReportPayload basics', () => {
  it('parses a payload without captures', () => {
    assert.ok(ok(valid()))
  })
  it('rejects an empty or whitespace-only note', () => {
    assert.equal(ok({ ...valid(), note: '' }), false)
    assert.equal(ok({ ...valid(), note: '   \n\t ' }), false)
  })
  it('rejects a note over the max length', () => {
    assert.equal(ok({ ...valid(), note: 'a'.repeat(REPORT_LIMITS.maxNoteLength + 1) }), false)
  })
  it('rejects a non-http url and a non-uuid id', () => {
    assert.equal(ok({ ...valid(), url: 'ftp://example.com' }), false)
    assert.equal(ok({ ...valid(), url: 'javascript:alert(1)' }), false)
    assert.equal(ok({ ...valid(), clientReportId: 'nope' }), false)
  })
  it('rejects unknown top-level keys, including the old events, focus and recording', () => {
    assert.equal(ok({ ...valid(), extra: 1 }), false)
    assert.equal(ok({ ...valid(), events: [{ type: 2, timestamp: 1, data: {} }] }), false)
    assert.equal(ok({ ...valid(), focus: { start: 1, end: 2 } }), false)
    assert.equal(ok({ ...valid(), recording: false }), false)
  })
  it('requires captures, requires device, and treats release as optional', () => {
    const { captures: _c, ...noCaptures } = valid()
    assert.equal(ok(noCaptures), false)
    const { device: _d, ...noDevice } = valid()
    assert.equal(ok(noDevice), false)
    const { release: _r, ...noRelease } = valid()
    assert.ok(ok(noRelease))
  })
})

describe('Capture', () => {
  it('accepts a capture and preserves extra event fields', () => {
    const result = ReportPayload.parse(withCaptures([capture()]))
    assert.equal((result.captures[0]?.events[0] as Record<string, unknown>).extra, 'kept')
  })
  it('limits captures to 10 and n to 1..10', () => {
    const ten = Array.from({ length: 10 }, (_, i) => capture(i + 1))
    assert.ok(ok(withCaptures(ten, 'no tokens')))
    assert.equal(ok(withCaptures([...ten, capture(11)], 'no tokens')), false)
    assert.equal(ok(withCaptures([capture(0)], 'no tokens')), false)
    assert.equal(ok(withCaptures([{ ...capture(), n: 1.5 }], 'no tokens')), false)
  })
  it('requires at least two events', () => {
    assert.equal(ok(withCaptures([{ ...capture(), events: [{ type: 2, timestamp: 1, data: {} }] }])), false)
  })
  it('requires an http(s) url, a positive int capturedAt and positive int viewport', () => {
    assert.equal(ok(withCaptures([{ ...capture(), url: 'ftp://x.test' }])), false)
    assert.equal(ok(withCaptures([{ ...capture(), capturedAt: 0 }])), false)
    assert.equal(ok(withCaptures([{ ...capture(), capturedAt: 1.5 }])), false)
    assert.equal(ok(withCaptures([{ ...capture(), viewport: { width: 0, height: 5 } }])), false)
    assert.equal(ok(withCaptures([{ ...capture(), viewport: { width: 5.5, height: 5 } }])), false)
  })
  it('requires non-negative finite scroll and a boolean demo', () => {
    assert.equal(ok(withCaptures([{ ...capture(), scroll: { x: -1, y: 0 } }])), false)
    assert.equal(ok(withCaptures([{ ...capture(), scroll: { x: 0, y: Infinity } }])), false)
    assert.ok(ok(withCaptures([{ ...capture(), scroll: { x: 0.5, y: 10.25 } }])))
    assert.equal(ok(withCaptures([{ ...capture(), demo: 'yes' }])), false)
  })
  it('rejects unknown capture keys', () => {
    assert.equal(ok(withCaptures([{ ...capture(), extra: 1 }])), false)
  })
})

describe('Mark', () => {
  const withMarks = (marks: unknown[]) => withCaptures([{ ...capture(), marks }])
  it('allows 0 to 20 marks', () => {
    assert.ok(ok(withMarks([])))
    assert.ok(ok(withMarks(Array.from({ length: 20 }, mark))))
    assert.equal(ok(withMarks(Array.from({ length: 21 }, mark))), false)
  })
  it('allows empty text and optional role and name', () => {
    const { role: _r, name: _n, ...bare } = mark()
    assert.ok(ok(withMarks([{ ...bare, text: '' }])))
  })
  it('enforces field limits', () => {
    assert.ok(ok(withMarks([{ ...mark(), text: 'a'.repeat(200), name: 'a'.repeat(200), role: 'a'.repeat(64), tag: 'a'.repeat(64), selector: 'a'.repeat(500) }])))
    assert.equal(ok(withMarks([{ ...mark(), text: 'a'.repeat(201) }])), false)
    assert.equal(ok(withMarks([{ ...mark(), name: 'a'.repeat(201) }])), false)
    assert.equal(ok(withMarks([{ ...mark(), role: 'a'.repeat(65) }])), false)
    assert.equal(ok(withMarks([{ ...mark(), tag: 'a'.repeat(65) }])), false)
    assert.equal(ok(withMarks([{ ...mark(), tag: '' }])), false)
    assert.equal(ok(withMarks([{ ...mark(), selector: '' }])), false)
    assert.equal(ok(withMarks([{ ...mark(), selector: 'a'.repeat(501) }])), false)
  })
  it('requires an int nodeId and a finite rect, and rejects unknown keys', () => {
    assert.equal(ok(withMarks([{ ...mark(), nodeId: 1.5 }])), false)
    assert.equal(ok(withMarks([{ ...mark(), rect: { x: 0, y: 0, width: Infinity, height: 1 } }])), false)
    assert.equal(ok(withMarks([{ ...mark(), rect: { x: 0, y: 0, width: 1 } }])), false)
    assert.equal(ok(withMarks([{ ...mark(), extra: 1 }])), false)
  })
})

describe('ReportPayload cross-field rules', () => {
  it('rejects a duplicate capture number at captures.i.n', () => {
    assert.deepEqual(issuePaths(withCaptures([capture(1), capture(1)])), ['captures.1.n'])
  })
  it('rejects a capture without a full snapshot at captures.i.events', () => {
    const noSnapshot = { ...capture(2), events: [{ type: 4, timestamp: 1, data: {} }, { type: 3, timestamp: 2, data: {} }] }
    assert.deepEqual(issuePaths(withCaptures([capture(1), noSnapshot], 'a [1] b [2]')), ['captures.1.events'])
  })
  it('rejects a token that refers to no capture, naming it', () => {
    const r = ReportPayload.safeParse(withCaptures([capture(1), capture(2)], 'look at [1] and [3]'))
    assert.equal(r.success, false)
    assert.ok(!r.success && r.error.issues.some((i) => i.path.join('.') === 'note' && i.message.includes('[3]')))
  })
  it('rejects a token when there are no captures', () => {
    assert.equal(ok({ ...valid(), note: 'see [1]' }), false)
  })
  it('ignores brackets that are not numbers', () => {
    assert.ok(ok({ ...valid(), note: 'array[i] and [a1] and [] here' }))
  })
  it('accepts unreferenced captures and repeated tokens', () => {
    assert.ok(ok(withCaptures([capture(1), capture(2)], 'only [1] and again [1]')))
  })
  it('accepts numbers that skip (removed captures)', () => {
    assert.ok(ok(withCaptures([capture(2), capture(5)], '[2] [5]')))
  })
})

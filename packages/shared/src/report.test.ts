import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REPORT_LIMITS, ReportPayload } from './report.ts'

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

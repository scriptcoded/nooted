import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ReportPayload } from '@nooted/shared'
import { buildPayload } from './payload.ts'

const frozen = {
  events: [
    { type: 4, timestamp: 1, data: { href: 'https://app.test/cart' } },
    { type: 2, timestamp: 2, data: {} },
  ],
  capturedAt: 1_700_000_000_000,
  url: 'https://app.test/cart',
}
const device = { userAgent: 'UA/1.0', viewport: { width: 390, height: 844, devicePixelRatio: 3 } }

describe('buildPayload', () => {
  it('produces a payload the shared schema accepts', () => {
    const p = buildPayload({ note: 'It broke', frozen, device })
    assert.deepEqual(ReportPayload.parse(p), p)
  })

  it('works with default device info outside a browser', () => {
    ReportPayload.parse(buildPayload({ note: 'x', frozen }))
  })

  it('takes the URL and capture time from the freeze', () => {
    const p = buildPayload({ note: 'x', frozen, device })
    assert.equal(p.url, 'https://app.test/cart')
    assert.equal(p.capturedAt, frozen.capturedAt)
  })

  it('generates a unique client report id unless given', () => {
    const a = buildPayload({ note: 'x', frozen, device })
    const b = buildPayload({ note: 'x', frozen, device })
    assert.notEqual(a.clientReportId, b.clientReportId)
    const id = '3f1c9b52-7a3e-4a8b-9d55-0c1f2e3a4b5c'
    assert.equal(buildPayload({ note: 'x', frozen, device, clientReportId: id }).clientReportId, id)
  })

  it('includes release only when set', () => {
    assert.equal(buildPayload({ note: 'x', frozen, device, release: '1.2.3' }).release, '1.2.3')
    assert.ok(!('release' in buildPayload({ note: 'x', frozen, device })))
    ReportPayload.parse(buildPayload({ note: 'x', frozen, device, release: '1.2.3' }))
  })

  describe('focus and includeRecording', () => {
    const err = (timestamp: number) => ({ type: 5, timestamp, data: { tag: 'nooted:error', payload: { message: 'boom' } } })
    const mixed = {
      ...frozen,
      events: [
        { type: 4, timestamp: 1, data: { href: 'https://app.test/cart' } },
        err(2),
        { type: 5, timestamp: 3, data: { tag: 'other' } },
        { type: 2, timestamp: 4, data: {} },
        err(5),
      ],
    }
    const focus = { start: 2, end: 5 }

    it('includes all events and the focus by default', () => {
      const p = buildPayload({ note: 'x', frozen: mixed, device, focus })
      assert.equal(p.events.length, 5)
      assert.deepEqual(p.focus, focus)
      assert.ok(!('recording' in p))
      ReportPayload.parse(p)
    })

    it('omits focus when none is given', () => {
      const p = buildPayload({ note: 'x', frozen: mixed, device, includeRecording: true })
      assert.ok(!('focus' in p))
      ReportPayload.parse(p)
    })

    it('keeps only error events, sets recording false and drops focus when recording is off', () => {
      const p = buildPayload({ note: 'x', frozen: mixed, device, focus, includeRecording: false })
      assert.equal(p.recording, false)
      assert.ok(!('focus' in p))
      assert.deepEqual(p.events, [err(2), err(5)])
      ReportPayload.parse(p)
    })

    it('sends an empty event list when recording is off and there are no errors', () => {
      const p = buildPayload({ note: 'x', frozen, device, includeRecording: false })
      assert.equal(p.recording, false)
      assert.deepEqual(p.events, [])
      ReportPayload.parse(p)
    })
  })
})

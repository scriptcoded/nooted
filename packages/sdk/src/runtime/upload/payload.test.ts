import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Capture, ReportPayload } from '@nooted/shared'
import { buildPayload } from './payload.ts'

const base = { openedAt: 1_700_000_000_000, url: 'https://app.test/cart', captures: [] as Capture[] }
const device = { userAgent: 'UA/1.0', viewport: { width: 390, height: 844, devicePixelRatio: 3 } }
const capture: Capture = {
  n: 1,
  url: 'https://app.test/checkout',
  capturedAt: 1_700_000_005_000,
  viewport: { width: 390, height: 844 },
  scroll: { x: 0, y: 40 },
  demo: true,
  events: [
    { type: 4, timestamp: 1, data: { href: 'https://app.test/checkout' } },
    { type: 2, timestamp: 2, data: {} },
  ],
  marks: [{ nodeId: 3, tag: 'button', role: 'button', name: 'Pay', text: 'Pay', selector: '#pay', rect: { x: 1, y: 2, width: 3, height: 4 } }],
}

describe('buildPayload', () => {
  it('produces a payload the shared schema accepts, without captures', () => {
    const p = buildPayload({ ...base, note: 'It broke', device })
    assert.deepEqual(ReportPayload.parse(p), p)
    assert.deepEqual(p.captures, [])
  })

  it('accepts a capture with marks and a demo', () => {
    const p = buildPayload({ ...base, note: 'Click [1] please', captures: [capture], device })
    assert.deepEqual(ReportPayload.parse(p), p)
    assert.deepEqual(p.captures, [capture])
  })

  it('works with default device info outside a browser', () => {
    ReportPayload.parse(buildPayload({ ...base, note: 'x' }))
  })

  it('takes the URL and time from the window opening', () => {
    const p = buildPayload({ ...base, note: 'x', device, captures: [capture] })
    assert.equal(p.url, 'https://app.test/cart')
    assert.equal(p.capturedAt, base.openedAt)
    assert.equal(p.captures[0]?.url, 'https://app.test/checkout')
  })

  it('generates a unique client report id unless given', () => {
    const a = buildPayload({ ...base, note: 'x', device })
    const b = buildPayload({ ...base, note: 'x', device })
    assert.notEqual(a.clientReportId, b.clientReportId)
    const id = '3f1c9b52-7a3e-4a8b-9d55-0c1f2e3a4b5c'
    assert.equal(buildPayload({ ...base, note: 'x', device, clientReportId: id }).clientReportId, id)
  })

  it('includes release only when set', () => {
    assert.equal(buildPayload({ ...base, note: 'x', device, release: '1.2.3' }).release, '1.2.3')
    assert.ok(!('release' in buildPayload({ ...base, note: 'x', device })))
    ReportPayload.parse(buildPayload({ ...base, note: 'x', device, release: '1.2.3' }))
  })
})

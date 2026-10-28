import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hono } from 'hono'
import { frameHeaders } from './frame-headers.ts'
import { createTestApp } from './test-helpers.ts'

describe('app', () => {
  it('GET /api/health responds ok', async () => {
    const { app, db } = await createTestApp()
    const res = await app.request('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'ok' })
    await db.destroy()
  })

  it('forbids framing on every response except the SDK bundles', async () => {
    const { app, db } = await createTestApp()
    for (const path of ['/api/health', '/api/me', '/oauth/authorize', '/nope', '/sdk/sign-in']) {
      const res = await app.request(path)
      assert.match(res.headers.get('content-security-policy') ?? '', /(^|; )frame-ancestors 'none'$/, path)
      assert.equal(res.headers.get('x-frame-options'), 'DENY', path)
    }
    const bundle = await app.request('/sdk/v1/nooted.js')
    assert.equal(bundle.headers.get('x-frame-options'), null)
    assert.equal(bundle.headers.get('content-security-policy'), null)
    await db.destroy()
  })

  it('frameHeaders also covers handlers that return a raw Response (the SPA static files)', async () => {
    const spa = new Hono().get('*', frameHeaders, () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
    const res = await spa.request('/projects/p1')
    assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'")
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
  })
})

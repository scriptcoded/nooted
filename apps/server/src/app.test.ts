import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestApp } from './test-helpers.ts'

describe('app', () => {
  it('GET /api/health responds ok', async () => {
    const { app, db } = await createTestApp()
    const res = await app.request('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'ok' })
    await db.destroy()
  })
})

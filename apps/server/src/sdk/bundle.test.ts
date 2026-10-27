import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createTestApp } from '../test-helpers.ts'

const BODY = 'console.log("nooted")'
const MAP = '{"version":3}'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'nooted-test-sdk-'))
  const t = await createTestApp({ config: { sdkDistDir: dir } })
  return { t, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('GET /sdk/v1/nooted.js', () => {
  it('serves the bundle with JavaScript type, ETag, no-cache and CORP headers', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      await writeFile(join(dir, 'nooted.js'), BODY)
      const res = await t.app.request('/sdk/v1/nooted.js')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin')
      assert.equal(res.headers.get('access-control-allow-origin'), null)
      assert.equal(await res.text(), BODY)
      const etag = res.headers.get('etag') ?? ''
      assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })

  it('returns 304 when If-None-Match matches and 200 when it does not', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      await writeFile(join(dir, 'nooted.js'), BODY)
      const etag = (await t.app.request('/sdk/v1/nooted.js')).headers.get('etag') ?? ''
      const matched = await t.app.request('/sdk/v1/nooted.js', { headers: { 'if-none-match': etag } })
      assert.equal(matched.status, 304)
      assert.equal(matched.headers.get('etag'), etag)
      assert.equal(await matched.text(), '')
      assert.equal((await t.app.request('/sdk/v1/nooted.js', { headers: { 'if-none-match': `W/${etag}` } })).status, 304)
      assert.equal((await t.app.request('/sdk/v1/nooted.js', { headers: { 'if-none-match': `"other", ${etag}` } })).status, 304)
      assert.equal((await t.app.request('/sdk/v1/nooted.js', { headers: { 'if-none-match': '"other"' } })).status, 200)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })

  it('re-reads the file when its mtime changes', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      const file = join(dir, 'nooted.js')
      await writeFile(file, BODY)
      const first = await t.app.request('/sdk/v1/nooted.js')
      await writeFile(file, 'console.log("v2")')
      await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
      const second = await t.app.request('/sdk/v1/nooted.js')
      assert.equal(await second.text(), 'console.log("v2")')
      assert.notEqual(second.headers.get('etag'), first.headers.get('etag'))
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })

  it('returns 404 when the build is missing', async () => {
    const { t, cleanup } = await setup()
    try {
      const res = await t.app.request('/sdk/v1/nooted.js')
      assert.equal(res.status, 404)
      assert.equal(res.headers.get('etag'), null)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })
})

describe('GET /sdk/v1/nooted.js.map', () => {
  it('serves the source map as JSON', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      await writeFile(join(dir, 'nooted.js.map'), MAP)
      const res = await t.app.request('/sdk/v1/nooted.js.map')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'application/json')
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin')
      assert.equal(await res.text(), MAP)
      assert.equal((await t.app.request('/sdk/v1/nooted.js.map', { headers: { 'if-none-match': res.headers.get('etag') ?? '' } })).status, 304)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })

  it('returns 404 when the map is missing', async () => {
    const { t, cleanup } = await setup()
    try {
      assert.equal((await t.app.request('/sdk/v1/nooted.js.map')).status, 404)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })
})

describe('GET /sdk/v1/replay.js', () => {
  it('serves the replay bundle with JavaScript type, ETag, no-cache and CORP headers', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      await writeFile(join(dir, 'replay.js'), BODY)
      const res = await t.app.request('/sdk/v1/replay.js')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin')
      assert.equal(await res.text(), BODY)
      const etag = res.headers.get('etag') ?? ''
      assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/)
      assert.equal((await t.app.request('/sdk/v1/replay.js', { headers: { 'if-none-match': etag } })).status, 304)
      assert.equal((await t.app.request('/sdk/v1/replay.js', { headers: { 'if-none-match': '"other"' } })).status, 200)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })

  it('returns 404 when the build is missing', async () => {
    const { t, cleanup } = await setup()
    try {
      const res = await t.app.request('/sdk/v1/replay.js')
      assert.equal(res.status, 404)
      assert.equal(res.headers.get('etag'), null)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })
})

describe('GET /sdk/v1/replay.js.map', () => {
  it('serves the replay source map as JSON, 404 when missing', async () => {
    const { t, dir, cleanup } = await setup()
    try {
      assert.equal((await t.app.request('/sdk/v1/replay.js.map')).status, 404)
      await writeFile(join(dir, 'replay.js.map'), MAP)
      const res = await t.app.request('/sdk/v1/replay.js.map')
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'application/json')
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin')
      assert.equal(await res.text(), MAP)
      await t.db.destroy()
    } finally {
      await cleanup()
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { gzip } from './gzip.ts'

const text = JSON.stringify({ note: 'héllo wörld ✓', events: Array.from({ length: 200 }, (_, i) => ({ i })) })

describe('gzip', () => {
  it('round-trips with CompressionStream', async () => {
    assert.equal(typeof CompressionStream, 'function')
    const out = await gzip(text)
    assert.equal(gunzipSync(out).toString('utf8'), text)
  })

  it('round-trips with the fflate fallback (option)', async () => {
    const out = await gzip(text, { forceFallback: true })
    assert.equal(gunzipSync(out).toString('utf8'), text)
  })

  it('falls back when CompressionStream is missing', async () => {
    const original = globalThis.CompressionStream
    // @ts-expect-error simulate an old browser
    delete globalThis.CompressionStream
    try {
      const out = await gzip(text)
      assert.equal(gunzipSync(out).toString('utf8'), text)
    } finally {
      globalThis.CompressionStream = original
    }
  })
})

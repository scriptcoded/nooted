import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarizeUserAgent } from './ua.ts'

describe('summarizeUserAgent', () => {
  it('recognises common browsers', () => {
    assert.equal(
      summarizeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
      'Chrome 126 on Linux',
    )
    assert.equal(
      summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/125.0.0.0'),
      'Edge 125 on Windows',
    )
    assert.equal(
      summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
      'Safari 17 on iOS',
    )
    assert.equal(summarizeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Firefox 128 on Linux')
  })
  it('falls back to the raw string', () => {
    assert.equal(summarizeUserAgent('curl/8'), 'curl/8')
  })
})

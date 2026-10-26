import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeOrigin } from './origin.ts'

describe('normalizeOrigin', () => {
  it('normalizes valid origins', () => {
    assert.equal(normalizeOrigin('https://shop.example.com/'), 'https://shop.example.com')
    assert.equal(normalizeOrigin('https://Shop.Example.com'), 'https://shop.example.com')
    assert.equal(normalizeOrigin('https://a.com:443'), 'https://a.com')
    assert.equal(normalizeOrigin('http://localhost:5174'), 'http://localhost:5174')
  })

  it('rejects everything else', () => {
    for (const bad of [
      'shop.example.com/*',
      'shop.example.com',
      'https://a.com/path',
      'https://a.com/?q=1',
      'https://a.com?',
      'https://a.com/#x',
      'https://u:p@a.com',
      'ftp://x.com',
      '',
      '*',
    ]) {
      assert.equal(normalizeOrigin(bad), null, bad)
    }
  })
})

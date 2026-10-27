import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTokenValid } from './token.ts'

const now = 1_700_000_000_000
const tok = (expiresAt: number) => ({ token: 't', expiresAt, user: { name: 'A', email: 'a@b.c' } })

describe('isTokenValid', () => {
  it('valid well before expiry', () => assert.equal(isTokenValid(tok(now + 3_600_000), now), true))
  it('invalid inside the 60 s margin', () => {
    assert.equal(isTokenValid(tok(now + 59_999), now), false)
    assert.equal(isTokenValid(tok(now + 60_000), now), false)
    assert.equal(isTokenValid(tok(now + 60_001), now), true)
  })
  it('invalid when expired or missing', () => {
    assert.equal(isTokenValid(tok(now - 1), now), false)
    assert.equal(isTokenValid(null, now), false)
    assert.equal(isTokenValid(undefined, now), false)
  })
})

describe('token storage', () => {
  const store = new Map<string, string>()
  const g = globalThis as unknown as { sessionStorage?: unknown }
  const original = g.sessionStorage
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  it('round-trips per project key and ignores invalid or expired entries', async () => {
    const { loadToken, saveToken, clearToken } = await import('./token.ts')
    g.sessionStorage = fake
    try {
      saveToken('pk1', tok(now + 3_600_000))
      assert.equal(store.has('nooted:token:pk1'), true)
      assert.equal(loadToken('pk1', now)?.token, 't')
      assert.equal(loadToken('pk2', now), null)
      assert.equal(loadToken('pk1', now + 3_600_000), null)
      store.set('nooted:token:pk3', '{bad')
      assert.equal(loadToken('pk3', now), null)
      clearToken('pk1')
      assert.equal(loadToken('pk1', now), null)
    } finally {
      g.sessionStorage = original
    }
  })
  it('never throws when storage is unavailable', async () => {
    const { loadToken, saveToken, clearToken } = await import('./token.ts')
    g.sessionStorage = undefined
    try {
      saveToken('pk', tok(now + 3_600_000))
      clearToken('pk')
      assert.equal(loadToken('pk', now), null)
    } finally {
      g.sessionStorage = original
    }
  })
})

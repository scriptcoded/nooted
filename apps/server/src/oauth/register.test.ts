import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanupOauth } from './cleanup.ts'
import { createRateLimiter } from './shared.ts'
import { setup } from './test-utils.ts'
import { createTestApp } from '../test-helpers.ts'

describe('POST /oauth/register', () => {
  it('registers a loopback client', async () => {
    const { t, json } = await setup()
    const res = await json('/oauth/register', { redirect_uris: ['http://localhost:54321/callback'], client_name: 'Claude Code' })
    assert.equal(res.status, 201)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(typeof body.client_id, 'string')
    assert.ok((body.client_id as string).length >= 43)
    assert.equal(typeof body.client_id_issued_at, 'number')
    assert.deepEqual(body.redirect_uris, ['http://localhost:54321/callback'])
    assert.equal(body.client_name, 'Claude Code')
    assert.equal(body.token_endpoint_auth_method, 'none')
    assert.deepEqual(body.grant_types, ['authorization_code'])
    assert.deepEqual(body.response_types, ['code'])
    const row = await t.db.selectFrom('oauth_clients').selectAll().executeTakeFirstOrThrow()
    assert.equal(row.id, body.client_id)
    assert.equal(row.last_used_at, null)
  })

  it('accepts valid redirect URIs', async () => {
    const { json } = await setup()
    for (const uri of [
      'https://example.com/cb',
      'https://example.com:8443/cb?x=1',
      'http://127.0.0.1:1234/cb',
      'http://[::1]:1234/cb',
      'http://localhost/cb',
    ]) {
      const res = await json('/oauth/register', { redirect_uris: [uri] })
      assert.equal(res.status, 201, uri)
    }
  })

  it('defaults the name and echoes optional metadata', async () => {
    const { json } = await setup()
    const res = await json('/oauth/register', {
      redirect_uris: ['https://example.com/cb'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    assert.equal(res.status, 201)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.client_name, 'Unnamed client')
    assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token'])
  })

  it('rejects unsafe or malformed redirect URIs with invalid_redirect_uri', async () => {
    const { json } = await setup()
    const bad: unknown[][] = [
      ['http://example.com/cb'],
      ['http://localhost.evil.com/cb'],
      ['https://example.com/cb#frag'],
      ['https://user:pw@example.com/cb'],
      ['javascript:alert(1)'],
      ['cursor://callback'],
      ['/relative'],
      ['not a url'],
      [42],
      [],
      ['https://a.example/1', 'https://a.example/2', 'https://a.example/3', 'https://a.example/4', 'https://a.example/5', 'https://a.example/6'],
      ['https://example.com/ok', 'http://example.com/bad'],
    ]
    for (const uris of bad) {
      const res = await json('/oauth/register', { redirect_uris: uris })
      assert.equal(res.status, 400, JSON.stringify(uris))
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_redirect_uri')
    }
    for (const body of [{}, { redirect_uris: 'https://example.com/cb' }]) {
      const res = await json('/oauth/register', body)
      assert.equal(res.status, 400)
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_redirect_uri')
    }
  })

  it('rejects invalid client metadata', async () => {
    const { json, t } = await setup()
    const uri = ['https://example.com/cb']
    const bad: Record<string, unknown>[] = [
      { redirect_uris: uri, client_name: 'x'.repeat(101) },
      { redirect_uris: uri, client_name: 5 },
      { redirect_uris: uri, token_endpoint_auth_method: 'client_secret_basic' },
      { redirect_uris: uri, grant_types: ['client_credentials'] },
      { redirect_uris: uri, grant_types: ['authorization_code', 'implicit'] },
      { redirect_uris: uri, grant_types: 'authorization_code' },
      { redirect_uris: uri, response_types: ['token'] },
      { redirect_uris: uri, response_types: ['code', 'id_token'] },
    ]
    for (const body of bad) {
      const res = await json('/oauth/register', body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_client_metadata')
    }
    for (const raw of ['not json', '[]', 'null']) {
      const res = await t.app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw })
      assert.equal(res.status, 400, raw)
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_client_metadata')
    }
    assert.equal((await t.db.selectFrom('oauth_clients').selectAll().execute()).length, 0)
  })

  it('allows a 100 character name and strips control characters', async () => {
    const { json } = await setup()
    const res = await json('/oauth/register', { redirect_uris: ['https://example.com/cb'], client_name: `${'a'.repeat(98)}\n\u0007bb` })
    assert.equal(res.status, 201)
    assert.equal(((await res.json()) as { client_name: string }).client_name, `${'a'.repeat(98)}bb`)
  })

  const reg = (t: Awaited<ReturnType<typeof createTestApp>>, headers: Record<string, string> = {}) =>
    t.app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ redirect_uris: ['https://example.com/cb'] }),
    })

  it('rate limits per IP at 20 per hour and resets (TRUST_PROXY_HOPS=1)', async () => {
    const clock = { t: 1_800_000_000_000 }
    const t = await createTestApp({ config: { trustProxyHops: 1 }, oauth: { now: () => clock.t } })
    const from = (ip: string) => ({ 'x-forwarded-for': `spoof, ${ip}` })
    for (let i = 0; i < 20; i++) assert.equal((await reg(t, from('1.2.3.4'))).status, 201)
    const limited = await reg(t, from('1.2.3.4'))
    assert.equal(limited.status, 429)
    assert.equal(((await limited.json()) as { error: string }).error, 'too_many_requests')
    // Another IP is unaffected.
    assert.equal((await reg(t, from('5.6.7.8'))).status, 201)
    // The window slides.
    clock.t += 60 * 60 * 1000 + 1
    assert.equal((await reg(t, from('1.2.3.4'))).status, 201)
  })

  it('a spoofed leftmost X-Forwarded-For does not bypass the limit with TRUST_PROXY_HOPS=1', async () => {
    const t = await createTestApp({ config: { trustProxyHops: 1 } })
    for (let i = 0; i < 20; i++) assert.equal((await reg(t, { 'x-forwarded-for': `fake-${i}, 9.9.9.9` })).status, 201)
    assert.equal((await reg(t, { 'x-forwarded-for': 'fake-new, 9.9.9.9' })).status, 429)
  })

  it('ignores X-Forwarded-For when TRUST_PROXY_HOPS=0', async () => {
    const t = await createTestApp()
    for (let i = 0; i < 20; i++) assert.equal((await reg(t, { 'x-forwarded-for': `fake-${i}` })).status, 201)
    assert.equal((await reg(t, { 'x-forwarded-for': 'fake-new' })).status, 429)
  })

  it('caps the limiter map and evicts the oldest key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0, maxKeys: 3 })
    for (const k of ['a', 'b', 'c', 'd']) assert.equal(limiter.hit(k), true)
    // 'a' was evicted, so it is allowed again; 'd' is still limited.
    assert.equal(limiter.hit('d'), false)
    assert.equal(limiter.hit('a'), true)
  })

  it('refuses registration past the cap of unused clients, counting only clients without grants', async () => {
    const clock = { t: 1_800_000_000_000 }
    const t = await createTestApp({ oauth: { now: () => clock.t, maxUnusedClients: 2, registerLimiter: createRateLimiter({ limit: 1000, windowMs: 1000, now: () => 0 }) } })
    assert.equal((await reg(t)).status, 201)
    assert.equal((await reg(t)).status, 201)
    const refused = await reg(t)
    assert.equal(refused.status, 429)
    assert.equal(((await refused.json()) as { error: string }).error, 'too_many_requests')
    // A day later the old clients no longer count.
    clock.t += 24 * 60 * 60 * 1000 + 1
    assert.equal((await reg(t)).status, 201)
  })
  it('uses an injected limiter that can be reset', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
    const t = await createTestApp({ oauth: { registerLimiter: limiter } })
    const post = () =>
      t.app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://example.com/cb'] }),
      })
    assert.equal((await post()).status, 201)
    assert.equal((await post()).status, 429)
    limiter.reset()
    assert.equal((await post()).status, 201)
  })
})

describe('cleanupOauth', () => {
  it('removes expired rows and stale unused clients only', async () => {
    const { t, clock, register, pkce, startRequest, getCode, exchange } = await setup()
    const day = 24 * 60 * 60 * 1000
    const start = clock.t
    const stale = await register()
    const used = await register()
    // `used` gets a grant, a request, a code and tokens.
    const { verifier, challenge } = pkce()
    const code = await getCode(used, challenge)
    assert.equal((await exchange(used, code, verifier)).status, 200)
    const pending = await startRequest(used, pkce().challenge)

    await cleanupOauth(t.db, start + 1000)
    assert.equal((await t.db.selectFrom('oauth_clients').selectAll().execute()).length, 2)
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().execute()).length, 2)

    // Past request and code expiry, access token expiry; before the 30 day mark.
    await cleanupOauth(t.db, start + 2 * 60 * 60 * 1000)
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().execute()).length, 0, pending)
    assert.equal((await t.db.selectFrom('oauth_codes').selectAll().execute()).length, 0)
    const tokens = await t.db.selectFrom('oauth_tokens').select('kind').execute()
    assert.deepEqual(tokens.map((x) => x.kind), ['refresh'])
    assert.equal((await t.db.selectFrom('oauth_clients').selectAll().execute()).length, 2)

    await cleanupOauth(t.db, start + 31 * day)
    const clients = await t.db.selectFrom('oauth_clients').select('id').execute()
    assert.deepEqual(clients.map((x) => x.id), [used])
    assert.ok(!clients.some((x) => x.id === stale))
    assert.equal((await t.db.selectFrom('oauth_tokens').selectAll().execute()).length, 0)
  })
})

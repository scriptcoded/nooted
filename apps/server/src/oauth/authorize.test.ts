import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeReturnTo } from '../auth/routes.ts'
import { ORIGIN, REDIRECT, RESOURCE, setup } from './test-utils.ts'

describe('GET /oauth/authorize validation', () => {
  it('shows an error page, never a redirect, for an unknown client or bad redirect_uri', async () => {
    const { t, register, pkce, authorize, authorizeQuery, user } = await setup()
    const clientId = await register()
    const { challenge } = pkce()
    const cases = [
      authorizeQuery('unknown-client', challenge),
      authorizeQuery('', challenge),
      authorizeQuery(clientId, challenge, { redirect_uri: 'http://127.0.0.1:54321/other' }),
      authorizeQuery(clientId, challenge, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(clientId, challenge, { redirect_uri: 'https://evil.example/cb' }),
      authorizeQuery(clientId, challenge, { redirect_uri: undefined }),
      // Other errors do not matter when the client cannot be trusted.
      authorizeQuery('unknown-client', challenge, { response_type: 'token' }),
      authorizeQuery(clientId, challenge, { redirect_uri: 'https://evil.example/cb', response_type: 'token' }),
    ]
    for (const query of cases) {
      for (const cookie of [undefined, user.cookie]) {
        const res = await authorize(query, cookie)
        assert.equal(res.status, 400, query)
        assert.equal(res.headers.get('location'), null, query)
        assert.match(res.headers.get('content-type') ?? '', /text\/html/)
      }
    }
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().execute()).length, 0)
  })

  it('does not reflect markup from the query into the error page', async () => {
    const { authorize } = await setup()
    const res = await authorize(`client_id=${encodeURIComponent('<script>alert(1)</script>')}`)
    assert.equal(res.status, 400)
    assert.ok(!(await res.text()).includes('<script>alert'))
  })

  it('redirects other errors to the client with error, state and iss', async () => {
    const { register, pkce, authorize, authorizeQuery, user } = await setup()
    const clientId = await register()
    const { challenge } = pkce()
    const cases: [Record<string, string | undefined>, string][] = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ response_type: undefined }, 'unsupported_response_type'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: undefined }, 'invalid_request'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ resource: `${ORIGIN}/mcp/` }, 'invalid_target'],
      [{ scope: 'feedback.read admin' }, 'invalid_scope'],
      [{ scope: '' }, 'invalid_scope'],
      [{ scope: 'admin' }, 'invalid_scope'],
    ]
    for (const [extra, error] of cases) {
      // Same whether or not signed in: validation comes first.
      for (const cookie of [undefined, user.cookie]) {
        const res = await authorize(authorizeQuery(clientId, challenge, extra), cookie)
        assert.equal(res.status, 302, JSON.stringify(extra))
        const location = new URL(res.headers.get('location') ?? '')
        assert.equal(location.origin + location.pathname, REDIRECT)
        assert.equal(location.searchParams.get('error'), error, JSON.stringify(extra))
        assert.equal(location.searchParams.get('state'), 'st4te')
        assert.equal(location.searchParams.get('iss'), ORIGIN)
        assert.equal(location.searchParams.get('code'), null)
      }
    }
  })

  it('omits state from the error redirect when none was given', async () => {
    const { register, pkce, authorize, authorizeQuery } = await setup()
    const clientId = await register()
    const res = await authorize(authorizeQuery(clientId, pkce().challenge, { state: undefined, response_type: 'token' }))
    assert.equal(new URL(res.headers.get('location') ?? '').searchParams.has('state'), false)
  })

  it('rejects an oversized state', async () => {
    const { register, pkce, authorize, authorizeQuery } = await setup()
    const clientId = await register()
    const res = await authorize(authorizeQuery(clientId, pkce().challenge, { state: 's'.repeat(2000) }))
    assert.equal(new URL(res.headers.get('location') ?? '').searchParams.get('error'), 'invalid_request')
  })
})

describe('GET /oauth/authorize flow', () => {
  it('sends users without a session to sign in and back', async () => {
    const { t, register, pkce, authorize, authorizeQuery } = await setup()
    const clientId = await register()
    const query = authorizeQuery(clientId, pkce().challenge)
    const res = await authorize(query)
    assert.equal(res.status, 302)
    const location = res.headers.get('location') ?? ''
    assert.equal(location, `/auth/login?returnTo=${encodeURIComponent(`/oauth/authorize?${query}`)}`)
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().execute()).length, 0)

    // The login flow accepts that returnTo and returns to the authorize URL.
    const login = await t.app.request(location)
    assert.equal(login.status, 302)
    const attempt = await t.db.selectFrom('login_attempts').selectAll().executeTakeFirstOrThrow()
    assert.equal(attempt.return_to, `/oauth/authorize?${query}`)
  })

  it('allows /oauth/authorize through sanitizeReturnTo but not offsite targets', () => {
    const o = 'http://localhost:5173'
    assert.equal(sanitizeReturnTo('/oauth/authorize?client_id=a&state=b', o), '/oauth/authorize?client_id=a&state=b')
    assert.equal(sanitizeReturnTo('/projects/p1?x=1#top', o), '/projects/p1?x=1#top')
    assert.equal(sanitizeReturnTo('/', o), '/')
    for (const bad of [
      '//evil.example/oauth/authorize',
      'https://evil.example',
      '/\tevil.example',
      '/\t/evil.example',
      '/\t\\evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/a\\b',
      '/\u0000x',
      '/\u007fx',
      'evil.example',
      '',
    ]) {
      assert.equal(sanitizeReturnTo(bad, o), '/', JSON.stringify(bad))
    }
    // Encoded variants stay inert paths on our own origin.
    assert.equal(sanitizeReturnTo('/%09/evil.example', o), '/%09/evil.example')
    assert.equal(sanitizeReturnTo('/%2F/evil.example', o), '/%2F/evil.example')
    assert.equal(sanitizeReturnTo('/%5Cevil.example', o), '/%5Cevil.example')
    assert.equal(sanitizeReturnTo(undefined, o), '/')
  })

  it('stores a ten minute request and redirects to the console', async () => {
    const { t, clock, register, pkce, authorize, authorizeQuery, user } = await setup()
    const clientId = await register()
    const { challenge } = pkce()
    const res = await authorize(authorizeQuery(clientId, challenge), user.cookie)
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const row = await t.db.selectFrom('oauth_requests').selectAll().executeTakeFirstOrThrow()
    assert.equal(res.headers.get('location'), `/connect/${row.id}`)
    assert.equal(row.client_id, clientId)
    assert.equal(row.redirect_uri, REDIRECT)
    assert.equal(row.state, 'st4te')
    assert.equal(row.code_challenge, challenge)
    assert.equal(row.scopes, 'feedback.read feedback.write')
    assert.equal(row.resource, RESOURCE)
    assert.equal(row.expires_at, clock.t + 10 * 60 * 1000)
    assert.equal(row.used_at, null)
    const me = await t.db.selectFrom('users').select('id').where('email', '=', 'user@example.com').executeTakeFirstOrThrow()
    assert.equal(row.user_id, me.id)
  })

  it('defaults resource, honours a narrower scope, and stores no state when absent', async () => {
    const { t, register, pkce, authorize, authorizeQuery, user } = await setup()
    const clientId = await register()
    const res = await authorize(
      authorizeQuery(clientId, pkce().challenge, { resource: undefined, scope: 'feedback.read', state: undefined }),
      user.cookie,
    )
    assert.equal(res.status, 302)
    const row = await t.db.selectFrom('oauth_requests').selectAll().executeTakeFirstOrThrow()
    assert.equal(row.resource, RESOURCE)
    assert.equal(row.scopes, 'feedback.read')
    assert.equal(row.state, null)
  })
})

describe('console API for requests', () => {
  it('requires a session', async () => {
    const { t } = await setup()
    assert.equal((await t.app.request('/api/oauth/requests/x')).status, 401)
    assert.equal((await t.app.request('/api/oauth/requests/x/decision', { method: 'POST' })).status, 401)
    assert.equal((await t.app.request('/api/oauth/grants')).status, 401)
  })

  it('returns the request for its owner only, while unexpired and unused', async () => {
    const { clock, register, pkce, startRequest, decide, user, other, t } = await setup()
    const defaultClient = await register()
    const id = await startRequest(defaultClient, pkce().challenge)
    const get = (cookie: string) => t.app.request(`/api/oauth/requests/${id}`, { headers: { cookie } })
    const res = await get(user.cookie)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      clientName: 'Claude Code',
      redirectHost: '127.0.0.1:54321',
      scopes: ['feedback.read', 'feedback.write'],
      email: 'user@example.com',
    })
    assert.equal((await get(other.cookie)).status, 404)
    assert.equal((await t.app.request('/api/oauth/requests/nope', { headers: { cookie: user.cookie } })).status, 404)
    // Decision as another user: not found, and the request stays usable.
    assert.equal((await decide(id, true, other.cookie)).status, 404)
    assert.equal((await get(user.cookie)).status, 200)
    clock.t += 10 * 60 * 1000
    assert.equal((await get(user.cookie)).status, 404)
  })
})

describe('POST /api/oauth/requests/:id/decision', () => {
  async function pending() {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const id = await s.startRequest(clientId, challenge)
    const codes = () => s.t.db.selectFrom('oauth_codes').selectAll().execute()
    return { ...s, clientId, verifier, challenge, id, codes }
  }

  it('rejects a missing, foreign or lookalike Origin and issues no code', async () => {
    const { id, user, decide, json, codes, t } = await pending()
    for (const origin of [undefined, 'https://evil.example', 'http://localhost:5174', 'http://localhost:5173.evil.example', 'null']) {
      const headers: Record<string, string> = origin === undefined ? {} : { origin }
      const res = await decide(id, true, user.cookie, headers)
      assert.equal(res.status, 403, String(origin))
      assert.equal(res.headers.get('location'), null)
    }
    assert.equal((await codes()).length, 0)
    assert.equal((await t.db.selectFrom('oauth_grants').selectAll().execute()).length, 0)
    // The request was not consumed by the forged attempts.
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().executeTakeFirstOrThrow()).used_at, null)
    assert.equal((await json(`/api/oauth/requests/${id}/decision`, { approve: true }, { cookie: user.cookie, origin: ORIGIN })).status, 200)
  })

  it('rejects a form post (what a cross-site form can send) and issues no code', async () => {
    const { id, user, t, codes } = await pending()
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain']) {
      const res = await t.app.request(`/api/oauth/requests/${id}/decision`, {
        method: 'POST',
        headers: { cookie: user.cookie, origin: ORIGIN, 'content-type': type },
        body: 'approve=true',
      })
      assert.equal(res.status, 415, type)
    }
    // No content type at all.
    const bare = await t.app.request(`/api/oauth/requests/${id}/decision`, { method: 'POST', headers: { cookie: user.cookie, origin: ORIGIN } })
    assert.equal(bare.status, 415)
    // Even a form post with the correct Origin never reaches the handler.
    assert.equal((await codes()).length, 0)
  })

  it('rejects a malformed body without consuming the request', async () => {
    const { id, user, t } = await pending()
    for (const body of ['{}', '{"approve":"yes"}', 'nope']) {
      const res = await t.app.request(`/api/oauth/requests/${id}/decision`, {
        method: 'POST',
        headers: { cookie: user.cookie, origin: ORIGIN, 'content-type': 'application/json' },
        body,
      })
      assert.equal(res.status, 400, body)
    }
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().executeTakeFirstOrThrow()).used_at, null)
  })

  it('approves: creates a grant and a hashed 60 second code, and returns the redirect', async () => {
    const { id, user, decide, codes, t, clock, clientId, challenge } = await pending()
    const res = await decide(id, true, user.cookie)
    assert.equal(res.status, 200)
    const { redirectTo } = (await res.json()) as { redirectTo: string }
    const url = new URL(redirectTo)
    assert.equal(url.origin + url.pathname, REDIRECT)
    const code = url.searchParams.get('code') ?? ''
    assert.ok(code.length >= 43)
    assert.equal(url.searchParams.get('state'), 'st4te')
    assert.equal(url.searchParams.get('iss'), ORIGIN)

    const [row] = await codes()
    assert.ok(row)
    assert.notEqual(row.hash, code) // stored hashed
    assert.equal(row.expires_at, clock.t + 60_000)
    assert.equal(row.code_challenge, challenge)
    assert.equal(row.redirect_uri, REDIRECT)
    assert.equal(row.resource, RESOURCE)
    assert.equal(row.scopes, 'feedback.read feedback.write')
    assert.equal(row.used_at, null)
    const grant = await t.db.selectFrom('oauth_grants').selectAll().executeTakeFirstOrThrow()
    assert.equal(grant.id, row.grant_id)
    assert.equal(grant.client_id, clientId)
    assert.equal(grant.revoked_at, null)
    assert.equal((await t.db.selectFrom('oauth_requests').selectAll().executeTakeFirstOrThrow()).used_at, clock.t)
  })

  it('appends to an existing redirect query correctly', async () => {
    const s = await setup()
    const clientId = await s.register(['https://app.example.org/cb?tenant=a%26b'])
    const id = await s.startRequest(clientId, s.pkce().challenge, s.user.cookie, { redirect_uri: 'https://app.example.org/cb?tenant=a%26b', state: 'a b&c' })
    const { redirectTo } = (await (await s.decide(id, true)).json()) as { redirectTo: string }
    const url = new URL(redirectTo)
    assert.equal(url.searchParams.get('tenant'), 'a&b')
    assert.equal(url.searchParams.get('state'), 'a b&c')
    assert.ok(url.searchParams.get('code'))
  })

  it('is single use', async () => {
    const { id, decide, codes } = await pending()
    assert.equal((await decide(id, true)).status, 200)
    assert.equal((await decide(id, true)).status, 404)
    assert.equal((await decide(id, false)).status, 404)
    assert.equal((await codes()).length, 1)
  })

  it('refuses after expiry', async () => {
    const { id, decide, clock, codes } = await pending()
    clock.t += 10 * 60 * 1000
    assert.equal((await decide(id, true)).status, 404)
    assert.equal((await codes()).length, 0)
  })

  it('deny returns access_denied with state and no code or grant', async () => {
    const { id, decide, codes, t } = await pending()
    const res = await decide(id, false)
    assert.equal(res.status, 200)
    const url = new URL(((await res.json()) as { redirectTo: string }).redirectTo)
    assert.equal(url.origin + url.pathname, REDIRECT)
    assert.equal(url.searchParams.get('error'), 'access_denied')
    assert.equal(url.searchParams.get('state'), 'st4te')
    assert.equal(url.searchParams.get('code'), null)
    assert.equal((await codes()).length, 0)
    assert.equal((await t.db.selectFrom('oauth_grants').selectAll().execute()).length, 0)
  })

  it('reuses the active grant and sets its scopes to the new request', async () => {
    const s = await setup()
    const clientId = await s.register()
    await s.getCode(clientId, s.pkce().challenge)
    await s.getCode(clientId, s.pkce().challenge, { scope: 'feedback.read' })
    const grants = await s.t.db.selectFrom('oauth_grants').selectAll().execute()
    assert.equal(grants.length, 1)
    assert.equal(grants[0]?.scopes, 'feedback.read')
    assert.equal((await s.t.db.selectFrom('oauth_codes').selectAll().execute()).length, 2)
  })

  it('creates a fresh grant after the old one was revoked', async () => {
    const s = await setup()
    const clientId = await s.register()
    await s.getCode(clientId, s.pkce().challenge)
    await s.t.db.updateTable('oauth_grants').set({ revoked_at: s.clock.t }).execute()
    await s.getCode(clientId, s.pkce().challenge)
    const grants = await s.t.db.selectFrom('oauth_grants').select('revoked_at').execute()
    assert.equal(grants.length, 2)
    assert.equal(grants.filter((g) => g.revoked_at === null).length, 1)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authenticateBearer, bearerChallenge } from './bearer.ts'
import { ORIGIN, setup } from './test-utils.ts'

async function ready() {
  const s = await setup()
  const deps = { config: s.t.config, db: s.t.db, oauth: { now: () => s.clock.t } }
  const flow = await s.connect()
  const auth = (token: string) => authenticateBearer(deps, s.bearer(token))
  return { ...s, ...flow, deps, auth }
}

describe('authenticateBearer', () => {
  it('accepts a valid access token and returns user, grant, client and scopes', async () => {
    const { auth, tokens, clientId, t } = await ready()
    const result = await auth(tokens.access_token)
    assert.ok(!('error' in result))
    assert.equal(result.user.email, 'user@example.com')
    assert.equal(result.user.isAdmin, false)
    assert.equal(result.clientId, clientId)
    assert.deepEqual(result.scopes, ['feedback.read', 'feedback.write'])
    const grant = await t.db.selectFrom('oauth_grants').select('id').executeTakeFirstOrThrow()
    assert.equal(result.grantId, grant.id)
  })

  it('reports admins through the same rule as console sessions', async () => {
    const s = await setup()
    const admin = await (await import('../test-helpers.ts')).signIn(s.t, { email: 'admin@example.com' })
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const requestId = await s.startRequest(clientId, challenge, admin.cookie)
    const { redirectTo } = (await (await s.decide(requestId, true, admin.cookie)).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code') ?? ''
    const tokens = (await (await s.exchange(clientId, code, verifier)).json()) as { access_token: string }
    const result = await authenticateBearer({ config: s.t.config, db: s.t.db, oauth: { now: () => s.clock.t } }, s.bearer(tokens.access_token))
    assert.ok(!('error' in result))
    assert.equal(result.user.isAdmin, true)
  })

  it('distinguishes a missing credential from an invalid one', async () => {
    const { deps, tokens } = await ready()
    const req = (headers: Record<string, string>) => new Request(`${ORIGIN}/mcp`, { headers })
    assert.deepEqual(await authenticateBearer(deps, req({})), { error: 'missing' })
    assert.deepEqual(await authenticateBearer(deps, req({ authorization: 'Basic abc' })), { error: 'missing' })
    assert.deepEqual(await authenticateBearer(deps, req({ authorization: 'Bearer ' })), { error: 'missing' })
    assert.deepEqual(await authenticateBearer(deps, req({ authorization: 'Bearer nat_unknown' })), { error: 'invalid' })
    assert.deepEqual(await authenticateBearer(deps, req({ authorization: 'Bearer garbage' })), { error: 'invalid' })
    const ok = await authenticateBearer(deps, req({ authorization: `bearer ${tokens.access_token}` }))
    assert.ok(!('error' in ok))
  })

  it('rejects an expired token', async () => {
    const { auth, tokens, clock } = await ready()
    clock.t += 3600_000 - 1
    assert.ok(!('error' in (await auth(tokens.access_token))))
    clock.t += 1
    assert.deepEqual(await auth(tokens.access_token), { error: 'invalid' })
  })

  it('rejects a refresh token presented as an access token', async () => {
    const { auth, tokens, t } = await ready()
    assert.deepEqual(await auth(tokens.refresh_token), { error: 'invalid' })
    // Even if someone rewrote the prefix, the kind is checked.
    await t.db.updateTable('oauth_tokens').set({ hash: 'x' }).where('kind', '=', 'access').execute()
    assert.deepEqual(await auth(tokens.access_token), { error: 'invalid' })
  })

  it('rejects a token bound to another resource', async () => {
    const { auth, tokens, t } = await ready()
    await t.db.updateTable('oauth_tokens').set({ resource: 'https://other.example/mcp' }).execute()
    assert.deepEqual(await auth(tokens.access_token), { error: 'invalid' })
    await t.db.updateTable('oauth_tokens').set({ resource: '' }).execute()
    assert.deepEqual(await auth(tokens.access_token), { error: 'invalid' })
  })

  it('rejects a revoked token, a revoked grant, and a deleted client or user', async () => {
    const r = await ready()
    await r.t.db.updateTable('oauth_tokens').set({ revoked_at: r.clock.t }).where('kind', '=', 'access').execute()
    assert.deepEqual(await r.auth(r.tokens.access_token), { error: 'invalid' })

    const g = await ready()
    await g.t.db.updateTable('oauth_grants').set({ revoked_at: g.clock.t }).execute()
    assert.deepEqual(await g.auth(g.tokens.access_token), { error: 'invalid' })

    const c = await ready()
    await c.t.db.deleteFrom('oauth_clients').execute()
    assert.deepEqual(await c.auth(c.tokens.access_token), { error: 'invalid' })

    const u = await ready()
    await u.t.db.deleteFrom('users').where('email', '=', 'user@example.com').execute()
    assert.deepEqual(await u.auth(u.tokens.access_token), { error: 'invalid' })
  })

  it('takes scopes from the token, so a narrowed refresh narrows access', async () => {
    const s = await ready()
    const res = await s.refresh(s.clientId, s.tokens.refresh_token, { scope: 'feedback.read' })
    const next = (await res.json()) as { access_token: string }
    const result = await s.auth(next.access_token)
    assert.ok(!('error' in result))
    assert.deepEqual(result.scopes, ['feedback.read'])
  })

  it('a re-consent that narrows the grant also narrows existing access tokens', async () => {
    const s = await ready()
    const before = await s.auth(s.tokens.access_token)
    assert.ok(!('error' in before))
    assert.deepEqual(before.scopes, ['feedback.read', 'feedback.write'])
    const requestId = await s.startRequest(s.clientId, s.pkce().challenge, s.user.cookie, { scope: 'feedback.read' })
    assert.equal((await s.decide(requestId, true)).status, 200)
    const after = await s.auth(s.tokens.access_token)
    assert.ok(!('error' in after))
    assert.deepEqual(after.scopes, ['feedback.read'])
  })

  it('updates grants.last_used_at at most once a minute', async () => {
    const { auth, tokens, t, clock } = await ready()
    const lastUsed = async () => (await t.db.selectFrom('oauth_grants').select('last_used_at').executeTakeFirstOrThrow()).last_used_at
    const issued = clock.t
    assert.equal(await lastUsed(), issued)
    clock.t += 30_000
    await auth(tokens.access_token)
    assert.equal(await lastUsed(), issued)
    clock.t += 31_000
    await auth(tokens.access_token)
    assert.equal(await lastUsed(), clock.t)
    const stamped = clock.t
    clock.t += 59_000
    await auth(tokens.access_token)
    assert.equal(await lastUsed(), stamped)
  })

  it('does not update last_used_at for failed authentication', async () => {
    const { auth, t, clock } = await ready()
    clock.t += 120_000
    await auth('nat_unknown')
    assert.notEqual((await t.db.selectFrom('oauth_grants').select('last_used_at').executeTakeFirstOrThrow()).last_used_at, clock.t)
  })
})

describe('bearerChallenge', () => {
  it('points at the protected resource metadata', () => {
    assert.equal(bearerChallenge(ORIGIN), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`)
    assert.equal(bearerChallenge(ORIGIN, 'missing'), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`)
  })
  it('adds invalid_token when a token was presented', () => {
    assert.equal(
      bearerChallenge(ORIGIN, 'invalid'),
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token"`,
    )
  })
})

describe('token boundaries', () => {
  it('the console API rejects an MCP access token as a bearer credential', async () => {
    const { t, tokens } = await ready()
    for (const path of ['/api/projects', '/api/me', '/api/oauth/grants']) {
      const res = await t.app.request(path, { headers: { authorization: `Bearer ${tokens.access_token}` } })
      assert.equal(res.status, 401, path)
    }
    const decision = await t.app.request('/api/oauth/requests/x/decision', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}`, origin: ORIGIN, 'content-type': 'application/json' },
      body: '{"approve":true}',
    })
    assert.equal(decision.status, 401)
  })
})

describe('console grants API', () => {
  const grants = (s: Awaited<ReturnType<typeof ready>>, cookie: string) => s.t.app.request('/api/oauth/grants', { headers: { cookie } })
  const del = (s: Awaited<ReturnType<typeof ready>>, id: string, cookie: string, headers: Record<string, string> = { origin: ORIGIN }) =>
    s.t.app.request(`/api/oauth/grants/${id}`, { method: 'DELETE', headers: { cookie, ...headers } })

  it('lists only the signed-in user\'s active grants', async () => {
    const s = await ready()
    const mine = (await (await grants(s, s.user.cookie)).json()) as Record<string, unknown>[]
    assert.equal(mine.length, 1)
    assert.deepEqual(mine[0], {
      id: mine[0]?.id,
      clientName: 'Claude Code',
      scopes: ['feedback.read', 'feedback.write'],
      createdAt: s.clock.t,
      lastUsedAt: s.clock.t,
    })
    assert.deepEqual(await (await grants(s, s.other.cookie)).json(), [])
    const body = JSON.stringify(mine)
    assert.ok(!body.includes('hash') && !body.includes(s.tokens.access_token))
  })

  it('deletes a grant: it vanishes and its tokens stop working', async () => {
    const s = await ready()
    const [grant] = (await (await grants(s, s.user.cookie)).json()) as { id: string }[]
    assert.ok(grant)
    const res = await del(s, grant.id, s.user.cookie)
    assert.equal(res.status, 204)
    assert.deepEqual(await (await grants(s, s.user.cookie)).json(), [])
    assert.deepEqual(await s.auth(s.tokens.access_token), { error: 'invalid' })
    assert.equal((await s.refresh(s.clientId, s.tokens.refresh_token)).status, 400)
    assert.equal((await del(s, grant.id, s.user.cookie)).status, 404)
  })

  it('cannot delete another user\'s grant', async () => {
    const s = await ready()
    const [grant] = (await (await grants(s, s.user.cookie)).json()) as { id: string }[]
    assert.ok(grant)
    assert.equal((await del(s, grant.id, s.other.cookie)).status, 404)
    assert.ok(!('error' in (await s.auth(s.tokens.access_token))))
  })

  it('requires a same-origin request to delete', async () => {
    const s = await ready()
    const [grant] = (await (await grants(s, s.user.cookie)).json()) as { id: string }[]
    assert.ok(grant)
    for (const headers of [{} as Record<string, string>, { origin: 'https://evil.example' }]) {
      assert.equal((await del(s, grant.id, s.user.cookie, headers)).status, 403)
    }
    assert.ok(!('error' in (await s.auth(s.tokens.access_token))))
    assert.equal((await s.t.app.request(`/api/oauth/grants/${grant.id}`, { method: 'DELETE' })).status, 401)
  })

  it('a re-approval after revoke yields a new grant that works', async () => {
    const s = await ready()
    const [grant] = (await (await grants(s, s.user.cookie)).json()) as { id: string }[]
    assert.ok(grant)
    await del(s, grant.id, s.user.cookie)
    const again = await s.connect()
    assert.ok(!('error' in (await s.auth(again.tokens.access_token))))
    assert.equal(((await (await grants(s, s.user.cookie)).json()) as unknown[]).length, 1)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hashSecret } from './shared.ts'
import { REDIRECT, RESOURCE, setup } from './test-utils.ts'

type Err = { error: string; error_description: string }

describe('POST /oauth/token authorization_code', () => {
  it('exchanges a code for tokens stored only as hashes', async () => {
    const { t, clock, connect } = await setup()
    const { clientId, tokens } = await connect()
    assert.equal(tokens.token_type, 'Bearer')
    assert.equal(tokens.expires_in, 3600)
    assert.equal(tokens.scope, 'feedback.read feedback.write')
    assert.match(tokens.access_token, /^nat_[A-Za-z0-9_-]{43}$/)
    assert.match(tokens.refresh_token, /^nrt_[A-Za-z0-9_-]{43}$/)

    const rows = await t.db.selectFrom('oauth_tokens').selectAll().orderBy('kind').execute()
    assert.equal(rows.length, 2)
    const [access, refresh] = rows
    assert.ok(access && refresh)
    assert.equal(access.kind, 'access')
    assert.equal(access.hash, hashSecret(tokens.access_token))
    assert.equal(access.expires_at, clock.t + 3600_000)
    assert.equal(refresh.kind, 'refresh')
    assert.equal(refresh.hash, hashSecret(tokens.refresh_token))
    assert.equal(refresh.expires_at, clock.t + 30 * 24 * 3600_000)
    assert.equal(access.family, refresh.family)
    for (const row of rows) {
      assert.equal(row.scopes, 'feedback.read feedback.write')
      assert.equal(row.resource, RESOURCE)
      assert.ok(!JSON.stringify(row).includes(tokens.access_token))
      assert.ok(!JSON.stringify(row).includes(tokens.refresh_token))
    }
    const grant = await t.db.selectFrom('oauth_grants').selectAll().executeTakeFirstOrThrow()
    assert.equal(grant.last_used_at, clock.t)
    const client = await t.db.selectFrom('oauth_clients').selectAll().where('id', '=', clientId).executeTakeFirstOrThrow()
    assert.equal(client.last_used_at, clock.t)
  })

  it('sends no-store headers on success and on errors', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    assert.ok(tokens)
    const bad = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId })
    for (const res of [bad, await s.refresh(clientId, tokens.refresh_token)]) {
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(res.headers.get('pragma'), 'no-cache')
    }
  })

  it('carries a narrowed scope into the tokens', async () => {
    const s = await setup()
    const { tokens } = await s.connect({ scope: 'feedback.read' })
    assert.equal(tokens.scope, 'feedback.read')
    const row = await s.t.db.selectFrom('oauth_tokens').select('scopes').executeTakeFirstOrThrow()
    assert.equal(row.scopes, 'feedback.read')
  })

  it('accepts a matching resource and JSON bodies', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const res = await s.json('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: RESOURCE,
    })
    assert.equal(res.status, 200)
  })

  it('rejects a wrong PKCE verifier with invalid_grant, and the code is then spent', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const wrong = await s.exchange(clientId, code, s.pkce().verifier)
    assert.equal(wrong.status, 400)
    assert.equal(((await wrong.json()) as Err).error, 'invalid_grant')
    assert.equal((await s.t.db.selectFrom('oauth_tokens').selectAll().execute()).length, 0)
    // Even the right verifier no longer works.
    assert.equal((await s.exchange(clientId, code, verifier)).status, 400)
    assert.equal((await s.t.db.selectFrom('oauth_tokens').selectAll().execute()).length, 0)
  })

  it('rejects a malformed verifier as invalid_request', async () => {
    const s = await setup()
    const clientId = await s.register()
    const code = await s.getCode(clientId, s.pkce().challenge)
    for (const verifier of ['short', 'a'.repeat(129), `${'a'.repeat(42)} `]) {
      const res = await s.exchange(clientId, code, verifier)
      assert.equal(res.status, 400)
      assert.equal(((await res.json()) as Err).error, 'invalid_request')
    }
  })

  it('rejects a wrong redirect_uri', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const res = await s.exchange(clientId, code, verifier, { redirect_uri: 'http://127.0.0.1:54321/other' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as Err).error, 'invalid_grant')
  })

  it('rejects a mismatching resource with invalid_target', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const res = await s.exchange(clientId, code, verifier, { resource: 'https://other.example/mcp' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as Err).error, 'invalid_target')
  })

  it('rejects an expired code', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    s.clock.t += 60_000
    const res = await s.exchange(clientId, code, verifier)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as Err).error, 'invalid_grant')
  })

  it('rejects an unknown code', async () => {
    const s = await setup()
    const clientId = await s.register()
    const res = await s.exchange(clientId, 'nonsense', s.pkce().verifier)
    assert.equal(((await res.json()) as Err).error, 'invalid_grant')
  })

  it('rejects a code presented by another client', async () => {
    const s = await setup()
    const clientId = await s.register()
    const intruder = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const res = await s.exchange(intruder, code, verifier)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as Err).error, 'invalid_grant')
    // The owner's grant is untouched by the failed attempt.
    assert.equal((await s.t.db.selectFrom('oauth_grants').select('revoked_at').executeTakeFirstOrThrow()).revoked_at, null)
  })

  it('revokes only the tokens a replayed code produced, not the whole grant', async () => {
    const s = await setup()
    const clientId = await s.register()
    const first = s.pkce()
    const second = s.pkce()
    const code1 = await s.getCode(clientId, first.challenge)
    const code2 = await s.getCode(clientId, second.challenge)
    const t1 = (await (await s.exchange(clientId, code1, first.verifier)).json()) as { access_token: string; refresh_token: string }
    const t2 = (await (await s.exchange(clientId, code2, second.verifier)).json()) as { access_token: string; refresh_token: string }
    const rows = await s.t.db.selectFrom('oauth_tokens').select(['hash', 'family']).execute()
    assert.equal(rows.find((r) => r.hash === hashSecret(t1.access_token))?.family, hashSecret(code1))

    const again = await s.exchange(clientId, code1, first.verifier)
    assert.equal(again.status, 400)
    assert.equal(((await again.json()) as Err).error, 'invalid_grant')
    const grant = await s.t.db.selectFrom('oauth_grants').select('revoked_at').executeTakeFirstOrThrow()
    assert.equal(grant.revoked_at, null)
    assert.equal((await s.refresh(clientId, t1.refresh_token)).status, 400)
    assert.equal((await s.refresh(clientId, t2.refresh_token)).status, 200)
  })

  it('a garbage verifier from a thief cannot make the legitimate exchange revoke the grant', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const thief = await s.exchange(clientId, code, s.pkce().verifier)
    assert.equal(thief.status, 400)
    const legit = await s.exchange(clientId, code, verifier)
    assert.equal(legit.status, 400)
    assert.equal((await s.t.db.selectFrom('oauth_grants').select('revoked_at').executeTakeFirstOrThrow()).revoked_at, null)
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 200)
  })

  it('a concurrent double exchange yields at most one success and revokes what it minted', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    const results = await Promise.all([s.exchange(clientId, code, verifier), s.exchange(clientId, code, verifier)])
    assert.ok(results.filter((r) => r.status === 200).length <= 1)
    assert.ok(results.some((r) => r.status === 400))
    const rows = await s.t.db.selectFrom('oauth_tokens').select(['family', 'revoked_at']).execute()
    assert.ok(rows.every((r) => r.family === hashSecret(code) && r.revoked_at !== null))
  })

  it('does not issue tokens for a revoked grant', async () => {
    const s = await setup()
    const clientId = await s.register()
    const { verifier, challenge } = s.pkce()
    const code = await s.getCode(clientId, challenge)
    await s.t.db.updateTable('oauth_grants').set({ revoked_at: s.clock.t }).execute()
    assert.equal((await s.exchange(clientId, code, verifier)).status, 400)
  })

  it('validates client and grant type', async () => {
    const s = await setup()
    const unknown = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: 'nope' })
    assert.equal(unknown.status, 401)
    assert.equal(((await unknown.json()) as Err).error, 'invalid_client')
    const missing = await s.form('/oauth/token', { grant_type: 'authorization_code' })
    assert.equal(missing.status, 400)
    const clientId = await s.register()
    for (const grant_type of ['client_credentials', 'password', '']) {
      const res = await s.form('/oauth/token', { grant_type, client_id: clientId })
      assert.equal(res.status, 400)
      assert.equal(((await res.json()) as Err).error, 'unsupported_grant_type')
    }
    const noParams = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId })
    assert.equal(((await noParams.json()) as Err).error, 'invalid_request')
    const wrongType = await s.t.app.request('/oauth/token', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })
    assert.equal(wrongType.status, 400)
  })
})

describe('POST /oauth/token refresh_token', () => {
  it('rotates: new tokens in the same family, old refresh token spent', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    s.clock.t += 1000
    const res = await s.refresh(clientId, tokens.refresh_token)
    assert.equal(res.status, 200)
    const next = (await res.json()) as typeof tokens
    assert.notEqual(next.refresh_token, tokens.refresh_token)
    assert.notEqual(next.access_token, tokens.access_token)
    assert.equal(next.scope, 'feedback.read feedback.write')
    assert.equal(next.expires_in, 3600)
    const rows = await s.t.db.selectFrom('oauth_tokens').select(['family', 'kind', 'used_at', 'resource', 'scopes']).execute()
    assert.equal(rows.length, 4)
    assert.equal(new Set(rows.map((r) => r.family)).size, 1)
    assert.equal(rows.filter((r) => r.used_at !== null).length, 1)
    assert.ok(rows.every((r) => r.resource === RESOURCE))
    // The new tokens work, the new refresh token rotates again.
    assert.equal((await s.refresh(clientId, next.refresh_token)).status, 200)
  })

  it('treats reuse of a rotated refresh token as theft: the grant and all tokens die', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const first = (await (await s.refresh(clientId, tokens.refresh_token)).json()) as typeof tokens
    const { authenticateBearer } = await import('./bearer.ts')
    const deps = { config: s.t.config, db: s.t.db, oauth: { now: () => s.clock.t } }
    assert.ok(!('error' in (await authenticateBearer(deps, s.bearer(first.access_token)))))

    const replay = await s.refresh(clientId, tokens.refresh_token)
    assert.equal(replay.status, 400)
    assert.equal(((await replay.json()) as Err).error, 'invalid_grant')
    assert.deepEqual(await authenticateBearer(deps, s.bearer(first.access_token)), { error: 'invalid' })
    assert.deepEqual(await authenticateBearer(deps, s.bearer(tokens.access_token)), { error: 'invalid' })
    assert.equal((await s.refresh(clientId, first.refresh_token)).status, 400)
    assert.equal((await s.t.db.selectFrom('oauth_grants').select('revoked_at').executeTakeFirstOrThrow()).revoked_at, s.clock.t)
  })

  it('narrows scope but never widens it', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const narrowed = await s.refresh(clientId, tokens.refresh_token, { scope: 'feedback.read' })
    assert.equal(narrowed.status, 200)
    const next = (await narrowed.json()) as typeof tokens
    assert.equal(next.scope, 'feedback.read')
    const widen = await s.refresh(clientId, next.refresh_token, { scope: 'feedback.read feedback.write' })
    assert.equal(widen.status, 400)
    assert.equal(((await widen.json()) as Err).error, 'invalid_scope')
    const junk = await s.refresh(clientId, next.refresh_token, { scope: 'admin' })
    assert.equal(((await junk.json()) as Err).error, 'invalid_scope')
    // A rejected widening does not consume the token.
    assert.equal((await s.refresh(clientId, next.refresh_token)).status, 200)
  })

  it('rejects expired, unknown, access, revoked and other-client refresh tokens', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const other = await s.register()
    const err = async (res: Response) => {
      assert.equal(res.status, 400)
      return ((await res.json()) as Err).error
    }
    assert.equal(await err(await s.refresh(clientId, 'nrt_unknown')), 'invalid_grant')
    assert.equal(await err(await s.refresh(clientId, tokens.access_token)), 'invalid_grant')
    assert.equal(await err(await s.refresh(other, tokens.refresh_token)), 'invalid_grant')
    // A foreign client does not burn the grant.
    assert.equal((await s.t.db.selectFrom('oauth_grants').select('revoked_at').executeTakeFirstOrThrow()).revoked_at, null)
    const missing = await s.form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId })
    assert.equal(await err(missing), 'invalid_request')
    s.clock.t += 30 * 24 * 3600_000
    assert.equal(await err(await s.refresh(clientId, tokens.refresh_token)), 'invalid_grant')
  })

  it('rejects a refresh token whose token or grant was revoked', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    await s.t.db.updateTable('oauth_grants').set({ revoked_at: s.clock.t }).execute()
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 400)
  })
})

describe('request hygiene', () => {
  it('rejects duplicate form parameters on /token and /revoke', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const dup = (path: string, body: string) =>
      s.t.app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const t = await dup('/oauth/token', `grant_type=refresh_token&client_id=${clientId}&refresh_token=${tokens.refresh_token}&refresh_token=nrt_other`)
    assert.equal(t.status, 400)
    assert.equal(((await t.json()) as Err).error, 'invalid_request')
    const r = await dup('/oauth/revoke', `token=${tokens.access_token}&token=x&client_id=${clientId}`)
    assert.equal(r.status, 400)
    assert.equal(((await r.json()) as Err).error, 'invalid_request')
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 200)
  })

  it('answers 413 for oversized bodies on /register, /token and /revoke', async () => {
    const s = await setup()
    const big = 'a'.repeat(17 * 1024)
    for (const [path, type] of [['/oauth/register', 'application/json'], ['/oauth/token', 'application/x-www-form-urlencoded'], ['/oauth/revoke', 'application/x-www-form-urlencoded']] as const) {
      const body = type === 'application/json' ? JSON.stringify({ client_name: big }) : `token=${big}`
      const res = await s.t.app.request(path, { method: 'POST', headers: { 'content-type': type }, body })
      assert.equal(res.status, 413, path)
    }
    assert.equal((await s.t.db.selectFrom('oauth_clients').selectAll().execute()).length, 0)
  })

  it('a narrowing re-consent also narrows refresh', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const { challenge } = s.pkce()
    const requestId = await s.startRequest(clientId, challenge, s.user.cookie, { scope: 'feedback.read' })
    assert.equal((await s.decide(requestId, true)).status, 200)
    const res = await s.refresh(clientId, tokens.refresh_token)
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { scope: string }).scope, 'feedback.read')
  })

  it('concurrent first-time approvals for one user and client both succeed with one active grant', async () => {
    const s = await setup()
    const clientId = await s.register()
    const r1 = await s.startRequest(clientId, s.pkce().challenge)
    const r2 = await s.startRequest(clientId, s.pkce().challenge)
    const [a, b] = await Promise.all([s.decide(r1, true), s.decide(r2, true)])
    assert.equal(a.status, 200)
    assert.equal(b.status, 200)
    const grants = await s.t.db.selectFrom('oauth_grants').selectAll().where('revoked_at', 'is', null).execute()
    assert.equal(grants.length, 1)
    assert.equal((await s.t.db.selectFrom('oauth_codes').selectAll().execute()).length, 2)
  })
})

describe('POST /oauth/revoke', () => {
  const revoke = (s: Awaited<ReturnType<typeof setup>>, body: Record<string, string>) => s.form('/oauth/revoke', body)

  it('revokes a refresh token together with the access tokens of its family', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const { authenticateBearer } = await import('./bearer.ts')
    const deps = { config: s.t.config, db: s.t.db, oauth: { now: () => s.clock.t } }
    const res = await revoke(s, { token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: clientId })
    assert.equal(res.status, 200)
    assert.deepEqual(await authenticateBearer(deps, s.bearer(tokens.access_token)), { error: 'invalid' })
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 400)
  })

  it('revokes only the access token when given one', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    assert.equal((await revoke(s, { token: tokens.access_token, client_id: clientId })).status, 200)
    const { authenticateBearer } = await import('./bearer.ts')
    const deps = { config: s.t.config, db: s.t.db, oauth: { now: () => s.clock.t } }
    assert.deepEqual(await authenticateBearer(deps, s.bearer(tokens.access_token)), { error: 'invalid' })
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 200)
  })

  it('answers 200 for unknown tokens and ignores another client\'s token', async () => {
    const s = await setup()
    const { clientId, tokens } = await s.connect()
    const other = await s.register()
    assert.equal((await revoke(s, { token: 'nrt_unknown', client_id: clientId })).status, 200)
    assert.equal((await revoke(s, { token: tokens.refresh_token, client_id: other })).status, 200)
    assert.equal((await revoke(s, { token: tokens.refresh_token, client_id: 'unknown-client' })).status, 200)
    assert.equal((await s.refresh(clientId, tokens.refresh_token)).status, 200)
    const missing = await revoke(s, { client_id: clientId })
    assert.equal(missing.status, 400)
  })
})

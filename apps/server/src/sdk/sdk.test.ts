import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hono } from 'hono'
import { createTestApp, signIn } from '../test-helpers.ts'
import { sdkOriginCheck, sdkPreflight } from './cors.ts'
import { issueUploadToken, requireUploadToken, revokeUploadToken, verifyUploadToken } from './tokens.ts'
import type { UploadEnv } from './tokens.ts'

type T = Awaited<ReturnType<typeof createTestApp>>

const ORIGIN = 'https://shop.example.com'
const HOUR = 60 * 60 * 1000

async function setup() {
  const t = await createTestApp()
  const now = Date.now()
  await t.db.insertInto('projects').values({ id: 'p1', name: 'Shop', public_key: 'pk_1', retention_days: 90, created_at: now }).execute()
  await t.db.insertInto('projects').values({ id: 'p2', name: 'Blog', public_key: 'pk_2', retention_days: 90, created_at: now }).execute()
  await t.db.insertInto('project_origins').values({ project_id: 'p1', origin: ORIGIN }).execute()
  await t.db.insertInto('project_origins').values({ project_id: 'p2', origin: 'https://blog.example.com' }).execute()
  const member = await signIn(t, { email: 'dev@example.com', name: 'Dev' })
  const userId = (await t.db.selectFrom('users').select('id').where('email', '=', 'dev@example.com').executeTakeFirstOrThrow()).id
  await t.db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'dev@example.com', user_id: userId }).execute()
  return { t, member, userId }
}

const signInUrl = (key = 'pk_1', origin = ORIGIN) => `/sdk/sign-in?key=${key}&origin=${encodeURIComponent(origin)}`
const tokenCount = async (t: T) => (await t.db.selectFrom('upload_tokens').selectAll().execute()).length
const postToken = (t: T, cookie: string, headers: Record<string, string> = { 'x-nooted-sign-in': '1' }, body: unknown = { key: 'pk_1', origin: ORIGIN }) =>
  t.app.request('/sdk/sign-in/token', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

describe('upload tokens', () => {
  it('issues nt_ tokens stored as sha256 hashes with a 12 hour expiry', async () => {
    const { t, userId } = await setup()
    const before = Date.now()
    const { token, expiresAt } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    assert.match(token, /^nt_[A-Za-z0-9_-]{43}$/)
    assert.ok(expiresAt >= before + 12 * HOUR && expiresAt <= Date.now() + 12 * HOUR)
    const row = await t.db.selectFrom('upload_tokens').selectAll().executeTakeFirstOrThrow()
    assert.match(row.hash, /^[0-9a-f]{64}$/)
    assert.notEqual(row.hash, token)
    assert.deepEqual(await verifyUploadToken(t.db, token), { tokenId: row.id, userId, projectId: 'p1', expiresAt })
  })

  it('verify returns null for unknown, expired and revoked tokens', async () => {
    const { t, userId } = await setup()
    assert.equal(await verifyUploadToken(t.db, 'nt_unknown'), null)
    const { token } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    await t.db.updateTable('upload_tokens').set({ expires_at: Date.now() - 1 }).execute()
    assert.equal(await verifyUploadToken(t.db, token), null)
    const fresh = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    assert.ok(await verifyUploadToken(t.db, fresh.token))
    await revokeUploadToken(t.db, fresh.token)
    assert.equal(await verifyUploadToken(t.db, fresh.token), null)
  })

  it('an upload token is rejected by GET /api/me', async () => {
    const { t, userId } = await setup()
    const { token } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    assert.equal((await t.app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status, 401)
  })
})

// A stand-in protected SDK route, wired the way real ones will be.
async function probe() {
  const ctx = await setup()
  const app = new Hono<UploadEnv>()
    .use('/probe', sdkPreflight(ctx.t), requireUploadToken(ctx.t), sdkOriginCheck(ctx.t))
    .post('/probe', (c) => c.json({ projectId: c.var.upload.projectId }))
  const { token } = await issueUploadToken(ctx.t.db, { userId: ctx.userId, projectId: 'p1' })
  const send = (headers: Record<string, string> = {}) => app.request('/probe', { method: 'POST', headers })
  return { ...ctx, send, token }
}

describe('requireUploadToken', () => {
  it('accepts a valid token and sets the context', async () => {
    const { send, token } = await probe()
    const res = await send({ authorization: `Bearer ${token}` })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { projectId: 'p1' })
  })

  it('rejects missing, malformed, unknown, expired and revoked tokens with 401', async () => {
    const { t, send, token, member } = await probe()
    for (const headers of [{}, { authorization: token }, { authorization: 'Bearer nope' }, { authorization: 'Bearer nt_unknown' }, { cookie: member.cookie }] as Record<string, string>[]) {
      const res = await send(headers)
      assert.equal(res.status, 401)
      assert.deepEqual(await res.json(), { error: 'unauthorized' })
    }
    await t.db.updateTable('upload_tokens').set({ expires_at: Date.now() - 1 }).execute()
    assert.equal((await send({ authorization: `Bearer ${token}` })).status, 401)
    await t.db.updateTable('upload_tokens').set({ expires_at: Date.now() + HOUR, revoked_at: Date.now() }).execute()
    assert.equal((await send({ authorization: `Bearer ${token}` })).status, 401)
  })
})

describe('SDK CORS', () => {
  it('answers a preflight for an origin allowed on any project', async () => {
    const { t } = await setup()
    for (const origin of [ORIGIN, 'https://blog.example.com']) {
      const res = await t.app.request('/api/sdk/token', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } })
      assert.equal(res.status, 204)
      assert.equal(res.headers.get('access-control-allow-origin'), origin)
      assert.equal(res.headers.get('access-control-allow-methods'), 'POST, DELETE')
      assert.equal(res.headers.get('access-control-allow-headers'), 'Authorization, Content-Type, Content-Encoding')
      assert.equal(res.headers.get('access-control-max-age'), '600')
      assert.equal(res.headers.get('vary'), 'Origin')
      assert.equal(res.headers.get('access-control-allow-credentials'), null)
    }
  })

  it('rejects a preflight from a foreign origin or without one', async () => {
    const { t } = await setup()
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      const res = await t.app.request('/api/sdk/token', { method: 'OPTIONS', headers })
      assert.equal(res.status, 403)
      assert.equal(res.headers.get('access-control-allow-origin'), null)
    }
  })

  it('adds CORS headers for an allowed origin on the actual request', async () => {
    const { send, token } = await probe()
    const res = await send({ authorization: `Bearer ${token}`, origin: ORIGIN })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal(res.headers.get('vary'), 'Origin')
    assert.equal(res.headers.get('access-control-allow-credentials'), null)
  })

  it('rejects a foreign origin, including another project\'s origin, with 403', async () => {
    const { send, token } = await probe()
    for (const origin of ['https://evil.example', 'https://blog.example.com', 'null']) {
      const res = await send({ authorization: `Bearer ${token}`, origin })
      assert.equal(res.status, 403)
      assert.deepEqual(await res.json(), { error: 'origin_not_allowed' })
      assert.equal(res.headers.get('access-control-allow-origin'), null)
    }
  })

  it('allows requests without an Origin header', async () => {
    const { send, token } = await probe()
    const res = await send({ authorization: `Bearer ${token}` })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})

describe('DELETE /api/sdk/token', () => {
  const del = (t: T, token: string | undefined, origin?: string) =>
    t.app.request('/api/sdk/token', {
      method: 'DELETE',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    })

  it('revokes the token, idempotently', async () => {
    const { t, userId } = await setup()
    const { token } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    assert.equal((await del(t, token)).status, 204)
    assert.equal(await verifyUploadToken(t.db, token), null)
    const first = await t.db.selectFrom('upload_tokens').select('revoked_at').executeTakeFirstOrThrow()
    assert.ok(first.revoked_at)
    assert.equal((await del(t, token)).status, 204)
    const second = await t.db.selectFrom('upload_tokens').select('revoked_at').executeTakeFirstOrThrow()
    assert.equal(second.revoked_at, first.revoked_at)
  })

  it('returns 204 for an unknown or expired token and 401 without a header', async () => {
    const { t, userId } = await setup()
    assert.equal((await del(t, 'nt_unknown')).status, 204)
    const { token } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    await t.db.updateTable('upload_tokens').set({ expires_at: Date.now() - 1 }).execute()
    assert.equal((await del(t, token)).status, 204)
    assert.equal((await del(t, undefined)).status, 401)
  })

  it('applies CORS: allowed origin gets headers, foreign origin gets 403 and the token survives', async () => {
    const { t, userId } = await setup()
    const { token } = await issueUploadToken(t.db, { userId, projectId: 'p1' })
    const bad = await del(t, token, 'https://evil.example')
    assert.equal(bad.status, 403)
    assert.ok(await verifyUploadToken(t.db, token))
    const ok = await del(t, token, ORIGIN)
    assert.equal(ok.status, 204)
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal(await verifyUploadToken(t.db, token), null)
  })
})

describe('GET /sdk/sign-in', () => {
  it('redirects to login with returnTo when there is no session', async () => {
    const { t } = await setup()
    const res = await t.app.request(signInUrl())
    assert.equal(res.status, 302)
    const location = new URL(res.headers.get('location') ?? '', 'http://x')
    assert.equal(location.pathname, '/auth/login')
    assert.equal(location.searchParams.get('returnTo'), signInUrl())
    assert.equal(await tokenCount(t), 0)
  })

  it('renders a 404 page for an unknown key', async () => {
    const { t, member } = await setup()
    const res = await t.app.request(signInUrl('pk_nope'), { headers: { cookie: member.cookie } })
    assert.equal(res.status, 404)
    assert.equal(await tokenCount(t), 0)
  })

  it('rejects a disallowed origin with 403, naming it, with no token and no postMessage', async () => {
    const { t, member } = await setup()
    const res = await t.app.request(signInUrl('pk_1', 'https://evil.example'), { headers: { cookie: member.cookie } })
    assert.equal(res.status, 403)
    const body = await res.text()
    assert.match(body, /https:\/\/evil\.example/)
    assert.doesNotMatch(body, /postMessage|<script/)
    assert.equal(await tokenCount(t), 0)
  })

  it('escapes the rejected origin in the page', async () => {
    const { t, member } = await setup()
    const res = await t.app.request(signInUrl('pk_1', '<img src=x onerror=alert(1)>'), { headers: { cookie: member.cookie } })
    assert.equal(res.status, 403)
    assert.doesNotMatch(await res.text(), /<img/)
  })

  it('tells a non-member and posts not_member to the allowed origin only', async () => {
    const { t } = await setup()
    const other = await signIn(t, { email: 'other@example.com' })
    const res = await t.app.request(signInUrl(), { headers: { cookie: other.cookie } })
    assert.equal(res.status, 403)
    const body = await res.text()
    assert.match(body, /nooted:sign-in-error/)
    assert.match(body, /not_member/)
    assert.ok(body.includes(`"${ORIGIN}"`))
    assert.equal(await tokenCount(t), 0)
  })

  it('serves the success page with a nonce, strict headers and no token', async () => {
    const { t, member } = await setup()
    const res = await t.app.request(signInUrl(), { headers: { cookie: member.cookie } })
    assert.equal(res.status, 200)
    const csp = res.headers.get('content-security-policy') ?? ''
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1]
    assert.ok(nonce)
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /connect-src 'self'/)
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const body = await res.text()
    assert.ok(body.includes(`<script nonce="${nonce}">`))
    assert.match(body, /window\.opener/)
    assert.doesNotMatch(body, /nt_/)
    assert.equal(await tokenCount(t), 0)
  })
})

describe('POST /sdk/sign-in/token', () => {
  it('issues a token to a member', async () => {
    const { t, member, userId } = await setup()
    const before = Date.now()
    const res = await postToken(t, member.cookie, { 'x-nooted-sign-in': '1', origin: 'http://localhost:5173' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const body = (await res.json()) as { token: string; expiresAt: number; user: unknown }
    assert.match(body.token, /^nt_/)
    assert.ok(body.expiresAt >= before + 12 * HOUR && body.expiresAt <= Date.now() + 12 * HOUR)
    assert.deepEqual(body.user, { name: 'Dev', email: 'dev@example.com' })
    assert.deepEqual((await verifyUploadToken(t.db, body.token))?.userId, userId)
  })

  it('requires the custom header', async () => {
    const { t, member } = await setup()
    assert.equal((await postToken(t, member.cookie, {})).status, 403)
    assert.equal(await tokenCount(t), 0)
  })

  it('rejects a foreign Origin header', async () => {
    const { t, member } = await setup()
    assert.equal((await postToken(t, member.cookie, { 'x-nooted-sign-in': '1', origin: ORIGIN })).status, 403)
    assert.equal(await tokenCount(t), 0)
  })

  it('rejects requests without a session', async () => {
    const { t } = await setup()
    assert.equal((await postToken(t, 'nooted_session=nope')).status, 401)
  })

  it('rejects unknown keys and disallowed origins', async () => {
    const { t, member } = await setup()
    assert.equal((await postToken(t, member.cookie, undefined, { key: 'pk_nope', origin: ORIGIN })).status, 404)
    assert.equal((await postToken(t, member.cookie, undefined, { key: 'pk_1', origin: 'https://evil.example' })).status, 403)
    assert.equal(await tokenCount(t), 0)
  })

  it('rejects a non-member', async () => {
    const { t } = await setup()
    const other = await signIn(t, { email: 'other@example.com' })
    const res = await postToken(t, other.cookie)
    assert.equal(res.status, 403)
    assert.equal(await tokenCount(t), 0)
  })

  it('lets an admin who is not a member in', async () => {
    const { t } = await setup()
    const admin = await signIn(t, { email: 'admin@example.com' })
    const res = await postToken(t, admin.cookie)
    assert.equal(res.status, 200)
    assert.equal(await tokenCount(t), 1)
  })
})

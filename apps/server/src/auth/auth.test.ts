import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestApp } from '../test-helpers.ts'
import { hashSessionId } from './sessions.ts'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

function cookieFrom(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(';')[0] ?? ''
    const [key, value] = pair.split('=')
    if (key === name) return value
  }
  return undefined
}

function setCookieHeader(res: Response, name: string): string {
  const header = res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`))
  assert.ok(header, `expected Set-Cookie for ${name}`)
  return header
}

async function startLogin(t: TestApp, returnTo?: string) {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`
  const res = await t.app.request(`/auth/login${query}`)
  const location = new URL(res.headers.get('location') ?? '')
  return { res, location, loginCookie: cookieFrom(res, 'nooted_login') }
}

async function callback(t: TestApp, loginCookie: string | undefined, state: string | null) {
  const headers: Record<string, string> = loginCookie ? { cookie: `nooted_login=${loginCookie}` } : {}
  return t.app.request(`/auth/callback?code=abc&state=${state ?? ''}`, { headers })
}

// Runs the whole flow and returns the callback response plus the session cookie.
async function signIn(t: TestApp, returnTo?: string) {
  const { location, loginCookie } = await startLogin(t, returnTo)
  const res = await callback(t, loginCookie, location.searchParams.get('state'))
  return { res, session: cookieFrom(res, 'nooted_session') }
}

function one<T>(rows: T[]): T {
  assert.equal(rows.length, 1)
  return rows[0] as T
}

const me = (t: TestApp, headers: Record<string, string> = {}) => t.app.request('/api/me', { headers })
const withSession = (session: string | undefined) => ({ cookie: `nooted_session=${session}` })

describe('OIDC sign-in', () => {
  it('signs in, sets the session cookie and redirects to returnTo', async () => {
    const t = await createTestApp()
    const { location, loginCookie, res: loginRes } = await startLogin(t, '/projects')
    assert.equal(loginRes.status, 302)
    assert.equal(location.origin + location.pathname, 'http://oidc.test/authorize')
    assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:5173/auth/callback')
    assert.ok(location.searchParams.get('code_challenge'))
    const loginHeader = setCookieHeader(loginRes, 'nooted_login')
    assert.match(loginHeader, /HttpOnly/i)
    assert.match(loginHeader, /SameSite=Lax/i)
    assert.match(loginHeader, /Path=\/auth/)

    const res = await callback(t, loginCookie, location.searchParams.get('state'))
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/projects')
    const sessionHeader = setCookieHeader(res, 'nooted_session')
    assert.match(sessionHeader, /HttpOnly/i)
    assert.match(sessionHeader, /SameSite=Lax/i)
    assert.match(sessionHeader, /Path=\//)
    assert.doesNotMatch(sessionHeader, /Secure/i)
    assert.equal((await me(t, withSession(cookieFrom(res, 'nooted_session')))).status, 200)
    await t.db.destroy()
  })

  it('marks cookies Secure when the public URL is https', async () => {
    const t = await createTestApp({ config: { publicUrl: 'https://nooted.example' } })
    const { res, loginCookie, location } = await startLogin(t)
    assert.match(setCookieHeader(res, 'nooted_login'), /Secure/i)
    const cb = await callback(t, loginCookie, location.searchParams.get('state'))
    assert.match(setCookieHeader(cb, 'nooted_session'), /Secure/i)
    await t.db.destroy()
  })

  it('stores only a hash of the session id, with a 7 day expiry', async () => {
    const t = await createTestApp()
    const before = Date.now()
    const { session } = await signIn(t)
    assert.ok(session)
    const rows = await t.db.selectFrom('sessions').selectAll().execute()
    const row = one(rows)
    assert.equal(row.id_hash, hashSessionId(session))
    assert.notEqual(row.id_hash, session)
    const week = 7 * 24 * 60 * 60 * 1000
    assert.ok(row.expires_at >= before + week && row.expires_at <= Date.now() + week)
    await t.db.destroy()
  })

  it('rejects a state mismatch with 400 and creates no session', async () => {
    const t = await createTestApp()
    const { loginCookie } = await startLogin(t)
    const res = await callback(t, loginCookie, 'wrong-state')
    assert.equal(res.status, 400)
    assert.equal(cookieFrom(res, 'nooted_session'), undefined)
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 0)
    assert.equal((await t.db.selectFrom('users').selectAll().execute()).length, 0)
    await t.db.destroy()
  })

  it('rejects a callback without a login cookie', async () => {
    const t = await createTestApp()
    const { location } = await startLogin(t)
    const res = await callback(t, undefined, location.searchParams.get('state'))
    assert.equal(res.status, 400)
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 0)
    await t.db.destroy()
  })

  it('rejects an expired login attempt', async () => {
    const t = await createTestApp()
    const { location, loginCookie } = await startLogin(t)
    await t.db.updateTable('login_attempts').set({ expires_at: Date.now() - 1 }).execute()
    const res = await callback(t, loginCookie, location.searchParams.get('state'))
    assert.equal(res.status, 400)
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 0)
    await t.db.destroy()
  })

  it('rejects a replayed callback', async () => {
    const t = await createTestApp()
    const { location, loginCookie } = await startLogin(t)
    const state = location.searchParams.get('state')
    assert.equal((await callback(t, loginCookie, state)).status, 302)
    const replay = await callback(t, loginCookie, state)
    assert.equal(replay.status, 400)
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 1)
    await t.db.destroy()
  })

  for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', 'projects']) {
    it(`ignores unsafe returnTo ${unsafe}`, async () => {
      const t = await createTestApp()
      const { res } = await signIn(t, unsafe)
      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), '/')
      await t.db.destroy()
    })
  }

  it('defaults returnTo to /', async () => {
    const t = await createTestApp()
    const { res } = await signIn(t)
    assert.equal(res.headers.get('location'), '/')
    await t.db.destroy()
  })
})

describe('user provisioning', () => {
  it('creates a user on first sign-in', async () => {
    const t = await createTestApp()
    await signIn(t)
    const user = { ...one(await t.db.selectFrom('users').selectAll().execute()) }
    assert.equal(user.issuer, 'http://oidc.test')
    assert.equal(user.subject, 'user-1')
    assert.equal(user.email, 'user@example.com')
    assert.equal(user.name, 'Test User')
    await t.db.destroy()
  })

  it('updates email and name but keeps the same user and memberships', async () => {
    const t = await createTestApp()
    await signIn(t)
    const first = one(await t.db.selectFrom('users').selectAll().execute())
    await t.db.insertInto('projects').values({ id: 'p1', name: 'Shop', public_key: 'pk_1', retention_days: 90, created_at: 1 }).execute()
    await t.db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'user@example.com', user_id: first.id }).execute()

    t.oidc.identity.email = 'renamed@example.com'
    t.oidc.identity.name = 'New Name'
    const { session } = await signIn(t)

    const user = one(await t.db.selectFrom('users').selectAll().execute())
    assert.equal(user.id, first.id)
    assert.equal(user.email, 'renamed@example.com')
    assert.equal(user.name, 'New Name')
    const members = await t.db.selectFrom('project_members').selectAll().execute()
    assert.deepEqual(members.map((m) => ({ ...m })), [{ project_id: 'p1', email_lower: 'user@example.com', user_id: first.id }])
    const body = await (await me(t, withSession(session))).json()
    assert.equal(body.id, first.id)
    assert.equal(body.email, 'renamed@example.com')
    await t.db.destroy()
  })

  it('links pending memberships case-insensitively for a verified email', async () => {
    const t = await createTestApp({ identity: { email: 'New@Example.com' } })
    await t.db.insertInto('projects').values({ id: 'p1', name: 'Shop', public_key: 'pk_1', retention_days: 90, created_at: 1 }).execute()
    await t.db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'new@example.com', user_id: null }).execute()
    await signIn(t)
    const user = one(await t.db.selectFrom('users').selectAll().execute())
    const member = one(await t.db.selectFrom('project_members').selectAll().execute())
    assert.equal(member.user_id, user.id)
    await t.db.destroy()
  })

  it('does not link pending memberships for an unverified email', async () => {
    const t = await createTestApp({ identity: { email: 'new@example.com', emailVerified: false } })
    await t.db.insertInto('projects').values({ id: 'p1', name: 'Shop', public_key: 'pk_1', retention_days: 90, created_at: 1 }).execute()
    await t.db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'new@example.com', user_id: null }).execute()
    await signIn(t)
    const member = one(await t.db.selectFrom('project_members').selectAll().execute())
    assert.equal(member.user_id, null)
    await t.db.destroy()
  })
})

describe('instance admins', () => {
  it('is admin when the verified email is in the configured list', async () => {
    const t = await createTestApp({ identity: { email: 'Admin@Example.com' } })
    const { session } = await signIn(t)
    assert.equal((await (await me(t, withSession(session))).json()).isAdmin, true)
    await t.db.destroy()
  })

  it('is not admin when the email is not in the list', async () => {
    const t = await createTestApp()
    const { session } = await signIn(t)
    assert.equal((await (await me(t, withSession(session))).json()).isAdmin, false)
    await t.db.destroy()
  })

  it('is no longer admin once removed from the configuration', async () => {
    const t = await createTestApp({ identity: { email: 'admin@example.com' } })
    const { session } = await signIn(t)
    assert.equal((await (await me(t, withSession(session))).json()).isAdmin, true)

    t.config.adminEmails = []
    const second = await signIn(t)
    assert.equal((await (await me(t, withSession(second.session))).json()).isAdmin, false)
    await t.db.destroy()
  })

  it('is not admin with an unverified email', async () => {
    const t = await createTestApp({ identity: { email: 'admin@example.com', emailVerified: false } })
    const { session } = await signIn(t)
    assert.equal((await (await me(t, withSession(session))).json()).isAdmin, false)
    await t.db.destroy()
  })
})

describe('sessions and API', () => {
  it('GET /api/me returns the current user for a valid session', async () => {
    const t = await createTestApp()
    const { session } = await signIn(t)
    const res = await me(t, withSession(session))
    assert.equal(res.status, 200)
    const user = one(await t.db.selectFrom('users').selectAll().execute())
    assert.deepEqual(await res.json(), { id: user.id, email: 'user@example.com', name: 'Test User', isAdmin: false })
    await t.db.destroy()
  })

  it('rejects an expired session with 401 and deletes it', async () => {
    const t = await createTestApp()
    const { session } = await signIn(t)
    await t.db.updateTable('sessions').set({ expires_at: Date.now() - 1000 }).execute()
    const res = await me(t, withSession(session))
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'unauthorized' })
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 0)
    await t.db.destroy()
  })

  it('rejects anonymous requests with 401', async () => {
    const t = await createTestApp()
    const res = await me(t)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'unauthorized' })
    await t.db.destroy()
  })

  it('rejects an unknown session cookie', async () => {
    const t = await createTestApp()
    assert.equal((await me(t, withSession('nope'))).status, 401)
    await t.db.destroy()
  })

  it('ignores bearer tokens without a session cookie', async () => {
    const t = await createTestApp()
    const { session } = await signIn(t)
    const res = await me(t, { authorization: `Bearer ${session}` })
    assert.equal(res.status, 401)
    await t.db.destroy()
  })

  it('does not send CORS headers on the console API', async () => {
    const t = await createTestApp()
    const res = await t.app.request('/api/health', { headers: { origin: 'http://other.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
    await t.db.destroy()
  })

  it('logout deletes the session and clears the cookie', async () => {
    const t = await createTestApp()
    const { session } = await signIn(t)
    const res = await t.app.request('/auth/logout', { method: 'POST', headers: withSession(session) })
    assert.equal(res.status, 204)
    assert.match(setCookieHeader(res, 'nooted_session'), /Max-Age=0|Expires=/i)
    assert.equal((await t.db.selectFrom('sessions').selectAll().execute()).length, 0)
    assert.equal((await me(t, withSession(session))).status, 401)
    await t.db.destroy()
  })
})

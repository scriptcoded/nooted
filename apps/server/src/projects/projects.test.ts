import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestApp, signIn } from '../test-helpers.ts'

type T = Awaited<ReturnType<typeof createTestApp>>

const json = (cookie: string, body?: unknown) => ({
  headers: { cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const call = (t: T, method: string, path: string, cookie: string, body?: unknown) =>
  t.app.request(`/api/projects${path}`, { method, ...json(cookie, body) })

async function setup() {
  const t = await createTestApp()
  const admin = (await signIn(t, { email: 'admin@example.com' })).cookie
  const create = async (name: string) => (await (await call(t, 'POST', '', admin, { name })).json()) as { id: string; publicKey: string }
  return { t, admin, create }
}

async function insertToken(t: T, userId: string, projectId: string, id: string) {
  await t.db
    .insertInto('upload_tokens')
    .values({ id, hash: `hash-${id}`, user_id: userId, project_id: projectId, expires_at: Date.now() + 1e6, revoked_at: null, created_at: Date.now() })
    .execute()
}

describe('projects', () => {
  it('requires a session', async () => {
    const { t } = await setup()
    assert.equal((await t.app.request('/api/projects')).status, 401)
  })

  it('admin creates a project with a generated public key and default retention', async () => {
    const { t, admin } = await setup()
    const res = await call(t, 'POST', '', admin, { name: 'Shop' })
    assert.equal(res.status, 201)
    const p = (await res.json()) as { id: string; name: string; publicKey: string; retentionDays: number | null }
    assert.equal(p.name, 'Shop')
    assert.match(p.publicKey, /^pk_[A-Za-z0-9_-]{22}$/)
    assert.equal(p.retentionDays, 90)
    const other = await (await call(t, 'POST', '', admin, { name: 'Blog' })).json()
    assert.notEqual((other as { publicKey: string }).publicKey, p.publicKey)
  })

  it('rejects invalid bodies with 400', async () => {
    const { t, admin } = await setup()
    const res = await call(t, 'POST', '', admin, { name: '' })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    assert.equal(body.error, 'invalid_request')
    assert.ok(body.issues.length > 0)
  })

  it('non-admin cannot create', async () => {
    const { t } = await setup()
    const user = (await signIn(t, { email: 'dev@example.com' })).cookie
    assert.equal((await call(t, 'POST', '', user, { name: 'Shop' })).status, 403)
    const unverified = (await signIn(t, { email: 'admin@example.com', subject: 'other', emailVerified: false })).cookie
    assert.equal((await call(t, 'POST', '', unverified, { name: 'Shop' })).status, 403)
  })

  it('stores and normalizes valid origins; adding twice is a no-op', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    let res = await call(t, 'POST', `/${id}/origins`, admin, { origin: 'https://shop.example.com/' })
    assert.equal(res.status, 200)
    assert.deepEqual(((await res.json()) as { origins: string[] }).origins, ['https://shop.example.com'])
    res = await call(t, 'POST', `/${id}/origins`, admin, { origin: 'https://SHOP.example.com' })
    assert.equal(res.status, 200)
    await call(t, 'POST', `/${id}/origins`, admin, { origin: 'http://localhost:5174' })
    const detail = (await (await call(t, 'GET', `/${id}`, admin)).json()) as { origins: string[] }
    assert.deepEqual(detail.origins, ['http://localhost:5174', 'https://shop.example.com'])
  })

  it('rejects invalid origins with 400 and leaves the list unchanged', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    await call(t, 'POST', `/${id}/origins`, admin, { origin: 'https://shop.example.com' })
    for (const origin of ['shop.example.com/*', 'https://a.com/path', 'ftp://x.com']) {
      assert.equal((await call(t, 'POST', `/${id}/origins`, admin, { origin })).status, 400, origin)
    }
    const detail = (await (await call(t, 'GET', `/${id}`, admin)).json()) as { origins: string[] }
    assert.deepEqual(detail.origins, ['https://shop.example.com'])
  })

  it('removes origins', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    await call(t, 'POST', `/${id}/origins`, admin, { origin: 'https://a.com' })
    const res = await call(t, 'DELETE', `/${id}/origins`, admin, { origin: 'https://a.com/' })
    assert.deepEqual(((await res.json()) as { origins: string[] }).origins, [])
  })

  it('adding an existing user as member lets them see the project', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    const dev = (await signIn(t, { email: 'Dev@Example.com' })).cookie
    assert.equal((await call(t, 'GET', `/${id}`, dev)).status, 404)
    const res = await call(t, 'POST', `/${id}/members`, admin, { email: ' dev@example.com ' })
    assert.equal(res.status, 200)
    const members = ((await res.json()) as { members: { email: string; pending: boolean; userId: string | null }[] }).members
    assert.equal(members.length, 1)
    assert.equal(members[0]?.pending, false)
    // idempotent
    await call(t, 'POST', `/${id}/members`, admin, { email: 'DEV@example.com' })
    assert.equal((await t.db.selectFrom('project_members').selectAll().execute()).length, 1)
    const detail = await call(t, 'GET', `/${id}`, dev)
    assert.equal(detail.status, 200)
    assert.equal(((await detail.json()) as { canManage: boolean }).canManage, false)
  })

  it('membership added before first sign-in takes effect on sign-in', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    const res = await call(t, 'POST', `/${id}/members`, admin, { email: 'New@Example.com' })
    const members = ((await res.json()) as { members: { email: string; pending: boolean }[] }).members
    assert.deepEqual(members.map((m) => [m.email, m.pending]), [['new@example.com', true]])
    const user = (await signIn(t, { email: 'new@example.com' })).cookie
    const list = (await (await call(t, 'GET', '', user)).json()) as { id: string }[]
    assert.deepEqual(list.map((p) => p.id), [id])
  })

  it('does not link an unverified email to a pending membership', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    await call(t, 'POST', `/${id}/members`, admin, { email: 'x@example.com' })
    const user = (await signIn(t, { email: 'x@example.com', emailVerified: false })).cookie
    assert.equal((await call(t, 'GET', `/${id}`, user)).status, 404)
  })

  it('removing a member hides the project and revokes only that project\'s tokens', async () => {
    const { t, admin, create } = await setup()
    const shop = await create('Shop')
    const blog = await create('Blog')
    const dev = (await signIn(t, { email: 'dev@example.com' })).cookie
    const devId = (await t.db.selectFrom('users').select('id').where('email', '=', 'dev@example.com').executeTakeFirstOrThrow()).id
    await call(t, 'POST', `/${shop.id}/members`, admin, { email: 'dev@example.com' })
    await call(t, 'POST', `/${blog.id}/members`, admin, { email: 'dev@example.com' })
    await insertToken(t, devId, shop.id, 'tok-shop')
    await insertToken(t, devId, blog.id, 'tok-blog')

    const res = await call(t, 'DELETE', `/${shop.id}/members`, admin, { email: 'DEV@example.com' })
    assert.equal(res.status, 200)
    assert.equal((await call(t, 'GET', `/${shop.id}`, dev)).status, 404)
    assert.equal((await call(t, 'GET', `/${blog.id}`, dev)).status, 200)
    const tokens = await t.db.selectFrom('upload_tokens').select(['id', 'revoked_at']).execute()
    const revoked = Object.fromEntries(tokens.map((x) => [x.id, x.revoked_at !== null]))
    assert.deepEqual(revoked, { 'tok-shop': true, 'tok-blog': false })
  })

  it('member and admin mutations are admin only', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    await call(t, 'POST', `/${id}/members`, admin, { email: 'dev@example.com' })
    const dev = (await signIn(t, { email: 'dev@example.com' })).cookie
    const stranger = (await signIn(t, { email: 'stranger@example.com' })).cookie
    const attempts: [string, string, unknown][] = [
      ['PATCH', `/${id}`, { name: 'X' }],
      ['DELETE', `/${id}`, undefined],
      ['POST', `/${id}/origins`, { origin: 'https://a.com' }],
      ['DELETE', `/${id}/origins`, { origin: 'https://a.com' }],
      ['POST', `/${id}/members`, { email: 'a@b.co' }],
      ['DELETE', `/${id}/members`, { email: 'dev@example.com' }],
    ]
    for (const [method, path, body] of attempts) {
      assert.equal((await call(t, method, path, dev, body)).status, 403, `member ${method} ${path}`)
      assert.equal((await call(t, method, path, stranger, body)).status, 404, `stranger ${method} ${path}`)
    }
    assert.equal((await t.db.selectFrom('projects').select('name').executeTakeFirstOrThrow()).name, 'Shop')
  })

  it('members list only their own projects; admins see all', async () => {
    const { t, admin, create } = await setup()
    const shop = await create('Shop')
    await create('Blog')
    await call(t, 'POST', `/${shop.id}/members`, admin, { email: 'dev@example.com' })
    const dev = (await signIn(t, { email: 'dev@example.com' })).cookie
    const mine = (await (await call(t, 'GET', '', dev)).json()) as { name: string; publicKey: string; retentionDays: number }[]
    assert.deepEqual(mine.map((p) => p.name), ['Shop'])
    assert.equal(mine[0]?.publicKey, shop.publicKey)
    const all = (await (await call(t, 'GET', '', admin)).json()) as unknown[]
    assert.equal(all.length, 2)
  })

  it('returns 404 for a hidden project', async () => {
    const { t, create } = await setup()
    const { id } = await create('Shop')
    const stranger = (await signIn(t, { email: 'stranger@example.com' })).cookie
    assert.equal((await call(t, 'GET', `/${id}`, stranger)).status, 404)
    assert.equal((await call(t, 'GET', '/nope', stranger)).status, 404)
  })

  it('updates name and retention, including unlimited', async () => {
    const { t, admin, create } = await setup()
    const { id } = await create('Shop')
    let res = await call(t, 'PATCH', `/${id}`, admin, { retentionDays: 30, name: 'Shop 2' })
    let body = (await res.json()) as { name: string; retentionDays: number | null }
    assert.deepEqual([body.name, body.retentionDays], ['Shop 2', 30])
    res = await call(t, 'PATCH', `/${id}`, admin, { retentionDays: null })
    body = (await res.json()) as { name: string; retentionDays: number | null }
    assert.deepEqual([body.name, body.retentionDays], ['Shop 2', null])
    assert.equal((await t.db.selectFrom('projects').select('retention_days').executeTakeFirstOrThrow()).retention_days, null)
    for (const retentionDays of [0, -1, 1.5, 'x']) {
      assert.equal((await call(t, 'PATCH', `/${id}`, admin, { retentionDays })).status, 400, String(retentionDays))
    }
  })

  it('deleting a project removes items, tokens, members, origins and blobs', async () => {
    const { t, admin, create } = await setup()
    const shop = await create('Shop')
    const blog = await create('Blog')
    const devId = (await t.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id
    await call(t, 'POST', `/${shop.id}/origins`, admin, { origin: 'https://a.com' })
    await call(t, 'POST', `/${shop.id}/members`, admin, { email: 'admin@example.com' })
    await insertToken(t, devId, shop.id, 'tok-shop')
    await insertToken(t, devId, blog.id, 'tok-blog')
    const blobKey = `projects/${shop.id}/reports/i1.json.gz`
    const otherKey = `projects/${blog.id}/reports/i2.json.gz`
    await t.blobs.put(blobKey, new Uint8Array([1]))
    await t.blobs.put(otherKey, new Uint8Array([2]))
    await t.db
      .insertInto('feedback_items')
      .values({ id: 'i1', project_id: shop.id, client_report_id: 'c1', reporter_id: devId, note: 'n', url: 'https://a.com', captured_at: 1, blob_key: blobKey, created_at: 1 })
      .execute()

    assert.equal((await call(t, 'DELETE', `/${shop.id}`, admin)).status, 204)
    assert.equal((await call(t, 'GET', `/${shop.id}`, admin)).status, 404)
    assert.equal((await t.db.selectFrom('feedback_items').selectAll().execute()).length, 0)
    assert.deepEqual((await t.db.selectFrom('upload_tokens').select('id').execute()).map((x) => x.id), ['tok-blog'])
    assert.equal((await t.db.selectFrom('project_origins').selectAll().execute()).length, 0)
    assert.equal((await t.db.selectFrom('project_members').selectAll().execute()).length, 0)
    assert.equal(await t.blobs.get(blobKey), null)
    assert.notEqual(await t.blobs.get(otherKey), null)
  })
})

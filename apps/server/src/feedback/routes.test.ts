import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { hc } from 'hono/client'
import type { AppType } from '../app.ts'
import { issueUploadToken } from '../sdk/tokens.ts'
import { createTestApp, signIn } from '../test-helpers.ts'
import { createFeedbackRepo } from './repo.ts'
import { createReportStore } from './report-store.ts'

const events = (n: number) => [
  { type: 4, timestamp: 1000 * n, data: { href: 'https://shop.example.com/cart' } },
  { type: 2, timestamp: 1000 * n + 250, data: { marker: n } },
  { type: 3, timestamp: 1000 * n + 4000, data: {} },
]

const capture = (n: number, overrides: Record<string, unknown> = {}) => ({
  n,
  url: 'https://shop.example.com/cart',
  capturedAt: 1_700_000_000_000,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
  demo: false,
  events: events(n),
  marks: [{ nodeId: 5, tag: 'button', text: 'Pay', selector: '#pay', rect: { x: 1, y: 2, width: 3, height: 4 } }],
  ...overrides,
})

const device = { userAgent: 'test', viewport: { width: 800, height: 600, devicePixelRatio: 2 } }

const payload = (overrides: Record<string, unknown> = {}) => ({
  clientReportId: randomUUID(),
  note: 'Look at [1] and [2]',
  url: 'https://shop.example.com/cart',
  capturedAt: 1_700_000_000_000,
  release: 'v1',
  device,
  captures: [capture(1), capture(2)],
  ...overrides,
})
const gz = (body: unknown) => gzipSync(Buffer.from(JSON.stringify(body)))

async function setup() {
  const t = await createTestApp()
  const now = Date.now()
  for (const id of ['p1', 'p2']) {
    await t.db.insertInto('projects').values({ id, name: id, public_key: `pk_${id}`, retention_days: 90, created_at: now }).execute()
  }
  await t.db.insertInto('project_origins').values({ project_id: 'p1', origin: 'https://shop.example.com' }).execute()
  const member = await signIn(t, { email: 'dev@example.com', name: 'Dev' })
  const userId = (await t.db.selectFrom('users').select('id').where('email', '=', 'dev@example.com').executeTakeFirstOrThrow()).id
  for (const p of ['p1', 'p2']) {
    await t.db.insertInto('project_members').values({ project_id: p, email_lower: 'dev@example.com', user_id: userId }).execute()
  }
  const upload = async (body: unknown, projectId = 'p1') => {
    const { token } = await issueUploadToken(t.db, { userId, projectId })
    const res = await t.app.request('/api/sdk/reports', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-encoding': 'gzip', 'content-type': 'application/json' },
      body: new Uint8Array(gz(body)),
    })
    assert.equal(res.status, 201)
    return ((await res.json()) as { id: string }).id
  }
  const get = (path: string, cookie: string | null = member.cookie, headers: Record<string, string> = {}) =>
    t.app.request(`/api/projects${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } })
  return { t, member, userId, upload, get }
}

describe('GET /api/projects/:id/feedback/:itemId', () => {
  it('returns the detail without any events', async () => {
    const { upload, get } = await setup()
    const id = await upload(payload())
    const res = await get(`/p1/feedback/${id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'private, no-cache')
    const text = await res.text()
    assert.ok(!text.includes('events') && !text.includes('marker') && !text.includes('blob'))
    const body = JSON.parse(text)
    assert.equal(body.id, id)
    assert.equal(body.note, 'Look at [1] and [2]')
    assert.equal(body.status, 'new')
    assert.equal(body.release, 'v1')
    assert.equal(body.legacy, false)
    assert.deepEqual(body.device, device)
    assert.deepEqual(body.reporter, { id: body.reporter.id, name: 'Dev', email: 'dev@example.com' })
    assert.equal(body.captures.length, 2)
    assert.deepEqual(Object.keys(body.captures[0]).sort(), ['capturedAt', 'demo', 'durationMs', 'marks', 'n', 'scroll', 'url', 'viewport'])
    assert.equal(body.captures[0].n, 1)
    assert.equal(body.captures[0].durationMs, 4000)
    assert.equal(body.captures[0].marks[0].selector, '#pay')
  })

  it('answers 304 for a matching If-None-Match and a new ETag after a status change', async () => {
    const { t, upload, get } = await setup()
    const id = await upload(payload())
    const first = await get(`/p1/feedback/${id}`)
    const etag = first.headers.get('etag')
    assert.ok(etag)
    const again = await get(`/p1/feedback/${id}`, undefined, { 'if-none-match': etag })
    assert.equal(again.status, 304)
    assert.equal(await again.text(), '')
    await t.db.updateTable('feedback_items').set({ status: 'done' }).where('id', '=', id).execute()
    const changed = await get(`/p1/feedback/${id}`, undefined, { 'if-none-match': etag })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.get('etag'), etag)
  })

  it('serves a pre-capture report as legacy', async () => {
    const { t, userId, get } = await setup()
    const blob = gz({
      clientReportId: randomUUID(), note: 'old note', url: 'https://shop.example.com/x', capturedAt: 1_600_000_000_000,
      device, events: events(1), focus: { x: 1 },
    })
    await t.blobs.put('projects/p1/reports/old.json.gz', blob)
    await t.db
      .insertInto('feedback_items')
      .values({
        id: 'old', project_id: 'p1', client_report_id: 'c-old', reporter_id: userId, note: 'old note',
        url: 'https://shop.example.com/x', captured_at: 1_600_000_000_000, release: null,
        blob_key: 'projects/p1/reports/old.json.gz', created_at: 1,
      })
      .execute()
    const res = await get('/p1/feedback/old')
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.ok(!text.includes('events'))
    const body = JSON.parse(text)
    assert.equal(body.legacy, true)
    assert.deepEqual(body.captures, [])
    assert.equal(body.note, 'old note')
    assert.equal(body.url, 'https://shop.example.com/x')
    assert.deepEqual(body.device, device)
    assert.equal((await get('/p1/feedback/old/captures/1/events')).status, 404)
  })

  it('answers 500 when the blob is missing', async () => {
    const { t, upload, get } = await setup()
    const id = await upload(payload())
    const row = await t.db.selectFrom('feedback_items').select('blob_key').where('id', '=', id).executeTakeFirstOrThrow()
    await t.blobs.delete(row.blob_key)
    assert.equal((await get(`/p1/feedback/${id}`)).status, 500)
  })

  it('404s for non-members, other projects, unknown items, unknown projects; 401 without session', async () => {
    const { t, upload, get } = await setup()
    const id = await upload(payload())
    const other = await signIn(t, { email: 'other@example.com', name: 'Other' })
    assert.equal((await get(`/p1/feedback/${id}`, other.cookie)).status, 404)
    assert.equal((await get(`/p2/feedback/${id}`)).status, 404)
    assert.equal((await get('/p1/feedback/nope')).status, 404)
    assert.equal((await get(`/nope/feedback/${id}`)).status, 404)
    assert.deepEqual(await (await get('/p1/feedback/nope')).json(), { error: 'not_found' })
    assert.equal((await get(`/p1/feedback/${id}`, null)).status, 401)
    assert.equal((await get(`/p1/feedback/${id}/captures/1/events`, other.cookie)).status, 404)
  })

  it('is typed on the hc client', () => {
    const client = hc<AppType>('http://localhost')
    assert.equal(typeof client.api.projects[':id'].feedback[':itemId'].$get, 'function')
    assert.equal(typeof client.api.projects[':id'].feedback[':itemId'].captures[':n'].events.$get, 'function')
  })
})

describe('GET /api/projects/:id/feedback/:itemId/captures/:n/events', () => {
  it('returns exactly that capture\'s events, immutable', async () => {
    const { upload, get } = await setup()
    const id = await upload(payload())
    const res = await get(`/p1/feedback/${id}/captures/2/events`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'private, max-age=31536000, immutable')
    assert.deepEqual(await res.json(), events(2))
  })

  it('404s for unknown or invalid capture numbers', async () => {
    const { upload, get } = await setup()
    const id = await upload(payload())
    for (const n of ['3', '0', '11', '-1', '1.5', 'abc']) {
      assert.equal((await get(`/p1/feedback/${id}/captures/${n}/events`)).status, 404, n)
    }
  })
})

describe('report store cache', () => {
  it('stays within its byte bound and evicts the oldest', async () => {
    const { t, upload, userId } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push(await upload(payload()))
    let reads = 0
    const get = t.blobs.get
    const blobs = { ...t.blobs, get: (key: string) => (reads++, get(key)) }
    const size = JSON.stringify(payload()).length
    const store = createReportStore({ blobs }, { maxCacheBytes: Math.round(size * 2.5) })
    const item = (id: string) => ({ id, blobKey: `projects/p1/reports/${id}.json.gz` })
    void userId

    await store.loadReport(item(ids[0]!))
    await store.loadReport(item(ids[0]!))
    assert.equal(reads, 1)
    for (const id of ids.slice(1)) await store.loadReport(item(id))
    assert.equal(reads, 4)
    assert.ok(store.stats().bytes <= Math.round(size * 2.5))
    assert.ok(store.stats().entries < 4)
    await store.loadReport(item(ids[3]!))
    assert.equal(reads, 4, 'newest still cached')
    await store.loadReport(item(ids[0]!))
    assert.equal(reads, 5, 'oldest was evicted')
  })
})

describe('PATCH /api/projects/:id/feedback/:itemId', () => {
  async function patchStatus(t: Awaited<ReturnType<typeof setup>>, cookie: string, path: string, body: unknown) {
    return t.t.app.request(`/api/projects${path}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('lets a member change the status, reflected in the detail, its ETag and the list', async () => {
    const s = await setup()
    const id = await s.upload(payload())
    const before = await s.get(`/p1/feedback/${id}`)
    const etag = before.headers.get('etag')
    const res = await patchStatus(s, s.member.cookie, `/p1/feedback/${id}`, { status: 'in_progress' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'in_progress' })
    const after = await s.get(`/p1/feedback/${id}`, undefined, { 'if-none-match': etag! })
    assert.equal(after.status, 200)
    assert.notEqual(after.headers.get('etag'), etag)
    assert.equal(((await after.json()) as { status: string }).status, 'in_progress')
    const list = (await (await s.get('/p1/feedback')).json()) as { items: { status: string }[] }
    assert.equal(list.items[0]!.status, 'in_progress')
  })

  it('rejects an unknown status with 400 and leaves it unchanged', async () => {
    const s = await setup()
    const id = await s.upload(payload())
    for (const body of [{ status: 'archived' }, {}, { status: 3 }]) {
      assert.equal((await patchStatus(s, s.member.cookie, `/p1/feedback/${id}`, body)).status, 400)
    }
    const row = await s.t.db.selectFrom('feedback_items').select('status').where('id', '=', id).executeTakeFirstOrThrow()
    assert.equal(row.status, 'new')
  })

  it('answers 404 for a non-member, an unknown item and an item of another project', async () => {
    const s = await setup()
    const id = await s.upload(payload())
    const other = await signIn(s.t, { email: 'other@example.com', name: 'Other' })
    assert.equal((await patchStatus(s, other.cookie, `/p1/feedback/${id}`, { status: 'done' })).status, 404)
    assert.equal((await patchStatus(s, s.member.cookie, '/p1/feedback/nope', { status: 'done' })).status, 404)
    assert.equal((await patchStatus(s, s.member.cookie, `/p2/feedback/${id}`, { status: 'done' })).status, 404)
    const row = await s.t.db.selectFrom('feedback_items').select('status').where('id', '=', id).executeTakeFirstOrThrow()
    assert.equal(row.status, 'new')
  })

  it('is visible to the typed client', async () => {
    const s = await setup()
    const client = hc<AppType>('http://localhost', { fetch: s.t.app.request.bind(s.t.app) as typeof fetch })
    assert.equal(typeof client.api.projects[':id'].feedback[':itemId'].$patch, 'function')
  })
})

describe('feedback repo setStatus', () => {
  it('validates the status and reports unknown items', async () => {
    const s = await setup()
    const id = await s.upload(payload())
    const repo = createFeedbackRepo(s.t.db)
    assert.equal(await repo.setStatus('p1', id, 'done'), true)
    assert.equal(await repo.setStatus('p1', 'nope', 'done'), false)
    assert.equal(await repo.setStatus('p2', id, 'done'), false)
    await assert.rejects(repo.setStatus('p1', id, 'archived' as never), /Invalid feedback status/)
    const row = await s.t.db.selectFrom('feedback_items').select('status').where('id', '=', id).executeTakeFirstOrThrow()
    assert.equal(row.status, 'done')
  })
})

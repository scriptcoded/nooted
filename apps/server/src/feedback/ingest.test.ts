import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { hc } from 'hono/client'
import type { AppType } from '../app.ts'
import { issueUploadToken, revokeUploadToken } from '../sdk/tokens.ts'
import { createTestApp, signIn } from '../test-helpers.ts'

const ORIGIN = 'https://shop.example.com'

const capture = (n: number, overrides: Record<string, unknown> = {}) => ({
  n,
  url: 'https://shop.example.com/cart',
  capturedAt: 1_700_000_000_000,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
  demo: false,
  events: [
    { type: 4, timestamp: 1, data: { href: 'https://shop.example.com/cart' } },
    { type: 2, timestamp: 2, data: {} },
  ],
  marks: [{ nodeId: 5, tag: 'button', text: 'Pay', selector: '#pay', rect: { x: 1, y: 2, width: 3, height: 4 } }],
  ...overrides,
})

function payload(overrides: Record<string, unknown> = {}) {
  return {
    clientReportId: randomUUID(),
    note: '  Button is broken  ',
    url: 'https://shop.example.com/cart',
    capturedAt: 1_700_000_000_000,
    release: 'v1.2.3',
    device: { userAgent: 'test', viewport: { width: 800, height: 600, devicePixelRatio: 2 } },
    captures: [],
    ...overrides,
  }
}
const gz = (body: unknown) => gzipSync(Buffer.from(JSON.stringify(body)))

async function setup() {
  const t = await createTestApp()
  const now = Date.now()
  for (const [id, origin] of [['p1', ORIGIN], ['p2', 'https://other.example.com']] as const) {
    await t.db.insertInto('projects').values({ id, name: id, public_key: `pk_${id}`, retention_days: 90, created_at: now }).execute()
    await t.db.insertInto('project_origins').values({ project_id: id, origin }).execute()
  }
  const member = await signIn(t, { email: 'dev@example.com', name: 'Dev' })
  const userId = (await t.db.selectFrom('users').select('id').where('email', '=', 'dev@example.com').executeTakeFirstOrThrow()).id
  for (const p of ['p1', 'p2']) {
    await t.db.insertInto('project_members').values({ project_id: p, email_lower: 'dev@example.com', user_id: userId }).execute()
  }
  const puts: string[] = []
  const put = t.blobs.put
  t.blobs.put = (key, bytes) => {
    puts.push(key)
    return put(key, bytes)
  }
  const tokenFor = async (projectId: string) => (await issueUploadToken(t.db, { userId, projectId })).token
  const upload = (token: string | null, body: Buffer | string, headers: Record<string, string> = {}) =>
    t.app.request('/api/sdk/reports', {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-encoding': 'gzip',
        'content-type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : new Uint8Array(body),
    })
  const rows = () => t.db.selectFrom('feedback_items').selectAll().execute()
  return { t, member, userId, tokenFor, upload, rows, puts }
}

describe('POST /api/sdk/reports', () => {
  it('stores a valid report: 201, status new, blob is the exact uploaded bytes', async () => {
    const { t, tokenFor, upload, rows, userId } = await setup()
    const body = gz(payload())
    const res = await upload(await tokenFor('p1'), body)
    assert.equal(res.status, 201)
    const { id } = (await res.json()) as { id: string }
    const [row, ...rest] = await rows()
    assert.equal(rest.length, 0)
    assert.equal(row?.id, id)
    assert.equal(row?.status, 'new')
    assert.equal(row?.project_id, 'p1')
    assert.equal(row?.reporter_id, userId)
    assert.equal(row?.note, 'Button is broken')
    assert.equal(row?.release, 'v1.2.3')
    assert.equal(row?.blob_key, `projects/p1/reports/${id}.json.gz`)
    const blob = await t.blobs.get(row?.blob_key ?? '')
    assert.ok(blob && Buffer.compare(Buffer.from(blob), body) === 0)
  })

  it('rejects a missing token with 401', async () => {
    const { upload, rows } = await setup()
    assert.equal((await upload(null, gz(payload()))).status, 401)
    assert.equal((await rows()).length, 0)
  })

  it('rejects a revoked token with 401', async () => {
    const { t, tokenFor, upload } = await setup()
    const token = await tokenFor('p1')
    await revokeUploadToken(t.db, token)
    assert.equal((await upload(token, gz(payload()))).status, 401)
  })

  it('rejects an empty note with 400 and stores nothing', async () => {
    const { tokenFor, upload, rows, puts } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload({ note: '   ' })))
    assert.equal(res.status, 400)
    const json = (await res.json()) as { error: string; issues: { path: string; message: string }[] }
    assert.equal(json.error, 'invalid_report')
    assert.ok(json.issues.some((i) => i.path === 'note'))
    assert.equal((await rows()).length, 0)
    assert.equal(puts.length, 0)
  })

  it('accepts a report with no captures', async () => {
    const { tokenFor, upload, rows } = await setup()
    assert.equal((await upload(await tokenFor('p1'), gz(payload({ captures: [] })))).status, 201)
    assert.equal((await rows()).length, 1)
  })

  it('rejects 11 captures with 400', async () => {
    const { tokenFor, upload, rows } = await setup()
    const captures = Array.from({ length: 11 }, (_, i) => capture(i + 1))
    const res = await upload(await tokenFor('p1'), gz(payload({ captures })))
    assert.equal(res.status, 400)
    assert.equal((await rows()).length, 0)
  })

  it('rejects the old format with a top-level events list', async () => {
    const { tokenFor, upload, rows } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload({ events: [{ type: 2, timestamp: 1, data: {} }] })))
    assert.equal(res.status, 400)
    assert.equal((await rows()).length, 0)
  })

  it('rejects a note token without a capture', async () => {
    const { tokenFor, upload, rows } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload({ note: 'see [3]', captures: [capture(1), capture(2)] })))
    assert.equal(res.status, 400)
    const json = (await res.json()) as { issues: { path: string; message: string }[] }
    assert.ok(json.issues.some((i) => i.path === 'note' && i.message.includes('[3]')))
    assert.equal((await rows()).length, 0)
  })

  it('rejects a duplicate capture number', async () => {
    const { tokenFor, upload, rows } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload({ note: '[1]', captures: [capture(1), capture(1)] })))
    assert.equal(res.status, 400)
    assert.equal((await rows()).length, 0)
  })

  it('rejects a capture without a full snapshot', async () => {
    const { tokenFor, upload, rows } = await setup()
    const events = [{ type: 4, timestamp: 1, data: {} }, { type: 3, timestamp: 2, data: {} }]
    const res = await upload(await tokenFor('p1'), gz(payload({ note: '[1]', captures: [capture(1, { events })] })))
    assert.equal(res.status, 400)
    assert.equal((await rows()).length, 0)
  })

  it('accepts a capture the note does not mention, and stores the blob byte for byte', async () => {
    const { t, tokenFor, upload, rows } = await setup()
    const body = gz(payload({ note: 'only [1] here', captures: [capture(1), capture(2, { demo: true })] }))
    const res = await upload(await tokenFor('p1'), body)
    assert.equal(res.status, 201)
    const [row] = await rows()
    const blob = await t.blobs.get(row?.blob_key ?? '')
    assert.ok(blob && Buffer.compare(Buffer.from(blob), body) === 0)
    const stored = JSON.parse(gunzipSync(Buffer.from(blob)).toString()) as { captures: { n: number }[] }
    assert.deepEqual(stored.captures.map((c) => c.n), [1, 2])
  })

  it('rejects invalid gzip and invalid json with 400', async () => {
    const { tokenFor, upload } = await setup()
    const token = await tokenFor('p1')
    const a = await upload(token, Buffer.from('not gzip'))
    assert.equal(a.status, 400)
    assert.deepEqual(await a.json(), { error: 'invalid_gzip' })
    const b = await upload(token, gzipSync(Buffer.from('{nope')))
    assert.equal(b.status, 400)
    assert.deepEqual(await b.json(), { error: 'invalid_json' })
  })

  it('treats a retry with the same clientReportId as idempotent', async () => {
    const { tokenFor, upload, rows } = await setup()
    const token = await tokenFor('p1')
    const body = gz(payload())
    const first = await upload(token, body)
    const second = await upload(token, body)
    assert.equal(first.status, 201)
    assert.equal(second.status, 200)
    assert.deepEqual(await second.json(), await first.json())
    assert.equal((await rows()).length, 1)
  })

  it('handles concurrent duplicates without leaving extra rows or blobs', async () => {
    const { tokenFor, upload, rows } = await setup()
    const token = await tokenFor('p1')
    const body = gz(payload())
    const results = await Promise.all([upload(token, body), upload(token, body), upload(token, body)])
    assert.ok(results.every((r) => r.status === 200 || r.status === 201))
    assert.equal((await rows()).length, 1)
  })

  it('keeps the same clientReportId in different projects separate', async () => {
    const { tokenFor, upload, rows } = await setup()
    const body = gz(payload())
    assert.equal((await upload(await tokenFor('p1'), body)).status, 201)
    assert.equal((await upload(await tokenFor('p2'), body)).status, 201)
    assert.equal((await rows()).length, 2)
  })

  it('rejects a gzip bomb with 413 and stores nothing', async () => {
    const { tokenFor, upload, rows, puts } = await setup()
    const bomb = gzipSync(Buffer.alloc(101 * 1024 * 1024))
    const res = await upload(await tokenFor('p1'), bomb)
    assert.equal(res.status, 413)
    assert.deepEqual(await res.json(), { error: 'payload_too_large' })
    assert.equal((await rows()).length, 0)
    assert.equal(puts.length, 0)
  })

  it('rejects a compressed body over 10 MB with 413 (with and without content-length)', async () => {
    const { tokenFor, upload, puts } = await setup()
    const token = await tokenFor('p1')
    const big = randomBytes(10 * 1024 * 1024 + 1)
    const withLength = await upload(token, big, { 'content-length': String(big.length) })
    assert.equal(withLength.status, 413)
    assert.deepEqual(await withLength.json(), { error: 'payload_too_large' })
    // No content-length header: the stream-based limit must still catch it.
    const streamed = await upload(token, big)
    assert.equal(streamed.status, 413)
    assert.equal(puts.length, 0)
  })

  it('requires Content-Encoding: gzip', async () => {
    const { tokenFor, upload, rows } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload()), { 'content-encoding': 'identity' })
    assert.equal(res.status, 415)
    assert.deepEqual(await res.json(), { error: 'unsupported_encoding' })
    assert.equal((await rows()).length, 0)
  })

  it('accepts an allowed Origin and sets CORS headers, including on errors', async () => {
    const { tokenFor, upload } = await setup()
    const token = await tokenFor('p1')
    const ok = await upload(token, gz(payload()), { origin: ORIGIN })
    assert.equal(ok.status, 201)
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN)
    const big = randomBytes(10 * 1024 * 1024 + 1)
    const tooBig = await upload(token, big, { origin: ORIGIN, 'content-length': String(big.length) })
    assert.equal(tooBig.status, 413)
    assert.equal(tooBig.headers.get('access-control-allow-origin'), ORIGIN)
    const bad = await upload(token, gz(payload({ note: '' })), { origin: ORIGIN })
    assert.equal(bad.status, 400)
    assert.equal(bad.headers.get('access-control-allow-origin'), ORIGIN)
    const enc = await upload(token, gz(payload()), { origin: ORIGIN, 'content-encoding': 'identity' })
    assert.equal(enc.status, 415)
    assert.equal(enc.headers.get('access-control-allow-origin'), ORIGIN)
  })

  it('rejects a foreign Origin with 403 and stores nothing', async () => {
    const { tokenFor, upload, rows, puts } = await setup()
    const res = await upload(await tokenFor('p1'), gz(payload()), { origin: 'https://evil.example.com' })
    assert.equal(res.status, 403)
    assert.equal((await rows()).length, 0)
    assert.equal(puts.length, 0)
  })
})

describe('GET /api/projects/:id/feedback', () => {
  it('lists items newest first for a member, without blob keys', async () => {
    const { t, member, tokenFor, upload } = await setup()
    const token = await tokenFor('p1')
    const ids: string[] = []
    for (const note of ['first', 'second', 'third']) {
      const res = await upload(token, gz(payload({ note })))
      ids.push(((await res.json()) as { id: string }).id)
      await t.db.updateTable('feedback_items').set({ created_at: 1000 + ids.length }).where('id', '=', ids.at(-1) ?? '').execute()
    }
    const res = await t.app.request('/api/projects/p1/feedback', { headers: { cookie: member.cookie } })
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.ok(!text.includes('blob_key') && !text.includes('blobKey') && !text.includes('.json.gz'))
    const { items } = JSON.parse(text) as { items: Record<string, unknown>[] }
    assert.deepEqual(items.map((i) => i.note), ['third', 'second', 'first'])
    assert.deepEqual(items.map((i) => i.id), ids.toReversed())
    assert.equal(items[0]?.status, 'new')
    assert.equal(items[0]?.release, 'v1.2.3')
    assert.equal(items[0]?.capturedAt, 1_700_000_000_000)
    assert.deepEqual(items[0]?.reporter, { id: (items[0]?.reporter as { id: string }).id, name: 'Dev', email: 'dev@example.com' })
    assert.deepEqual(Object.keys(items[0] ?? {}).sort(), ['capturedAt', 'createdAt', 'id', 'note', 'release', 'reporter', 'status', 'url'])
  })

  it('returns 404 for a non-member and 401 without a session', async () => {
    const { t } = await setup()
    const other = await signIn(t, { email: 'other@example.com', name: 'Other' })
    assert.equal((await t.app.request('/api/projects/p1/feedback', { headers: { cookie: other.cookie } })).status, 404)
    assert.equal((await t.app.request('/api/projects/p1/feedback')).status, 401)
  })

  it('is typed on the hc client', () => {
    const client = hc<AppType>('http://localhost')
    assert.equal(typeof client.api.projects[':id'].feedback.$get, 'function')
  })
})

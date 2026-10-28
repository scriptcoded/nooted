import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { setup as oauthSetup } from '../oauth/test-utils.ts'
import { issueUploadToken } from '../sdk/tokens.ts'

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
const URL_ = 'https://shop.example.com/cart'

const pointCapture = {
  n: 1,
  url: URL_,
  capturedAt: 1_700_000_000_000,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
  demo: false,
  events: [
    { type: 4, timestamp: 1000, data: { href: URL_ } },
    { type: 2, timestamp: 1001, data: { node: { id: 1, type: 0 } } },
    { type: 3, timestamp: 2000, data: {} },
  ],
  marks: [{ nodeId: 5, tag: 'button', role: 'button', name: 'Add to cart', text: 'Add to cart', selector: '#fx-counter', rect: { x: 1, y: 2, width: 3, height: 4 } }],
}
const recordingCapture = {
  ...pointCapture,
  n: 2,
  demo: true,
  marks: [],
  events: [
    { type: 4, timestamp: 10_000, data: { href: URL_ } },
    { type: 2, timestamp: 10_001, data: { node: { id: 1, type: 0 } } },
    { type: 5, timestamp: 11_000, data: { tag: 'nooted:error', payload: { message: 'x is undefined', stack: 'at secret (bundle.js:1:1)', source: 'bundle.js', time: 11_000 } } },
    { type: 4, timestamp: 20_000, data: { href: 'https://shop.example.com/checkout' } },
    { type: 3, timestamp: 22_000, data: {} },
  ],
}

async function setup() {
  const s = await oauthSetup()
  const { t } = s
  const now = Date.now()
  for (const id of ['p1', 'p2']) {
    await t.db.insertInto('projects').values({ id, name: `Project ${id}`, public_key: `pk_${id}`, retention_days: 90, created_at: now + (id === 'p1' ? 0 : 1) }).execute()
  }
  await t.db.insertInto('project_origins').values({ project_id: 'p1', origin: 'https://shop.example.com' }).execute()
  await t.db.insertInto('project_origins').values({ project_id: 'p2', origin: 'https://shop.example.com' }).execute()
  const userRow = await t.db.selectFrom('users').select('id').where('email', '=', 'user@example.com').executeTakeFirstOrThrow()
  await t.db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'user@example.com', user_id: userRow.id }).execute()

  const upload = async (projectId: string, captures: unknown[], note: string) => {
    const { token } = await issueUploadToken(t.db, { userId: userRow.id, projectId })
    const body = {
      clientReportId: randomUUID(),
      note,
      url: URL_,
      capturedAt: 1_700_000_000_000,
      release: 'v1',
      device: { userAgent: CHROME, viewport: { width: 800, height: 600, devicePixelRatio: 2 } },
      captures,
    }
    const res = await t.app.request('/api/sdk/reports', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-encoding': 'gzip', 'content-type': 'application/json' },
      body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(body)))),
    })
    assert.equal(res.status, 201)
    return ((await res.json()) as { id: string }).id
  }

  async function client(accessToken: string) {
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:5173/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
      fetch: (input, init) => Promise.resolve(t.app.request(String(input instanceof URL ? input.href : input), init)),
    })
    const c = new Client({ name: 'test', version: '1' })
    await c.connect(transport)
    return c
  }
  const connectClient = async (scope?: string) => {
    const { tokens } = await s.connect(scope ? { scope } : {})
    return { c: await client(tokens.access_token), tokens }
  }
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = await c.callTool({ name, arguments: args })
    const text = (r.content as { type: string; text: string }[]).map((x) => x.text).join('\n')
    return { r, text, isError: r.isError === true }
  }
  const bulk = async (n: number, status = 'new') => {
    const base = 1_700_000_000_000
    for (let i = 0; i < n; i++) {
      await t.db
        .insertInto('feedback_items')
        .values({
          id: `bulk-${String(i).padStart(4, '0')}`,
          project_id: 'p1',
          client_report_id: randomUUID(),
          reporter_id: userRow.id,
          note: `Bulk note ${i}`,
          url: URL_,
          captured_at: base,
          status: status,
          release: null,
          blob_key: 'missing',
          capture_count: 0,
          // Collisions on purpose: three items share each timestamp.
          created_at: base + Math.floor(i / 3),
        })
        .execute()
    }
  }
  return { ...s, userRow, upload, client, connectClient, call, bulk }
}

describe('/mcp', () => {
  it('answers 401 with a challenge when there is no token', async () => {
    const { t } = await setup()
    const res = await t.app.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata="http:\/\/localhost:5173\/\.well-known\/oauth-protected-resource"/)
    const bad = await t.app.request('/mcp', { method: 'POST', headers: { authorization: 'Bearer nat_nope' }, body: '{}' })
    assert.equal(bad.status, 401)
    assert.match(bad.headers.get('www-authenticate') ?? '', /invalid_token/)
  })

  it('answers CORS preflight', async () => {
    const { t } = await setup()
    const res = await t.app.request('/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,mcp-protocol-version' },
    })
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /authorization/i)
  })

  it('lists the four tools', async () => {
    const s = await setup()
    const { c } = await s.connectClient()
    const { tools } = await c.listTools()
    assert.deepEqual(tools.map((x) => x.name).sort(), ['get_feedback', 'list_feedback', 'list_projects', 'set_feedback_status'])
    await c.close()
  })

  it('lists projects for a member and all for an admin', async () => {
    const s = await setup()
    const { c } = await s.connectClient()
    const r = await s.call(c, 'list_projects')
    assert.equal(r.text, '- Project p1 (id p1)')
    await c.close()

    // testConfig is shared between tests, so restore the admin list afterwards.
    const admins = s.t.config.adminEmails
    admins.push('user@example.com')
    try {
      const { c: admin } = await s.connectClient()
      const all = await s.call(admin, 'list_projects')
      assert.match(all.text, /id p1\)/)
      assert.match(all.text, /id p2\)/)
      await admin.close()
    } finally {
      admins.pop()
    }
  })

  it('says so when there are no projects', async () => {
    const s = await setup()
    await s.t.db.deleteFrom('project_members').execute()
    const { c } = await s.connectClient()
    assert.equal((await s.call(c, 'list_projects')).text, "You can't see any projects.")
    await c.close()
  })

  it('pages 120 items in three pages of 50 without duplicates', async () => {
    const s = await setup()
    await s.bulk(120)
    const { c } = await s.connectClient()
    const seen: string[] = []
    let cursor: string | undefined
    const sizes: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await s.call(c, 'list_feedback', { projectId: 'p1', limit: 50, ...(cursor ? { cursor } : {}) })
      assert.ok(!res.isError, res.text)
      const sc = res.r.structuredContent as { items: { id: string }[]; nextCursor: string | null }
      sizes.push(sc.items.length)
      seen.push(...sc.items.map((x) => x.id))
      if (!sc.nextCursor) break
      assert.match(res.text, /Next cursor: /)
      cursor = sc.nextCursor
    }
    assert.deepEqual(sizes, [50, 50, 20])
    assert.equal(new Set(seen).size, 120)
    assert.equal(seen[0], 'bulk-0119')
    await c.close()
  })

  it('filters by status', async () => {
    const s = await setup()
    await s.bulk(5)
    await s.t.db.updateTable('feedback_items').set({ status: 'done' }).where('id', 'in', ['bulk-0000', 'bulk-0001']).execute()
    const { c } = await s.connectClient()
    const res = await s.call(c, 'list_feedback', { projectId: 'p1', status: 'new' })
    const items = (res.r.structuredContent as { items: { id: string; status: string }[] }).items
    assert.equal(items.length, 3)
    assert.ok(items.every((i) => i.status === 'new'))
    assert.ok(!res.text.includes('blob'))
    await c.close()
  })

  it('returns a digest without raw recording data', async () => {
    const s = await setup()
    const id = await s.upload('p1', [pointCapture, recordingCapture], 'Make [1] bigger, then see [2]')
    const { c } = await s.connectClient()
    const res = await s.call(c, 'get_feedback', { itemId: id })
    assert.ok(!res.isError, res.text)
    assert.match(res.text, new RegExp(`# Change request ${id}`))
    assert.match(res.text, /Make \[1\] bigger, then see \[2\]/)
    assert.match(res.text, /"Add to cart" \(button\)/)
    assert.match(res.text, /`#fx-counter`/)
    assert.match(res.text, /Recording, 0:12/)
    assert.match(res.text, /x is undefined/)
    assert.match(res.text, new RegExp(`http://localhost:5173/projects/p1/feedback/${id}`))
    const whole = JSON.stringify(res.r)
    for (const bad of ['"type":2', 'nodeId', 'rr_', 'secret', 'bundle.js']) assert.ok(!whole.includes(bad), bad)
    await c.close()
  })

  it('reports another project as not found', async () => {
    const s = await setup()
    const id = await s.upload('p2', [pointCapture], 'Other [1]')
    const { c } = await s.connectClient()
    const res = await s.call(c, 'get_feedback', { itemId: id })
    assert.equal(res.isError, true)
    assert.equal(res.text, 'Not found.')
    const missing = await s.call(c, 'get_feedback', { itemId: 'nope' })
    assert.equal(missing.text, 'Not found.')
    const list = await s.call(c, 'list_feedback', { projectId: 'p2' })
    assert.equal(list.isError, true)
    assert.equal(list.text, 'Not found.')
    const set = await s.call(c, 'set_feedback_status', { itemId: id, status: 'done' })
    assert.equal(set.text, 'Not found.')
    await c.close()
  })

  it('applies membership removal immediately', async () => {
    const s = await setup()
    const id = await s.upload('p1', [pointCapture], 'Mine [1]')
    const { c } = await s.connectClient()
    assert.ok(!(await s.call(c, 'get_feedback', { itemId: id })).isError)
    await s.t.db.deleteFrom('project_members').where('project_id', '=', 'p1').execute()
    assert.equal((await s.call(c, 'list_projects')).text, "You can't see any projects.")
    assert.equal((await s.call(c, 'get_feedback', { itemId: id })).isError, true)
    assert.equal((await s.call(c, 'list_feedback', { projectId: 'p1' })).isError, true)
    await c.close()
  })

  it('refuses read tools with a write-only token', async () => {
    const s = await setup()
    const id = await s.upload('p1', [pointCapture], 'Mine [1]')
    const { c } = await s.connectClient('feedback.write')
    const msg = "This connection doesn't have read access to Nooted."
    for (const [name, args] of [['list_projects', {}], ['list_feedback', { projectId: 'p1' }], ['get_feedback', { itemId: id }]] as const) {
      const res = await s.call(c, name, args)
      assert.equal(res.isError, true, name)
      assert.equal(res.text, msg)
    }
    assert.ok(!(await s.call(c, 'set_feedback_status', { itemId: id, status: 'done' })).isError)
    await c.close()
  })

  it('refuses status changes with a read-only token', async () => {
    const s = await setup()
    const id = await s.upload('p1', [pointCapture], 'Mine [1]')
    const { c } = await s.connectClient('feedback.read')
    const res = await s.call(c, 'set_feedback_status', { itemId: id, status: 'done' })
    assert.equal(res.isError, true)
    assert.match(res.text, /only has read access/)
    const row = await s.t.db.selectFrom('feedback_items').select('status').where('id', '=', id).executeTakeFirstOrThrow()
    assert.equal(row.status, 'new')
    await c.close()
  })

  it('sets the status with a write token, visible in the console', async () => {
    const s = await setup()
    const id = await s.upload('p1', [pointCapture], 'Mine [1]')
    const { c } = await s.connectClient()
    const res = await s.call(c, 'set_feedback_status', { itemId: id, status: 'done' })
    assert.ok(!res.isError, res.text)
    assert.equal(res.text, `Status of ${id} set to Done.`)
    const detail = await s.t.app.request(`/api/projects/p1/feedback/${id}`, { headers: { cookie: s.user.cookie } })
    assert.equal(((await detail.json()) as { status: string }).status, 'done')
    await c.close()
  })

  it('answers 401 after the grant is revoked', async () => {
    const s = await setup()
    const { c, tokens } = await s.connectClient()
    assert.ok(!(await s.call(c, 'list_projects')).isError)
    await s.t.db.updateTable('oauth_grants').set({ revoked_at: Date.now() }).execute()
    const res = await s.t.app.request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    assert.equal(res.status, 401)
    await assert.rejects(s.call(c, 'list_projects'))
    await c.close().catch(() => {})
  })
})

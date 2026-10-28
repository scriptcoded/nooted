import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { setup as oauthSetup } from '../oauth/test-utils.ts'
import { RenderError } from '../render/errors.ts'
import type { CaptureRenderer, RenderContext } from '../render/renderer.ts'
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

async function setup(renderer?: CaptureRenderer) {
  const s = await oauthSetup({ renderer })
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
    const content = r.content as { type: string; text?: string; data?: string; mimeType?: string }[]
    const text = content.filter((x) => x.type === 'text').map((x) => x.text).join('\n')
    return { r, text, content, isError: r.isError === true }
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

  it('lists the five tools', async () => {
    const s = await setup()
    const { c } = await s.connectClient()
    const { tools } = await c.listTools()
    assert.deepEqual(tools.map((x) => x.name).sort(), ['get_capture_frames', 'get_feedback', 'list_feedback', 'list_projects', 'set_feedback_status'])
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
  describe('capture images', () => {
    const jpeg = (tag: number) => Buffer.from([0xff, 0xd8, 0xff, tag])
    const RRWEB_MARKERS = ['"type":2,', 'childNodes', 'rrweb', 'nodeId', 'secret', 'bundle.js', 'initialOffset']

    function fakeRenderer(overrides: Partial<CaptureRenderer> = {}) {
      const calls: { still: number[]; frames: number[] } = { still: [], frames: [] }
      const renderer: CaptureRenderer = {
        available: () => true,
        still: async (ctx: RenderContext) => {
          calls.still.push(ctx.capture.n)
          return jpeg(ctx.capture.n)
        },
        frames: async (ctx: RenderContext) => {
          calls.frames.push(ctx.capture.n)
          return [
            { t: 0, caption: '0:00  start', image: jpeg(100) },
            { t: 12_000, caption: '0:12  end', image: jpeg(101) },
          ]
        },
        close: async () => {},
        ...overrides,
      }
      return { renderer, calls }
    }
    const captureN = (n: number) => ({ ...pointCapture, n })
    const imagesOf = (content: { type: string; data?: string; mimeType?: string }[]) => content.filter((x) => x.type === 'image')
    const bytesOf = (block: { data?: string }) => [...Buffer.from(block.data ?? '', 'base64')]

    it('returns one labelled image per capture, in order, after the digest', async () => {
      const { renderer, calls } = fakeRenderer()
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'Make [1] bigger, then see [2]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_feedback', { itemId: id })
      assert.ok(!res.isError, res.text)
      const kinds = res.content.map((x) => x.type)
      assert.deepEqual(kinds, ['text', 'text', 'image', 'text', 'image'])
      assert.match(res.content[0]!.text!, new RegExp(`# Change request ${id}`))
      assert.match(res.content[1]!.text!, /^\[1\] Pointed at/)
      assert.match(res.content[3]!.text!, /^\[2\] Recording, 0:12/)
      const images = imagesOf(res.content)
      assert.ok(images.every((x) => x.mimeType === 'image/jpeg'))
      assert.deepEqual(bytesOf(images[0]!), [...jpeg(1)])
      assert.deepEqual(bytesOf(images[1]!), [...jpeg(2)])
      assert.deepEqual(calls.still.sort(), [1, 2])
      assert.ok(!res.text.includes("aren't available"))
      await c.close()
    })

    it('says images are not available when there is no renderer', async () => {
      const s = await setup()
      const id = await s.upload('p1', [pointCapture], 'Make [1] bigger')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_feedback', { itemId: id })
      assert.ok(!res.isError)
      assert.equal(imagesOf(res.content).length, 0)
      assert.match(res.text, /Images aren't available on this server\./)
      assert.match(res.text, /Make \[1\] bigger/)
      await c.close()
    })

    it('says so when the renderer reports itself unavailable or fails to launch', async () => {
      const off = fakeRenderer({ available: () => false })
      const s1 = await setup(off.renderer)
      const id1 = await s1.upload('p1', [pointCapture], 'Look [1]')
      const { c: c1 } = await s1.connectClient()
      assert.match((await s1.call(c1, 'get_feedback', { itemId: id1 })).text, /Images aren't available on this server\./)
      assert.deepEqual(off.calls.still, [])
      await c1.close()

      const broken = fakeRenderer({ still: async () => { throw new RenderError('unavailable', 'no browser') } })
      const s2 = await setup(broken.renderer)
      const id2 = await s2.upload('p1', [pointCapture], 'Look [1]')
      const { c: c2 } = await s2.connectClient()
      const res = await s2.call(c2, 'get_feedback', { itemId: id2 })
      assert.ok(!res.isError)
      assert.match(res.text, /Images aren't available on this server\./)
      await c2.close()
    })

    it('returns at most 4 images and names the captures left out', async () => {
      const { renderer, calls } = fakeRenderer()
      const s = await setup(renderer)
      const captures = [1, 2, 3, 4, 5, 6].map(captureN)
      const id = await s.upload('p1', captures, 'See [1] to [6]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_feedback', { itemId: id })
      assert.equal(imagesOf(res.content).length, 4)
      assert.deepEqual(calls.still.sort(), [1, 2, 3, 4])
      assert.match(res.content[0]!.text!, /Images for \[5\], \[6\] aren't included: call get_capture_frames/)
      await c.close()
    })

    it('replaces a failed image with a one-line note and keeps the rest', async () => {
      const { renderer } = fakeRenderer({
        still: async (ctx) => {
          if (ctx.capture.n === 1) throw new RenderError('failed', 'boom')
          return jpeg(ctx.capture.n)
        },
      })
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'See [1] and [2]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_feedback', { itemId: id })
      assert.ok(!res.isError)
      assert.match(res.text, /Image for \[1\] could not be drawn\./)
      const images = imagesOf(res.content)
      assert.equal(images.length, 1)
      assert.deepEqual(bytesOf(images[0]!), [...jpeg(2)])
      assert.match(res.text, /Recording, 0:12/)
      await c.close()
    })

    it('returns the timeline and captioned frames for a recording', async () => {
      const { renderer, calls } = fakeRenderer()
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'See [2]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_capture_frames', { itemId: id, capture: 2 })
      assert.ok(!res.isError, res.text)
      assert.deepEqual(res.content.map((x) => x.type), ['text', 'text', 'image', 'text', 'image'])
      assert.match(res.content[0]!.text!, /Recording, 0:12/)
      assert.match(res.content[0]!.text!, /Timeline:/)
      assert.match(res.content[0]!.text!, /navigated to \/checkout/)
      assert.equal(res.content[1]!.text, '0:00  start')
      assert.equal(res.content[3]!.text, '0:12  end')
      assert.deepEqual(bytesOf(imagesOf(res.content)[0]!), [...jpeg(100)])
      assert.deepEqual(calls.frames, [2])
      await c.close()
    })

    it('returns the description and still for a point capture', async () => {
      const { renderer, calls } = fakeRenderer()
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'See [1]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_capture_frames', { itemId: id, capture: 1 })
      assert.ok(!res.isError, res.text)
      assert.deepEqual(res.content.map((x) => x.type), ['text', 'image'])
      assert.match(res.text, /"Add to cart" \(button\)/)
      assert.match(res.text, /`#fx-counter`/)
      assert.deepEqual(bytesOf(imagesOf(res.content)[0]!), [...jpeg(1)])
      assert.deepEqual(calls.still, [1])
      assert.deepEqual(calls.frames, [])
      await c.close()
    })

    it('gives text and a one-line note from get_capture_frames when images are unavailable or fail', async () => {
      const s = await setup()
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'See [2]')
      const { c } = await s.connectClient()
      const res = await s.call(c, 'get_capture_frames', { itemId: id, capture: 2 })
      assert.ok(!res.isError)
      assert.match(res.text, /Recording, 0:12/)
      assert.match(res.text, /Images aren't available on this server\./)
      assert.equal(imagesOf(res.content).length, 0)
      await c.close()

      const { renderer } = fakeRenderer({ frames: async () => { throw new RenderError('timeout', 'slow') } })
      const s2 = await setup(renderer)
      const id2 = await s2.upload('p1', [recordingCapture], 'See [2]')
      const { c: c2 } = await s2.connectClient()
      const failed = await s2.call(c2, 'get_capture_frames', { itemId: id2, capture: 2 })
      assert.ok(!failed.isError)
      assert.match(failed.text, /Images for \[2\] could not be drawn\./)
      await c2.close()
    })

    it('reports an unknown capture, an unknown item and another project as not found', async () => {
      const { renderer, calls } = fakeRenderer()
      const s = await setup(renderer)
      const mine = await s.upload('p1', [pointCapture, recordingCapture], 'See [1]')
      const other = await s.upload('p2', [pointCapture], 'Other [1]')
      const { c } = await s.connectClient()
      for (const args of [{ itemId: mine, capture: 7 }, { itemId: 'nope', capture: 1 }, { itemId: other, capture: 1 }]) {
        const res = await s.call(c, 'get_capture_frames', args)
        assert.equal(res.isError, true, JSON.stringify(args))
        assert.equal(res.text, 'Not found.')
        assert.equal(res.content.length, 1)
      }
      const getOther = await s.call(c, 'get_feedback', { itemId: other })
      assert.equal(getOther.text, 'Not found.')
      assert.deepEqual([calls.still, calls.frames], [[], []])
      await c.close()
    })

    it('refuses get_capture_frames with a write-only token', async () => {
      const { renderer } = fakeRenderer()
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture], 'See [1]')
      const { c } = await s.connectClient('feedback.write')
      const res = await s.call(c, 'get_capture_frames', { itemId: id, capture: 1 })
      assert.equal(res.isError, true)
      assert.equal(res.text, "This connection doesn't have read access to Nooted.")
      await c.close()
    })

    it('never puts rrweb data in any response', async () => {
      const { renderer } = fakeRenderer()
      const s = await setup(renderer)
      const id = await s.upload('p1', [pointCapture, recordingCapture], 'See [1] and [2]')
      const { c } = await s.connectClient()
      const responses = [
        await s.call(c, 'get_feedback', { itemId: id }),
        await s.call(c, 'get_capture_frames', { itemId: id, capture: 1 }),
        await s.call(c, 'get_capture_frames', { itemId: id, capture: 2 }),
      ]
      for (const res of responses) {
        const whole = JSON.stringify(res.content.filter((x) => x.type === 'text'))
        for (const bad of RRWEB_MARKERS) assert.ok(!whole.includes(bad), bad)
      }
      await c.close()
    })
  })
})

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBrowserManager } from './browser.ts'
import { RenderError } from './errors.ts'
import { markOutlines, renderStill, stillScale, withRenderSession } from './page.ts'
import { skipUnlessChromium } from './test-support.ts'

const sdkDistDir = fileURLToPath(new URL('../../../../packages/sdk/dist', import.meta.url))
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type Node = Record<string, unknown>
let nextId = 10
const el = (tagName: string, attributes: Record<string, string>, childNodes: Node[] = []): Node => ({
  type: 2, tagName, attributes, childNodes, id: nextId++,
})

/** A hand-built rrweb recording: Meta, a full snapshot of `body`, and a later custom event. */
function recording(width: number, height: number, bodyChildren: Node[]) {
  const doc = {
    type: 0, id: 1,
    childNodes: [
      { type: 1, id: 2, name: 'html', publicId: '', systemId: '' },
      el('html', {}, [el('head', {}), el('body', { style: 'margin:0;background:#fff' }, bodyChildren)]),
    ],
  }
  return [
    { type: 4, timestamp: 1000, data: { href: 'http://example.test/', width, height } },
    { type: 2, timestamp: 1001, data: { node: doc, initialOffset: { left: 0, top: 0 } } },
    { type: 5, timestamp: 1500, data: { tag: 'noop', payload: {} } },
  ]
}

const box = el('div', { id: 'box', style: 'position:absolute;left:100px;top:50px;width:200px;height:100px;background:#0000ff' })

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))
  })
}

describe('render pages', () => {
  const manager = createBrowserManager({ mode: 'auto', chromiumPath: process.env.CHROMIUM_PATH, log: () => {} })
  const seenA: string[] = []
  const seenB: string[] = []
  let a: { server: Server; origin: string }
  let b: { server: Server; origin: string }

  before(async () => {
    a = await listen((req, res) => {
      seenA.push(req.url ?? '')
      if (req.url === '/redirect.png') {
        res.writeHead(302, { location: `${b.origin}/via-redirect.png` }).end()
      } else if (req.url === '/hang.png') {
        // never answers
      } else {
        res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_1X1)
      }
    })
    b = await listen((req, res) => {
      seenB.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_1X1)
    })
  })

  after(async () => {
    await manager.close()
    for (const { server } of [a, b]) {
      server.closeAllConnections()
      server.close()
    }
  })

  const base = (events: unknown[], width = 400, height = 300) => ({
    events, viewport: { width, height }, allowedOrigins: [] as string[], sdkDistDir,
  })

  async function pixels(png: Buffer, points: Array<[number, number]>) {
    return manager.withBrowser(async (browser) => {
      const page = await browser.newPage()
      try {
        return await page.evaluate(async ([data, pts]) => {
          const g = globalThis as any
          const img = new g.Image()
          img.src = `data:image/png;base64,${data}`
          await img.decode()
          const canvas = g.document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          return (pts as number[][]).map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)])
        }, [png.toString('base64'), points] as const)
      } finally {
        await page.close()
      }
    })
  }

  it('scales the still to fit within 1568 px', async (t) => {
    if (await skipUnlessChromium(t)) return
    assert.equal(stillScale({ width: 800, height: 600 }), 1)
    const events = recording(3136, 1000, [box])
    const jpeg = await renderStill(manager, { capture: { events: events as never, viewport: { width: 3136, height: 1000 }, marks: [], scroll: { x: 0, y: 0 } }, allowedOrigins: [], sdkDistDir })
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff])
    const png = await withRenderSession(manager, base(events, 3136, 1000), async (s) => {
      await s.seek()
      return s.clean({ format: 'png' })
    })
    assert.equal(png.readUInt32BE(16), 1568)
    assert.equal(png.readUInt32BE(20), 500)
  })

  it('draws outlines at the mark position, minus scroll, and leaves the clean shot bare', async (t) => {
    if (await skipUnlessChromium(t)) return
    const capture = {
      events: recording(400, 300, [box]),
      viewport: { width: 400, height: 300 },
      scroll: { x: 0, y: 20 },
      marks: [{ nodeId: 0, rect: { x: 100, y: 70, width: 200, height: 100 } }],
    }
    assert.deepEqual(markOutlines(capture as never), [{ nodeId: 0, fallback: { x: 100, y: 50, width: 200, height: 100 } }])
    const outlined = await renderStill(manager, { capture: capture as never, allowedOrigins: [], sdkDistDir }, { format: 'png' })
    const [halo, ring, inside, away] = (await pixels(outlined, [[96, 100], [98, 100], [200, 100], [10, 10]])) as number[][]
    assert.deepEqual(ring, [255, 45, 85])
    assert.deepEqual(halo, [255, 255, 255])
    assert.deepEqual(inside, [0, 0, 255])
    assert.deepEqual(away, [255, 255, 255])

    const both = await withRenderSession(manager, base(capture.events), async (s) => {
      await s.seek()
      const nodeBox = s.duration >= 0
      assert.ok(nodeBox)
      return { clean: await s.clean({ format: 'png' }), byNode: await s.outlined([{ nodeId: box.id as number }], { format: 'png' }) }
    })
    assert.deepEqual((await pixels(both.clean, [[98, 50]]))[0], [255, 255, 255])
    assert.deepEqual((await pixels(both.byNode, [[98, 100]]))[0], [255, 45, 85])
  })

  it('outlines a mark by its node when the recorded rect is wrong', async (t) => {
    if (await skipUnlessChromium(t)) return
    const capture = {
      events: recording(400, 300, [box]),
      viewport: { width: 400, height: 300 },
      scroll: { x: 0, y: 0 },
      // 75 px left and 20 px down from where the box is drawn here.
      marks: [{ nodeId: box.id as number, rect: { x: 25, y: 70, width: 200, height: 100 } }],
    }
    const png = await renderStill(manager, { capture: capture as never, allowedOrigins: [], sdkDistDir }, { format: 'png' })
    const [atNode, atRecorded] = (await pixels(png, [[98, 100], [23, 100]])) as number[][]
    assert.deepEqual(atNode, [255, 45, 85])
    assert.deepEqual(atRecorded, [255, 255, 255])
  })

  it('falls back to the recorded rect when the node is not in the snapshot', async (t) => {
    if (await skipUnlessChromium(t)) return
    const capture = {
      events: recording(400, 300, [box]),
      viewport: { width: 400, height: 300 },
      scroll: { x: 0, y: 20 },
      marks: [{ nodeId: 99999, rect: { x: 100, y: 70, width: 200, height: 100 } }],
    }
    const png = await renderStill(manager, { capture: capture as never, allowedOrigins: [], sdkDistDir }, { format: 'png' })
    assert.deepEqual((await pixels(png, [[98, 100]]))[0], [255, 45, 85])
  })

  it('shows masked input values as they were recorded, never real text', async (t) => {
    if (await skipUnlessChromium(t)) return
    const input = el('input', { type: 'text', value: '*******' })
    const html = await withRenderSession(manager, base(recording(400, 300, [input])), async (s) => {
      await s.seek()
      return s.frameHtml()
    })
    assert.match(html, /value="\*{7}"/)
    assert.doesNotMatch(html, /hunter2/)
  })

  it('loads images from an allowed origin only', async (t) => {
    if (await skipUnlessChromium(t)) return
    seenA.length = 0
    seenB.length = 0
    const imgs = [
      el('img', { src: `${a.origin}/ok.png` }),
      el('img', { src: `${b.origin}/blocked.png` }),
    ]
    await withRenderSession(manager, { ...base(recording(400, 300, imgs)), allowedOrigins: [a.origin] }, (s) => s.seek())
    assert.ok(seenA.includes('/ok.png'))
    assert.deepEqual(seenB, [])
  })

  it('does not follow a redirect from the allowed origin', async (t) => {
    if (await skipUnlessChromium(t)) return
    seenA.length = 0
    seenB.length = 0
    const events = recording(400, 300, [el('img', { src: `${a.origin}/redirect.png` })])
    await withRenderSession(manager, { ...base(events), allowedOrigins: [a.origin] }, (s) => s.seek())
    assert.ok(seenA.includes('/redirect.png'))
    assert.deepEqual(seenB, [])
  })

  it('times out cleanly when the page never settles', async (t) => {
    if (await skipUnlessChromium(t)) return
    const events = recording(400, 300, [el('img', { src: `${a.origin}/hang.png` })])
    const started = Date.now()
    await assert.rejects(
      withRenderSession(manager, { ...base(events), allowedOrigins: [a.origin] }, (s) => s.seek(), { timeoutMs: 600, settleMs: 10_000 }),
      (e: unknown) => e instanceof RenderError && e.code === 'timeout',
    )
    assert.ok(Date.now() - started < 5000)
    // The manager is still usable afterwards.
    await withRenderSession(manager, base(recording(400, 300, [box])), (s) => s.seek())
  })

  it('reports a failure when the replay bundle is missing', async (t) => {
    if (await skipUnlessChromium(t)) return
    await assert.rejects(
      withRenderSession(manager, { ...base(recording(400, 300, [])), sdkDistDir: '/nonexistent' }, async () => {}),
      (e: unknown) => e instanceof RenderError && e.code === 'failed',
    )
  })
})

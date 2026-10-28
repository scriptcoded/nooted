import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Capture } from '@nooted/shared'
import { createFsBlobStore } from '../blobs.ts'
import { createBrowserManager } from './browser.ts'
import type { BrowserManager } from './browser.ts'
import { RENDER_VERSION } from './cache.ts'
import { createCaptureRenderer } from './renderer.ts'
import { buildMoments, selectMoments } from './storyboard.ts'
import type { MomentKind } from './storyboard.ts'
import { skipUnlessChromium } from './test-support.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sdkDistDir = fileURLToPath(new URL('../../../../packages/sdk/dist', import.meta.url))

const m = (kind: MomentKind, t: number) => ({ kind, t })
const times = (list: { t: number }[]) => list.map((x) => x.t)

describe('selectMoments', () => {
  it('keeps everything up to the cap', () => {
    const input = [m('start', 0), m('click', 1), m('end', 2)]
    assert.deepEqual(selectMoments(input), input)
  })

  it('keeps the first and last of 15 clicks and at most 6 in time order', () => {
    const input = [m('start', 0), ...Array.from({ length: 15 }, (_, i) => m('click', 100 + i)), m('end', 1000)]
    const out = selectMoments(input)
    assert.equal(out.length, 6)
    assert.deepEqual(times(out), [0, 100, 101, 102, 103, 1000])
  })

  it('ranks clicks on non-interactive areas last', () => {
    const input = [m('start', 0), m('idle-click', 1), m('typing', 2), m('click', 3), m('idle-click', 4), m('error', 5), m('navigation', 6), m('end', 7)]
    assert.deepEqual(times(selectMoments(input, 6)), [0, 2, 3, 5, 6, 7])
    assert.deepEqual(times(selectMoments(input, 7)), [0, 1, 2, 3, 5, 6, 7])
  })

  it('fills by priority: navigation, click, error, typing', () => {
    const input = [m('start', 0), m('typing', 1), m('error', 2), m('click', 3), m('navigation', 4), m('typing', 5), m('click', 6), m('error', 7), m('navigation', 8), m('end', 9)]
    const out = selectMoments(input)
    // first + last, both navigations, both clicks.
    assert.deepEqual(times(out), [0, 3, 4, 6, 8, 9])
    const more = selectMoments(input, 8)
    assert.deepEqual(times(more), [0, 2, 3, 4, 6, 7, 8, 9])
  })

  it('does not mutate the input', () => {
    const input = Array.from({ length: 10 }, (_, i) => m('click', i))
    selectMoments(input)
    assert.equal(input.length, 10)
  })
})

type Node = Record<string, unknown>
let nextId = 10
const el = (tagName: string, attributes: Record<string, string>, childNodes: Node[] = []): Node => ({ type: 2, tagName, attributes, childNodes, id: nextId++ })
const textNode = (textContent: string): Node => ({ type: 3, textContent, id: nextId++ })
const snapshot = (body: Node[]) => ({
  type: 0, id: 1,
  childNodes: [{ type: 1, id: 2, name: 'html', publicId: '', systemId: '' }, el('html', {}, [el('head', {}), el('body', { style: 'margin:0;background:#fff' }, body)])],
})

function clickThenNavigate() {
  const button = el('button', { id: 'checkout', style: 'position:absolute;left:50px;top:50px;width:120px;height:40px;background:#00f' }, [textNode('Checkout')])
  const buttonId = button.id as number
  const events = [
    { type: 4, timestamp: 1000, data: { href: 'http://example.test/cart', width: 400, height: 300 } },
    { type: 2, timestamp: 1001, data: { node: snapshot([button]), initialOffset: { left: 0, top: 0 } } },
    { type: 3, timestamp: 2000, data: { source: 2, type: 2, id: buttonId, x: 60, y: 60 } },
    { type: 3, timestamp: 2050, data: { source: 0, texts: [], removes: [], adds: [], attributes: [{ id: buttonId, attributes: { style: 'position:absolute;left:50px;top:50px;width:120px;height:40px;background:#0a0' } }] } },
    { type: 4, timestamp: 3000, data: { href: 'http://example.test/checkout', width: 400, height: 300 } },
    { type: 2, timestamp: 3001, data: { node: snapshot([el('div', { style: 'position:absolute;inset:0;background:#c00' })]), initialOffset: { left: 0, top: 0 } } },
    { type: 5, timestamp: 5000, data: { tag: 'noop', payload: {} } },
  ]
  const capture = { n: 1, url: 'http://example.test/cart', capturedAt: 1, viewport: { width: 400, height: 300 }, scroll: { x: 0, y: 0 }, demo: true, marks: [], events } as unknown as Capture
  return { capture, buttonId }
}

describe('buildMoments', () => {
  it('builds captions, outlines and frame times for a click then a navigation', () => {
    const { capture, buttonId } = clickThenNavigate()
    const moments = buildMoments(capture, 4000)
    assert.deepEqual(moments.map((x) => [x.kind, x.t, x.frameAt]), [['start', 0, 0], ['click', 1000, 1400], ['navigation', 2000, 2400], ['end', 4000, 4000]])
    assert.equal(moments[0]!.caption, '0:00  start')
    assert.match(moments[1]!.caption, /^0:01 {2}clicked button "Checkout"/)
    assert.deepEqual(moments[1]!.outlines, [{ nodeId: buttonId }])
    assert.equal(moments[2]!.caption, '0:02  navigated to /checkout')
    assert.equal(moments[3]!.caption, '0:04  end')
  })

  it('gives a click on a non-interactive element the lowest priority kind', () => {
    const { capture } = clickThenNavigate()
    const events = [
      ...capture.events.slice(0, 2),
      { type: 3, timestamp: 1500, data: { source: 2, type: 2, id: 5 } },
      ...capture.events.slice(2),
    ]
    const snap = (events[1] as { data: { node: { childNodes: Array<{ childNodes: Array<{ childNodes: unknown[] }> }> } } }).data.node
    snap.childNodes[1]!.childNodes[1]!.childNodes.push({ type: 2, tagName: 'p', attributes: {}, id: 5, childNodes: [{ type: 3, textContent: 'Some prose', id: 6 }] })
    const moments = buildMoments({ ...capture, events } as never, 4000)
    assert.deepEqual(moments.filter((x) => x.kind !== 'start' && x.kind !== 'end').map((x) => x.kind), ['idle-click', 'click', 'navigation'])
  })

  it('takes a frame just before the next event when it comes sooner, and clamps to the duration', () => {
    const { capture } = clickThenNavigate()
    const moments = buildMoments({ ...capture, events: capture.events }, 2100)
    assert.equal(moments.find((x) => x.kind === 'navigation')!.frameAt, 2100)
  })
})

describe('storyboard rendering', () => {
  function countingManager() {
    const inner = createBrowserManager({ mode: 'auto', chromiumPath: process.env.CHROMIUM_PATH, log: () => {} })
    const counter = { renders: 0 }
    const manager: BrowserManager = {
      ...inner,
      withBrowser: (fn) => {
        counter.renders++
        return inner.withBrowser(fn)
      },
    }
    return { manager, counter, inner }
  }
  const managers: BrowserManager[] = []
  after(async () => {
    for (const manager of managers) await manager.close()
  })

  it('draws start, outlined click and navigation frames, then serves the second call from the cache', async (t) => {
    if (await skipUnlessChromium(t)) return
    const { manager, counter } = countingManager()
    managers.push(manager)
    const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-storyboard-')))
    const renderer = createCaptureRenderer({ config: { captureImages: 'auto', chromiumPath: undefined, sdkDistDir }, blobs, manager })
    const { capture } = clickThenNavigate()
    const ctx = { projectId: 'p1', itemId: 'item1', capture, allowedOrigins: [] }

    const frames = await renderer.frames(ctx)
    assert.equal(counter.renders, 1)
    // The end frame equals the navigation frame, so it is dropped.
    assert.deepEqual(frames.map((f) => f.caption.slice(0, 5)), ['0:00 ', '0:01 ', '0:02 '])
    assert.ok(frames.every((f) => f.image[0] === 0xff && f.image[1] === 0xd8))
    assert.equal(new Set(frames.map((f) => createHash('sha256').update(f.image).digest('hex'))).size, 3)

    const again = await renderer.frames(ctx)
    assert.equal(counter.renders, 1, 'cached storyboard must not render');
    assert.deepEqual(again.map((f) => f.caption), frames.map((f) => f.caption))
    assert.ok(again[1]!.image.equals(frames[1]!.image))
    assert.ok(await blobs.get(`projects/p1/renders/item1/v${RENDER_VERSION}/1-frames.json`))
    assert.ok(await blobs.get(`projects/p1/renders/item1/v${RENDER_VERSION}/1-frame-0.jpg`))

    const still = await renderer.still(ctx)
    const stillAgain = await renderer.still(ctx)
    assert.equal(counter.renders, 2)
    assert.ok(still.equals(stillAgain))
    assert.ok(await blobs.get(`projects/p1/renders/item1/v${RENDER_VERSION}/1-still.jpg`))
  })
})

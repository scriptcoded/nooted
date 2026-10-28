import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coverTopLayout, fitLayout, frameLayout, type Layout } from './thumb-frame.ts'

const at = (l: Layout, x: number, y: number) => [l.tx + l.scale * x, l.ty + l.scale * y]
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('fits the whole viewport, centred', () => {
  const l = fitLayout(1280, 720, 96, 64)
  near(l.scale, 0.075)
  near(l.tx, 0)
  near(l.ty, 5)
})

test('never upscales', () => {
  assert.equal(fitLayout(50, 30, 96, 64).scale, 1)
})

test('centres the selection in the tile', () => {
  const l = frameLayout([{ x: 600, y: 300, width: 100, height: 40 }], 1280, 720)
  const [cx, cy] = at(l, 650, 320)
  near(cx!, 48)
  near(cy!, 32)
})

test('keeps the frame inside the viewport near an edge', () => {
  const l = frameLayout([{ x: 0, y: 0, width: 60, height: 30 }], 1280, 720)
  near(l.tx, 0)
  near(l.ty, 0)
})

test('falls back to the viewport for a huge element and for no marks', () => {
  assert.deepEqual(frameLayout([{ x: 0, y: 0, width: 1280, height: 720 }], 1280, 720), fitLayout(1280, 720, 96, 64))
  assert.deepEqual(frameLayout([], 390, 844), fitLayout(390, 844, 96, 64))
})

test('cover anchored to the top fills the tile width and shows the top of a tall viewport', () => {
  const l = coverTopLayout(390, 844, 96, 64)
  near(l.scale, 96 / 390)
  near(l.tx, 0)
  near(l.ty, 0)
  assert.ok(844 * l.scale > 64)
})

test('cover fills the tile for a wide viewport too, centred horizontally', () => {
  const l = coverTopLayout(1280, 720, 96, 64)
  near(l.scale, 64 / 720)
  near(l.ty, 0)
  near(l.tx + l.scale * 640, 48)
})

test('generous padding for the large view, still never upscaled', () => {
  const l = frameLayout([{ x: 600, y: 300, width: 100, height: 40 }], 1280, 720, 900, 540, 160)
  assert.ok(l.scale <= 1)
  const [cx, cy] = at(l, 650, 320)
  near(cx!, 450)
  near(cy!, 270)
  // 160 px of context on every side of the selection is inside the frame
  const [x0] = at(l, 600 - 160, 0)
  assert.ok(x0! >= -1e-6)
})

test('a padded frame bigger than the viewport shrinks to it while the selection still fits', () => {
  // A phone: 160 px of context on both sides would be wider than the 390 px viewport.
  const rects = [{ x: 100, y: 400, width: 150, height: 50 }]
  const l = frameLayout(rects, 390, 844, 360, 216, 160)
  assert.ok(l.scale > 0)
  const [x0, y0] = at(l, 100, 400)
  const [x1, y1] = at(l, 250, 450)
  assert.ok(x0! >= 0 && y0! >= 0 && x1! <= 360 && y1! <= 216)
  // The whole page would be at 360/390; this is zoomed beyond that.
  assert.ok(l.scale >= 360 / 390 - 1e-6)
})

test('the frame fills the box at 1:1 when the selection is small', () => {
  const l = frameLayout([{ x: 600, y: 300, width: 100, height: 40 }], 1280, 720, 900, 540, 160)
  assert.equal(l.scale, 1)
})

// Where a replayed frame goes inside its box: screen = (tx, ty) + scale * (frame coordinates).
export interface Layout {
  scale: number
  tx: number
  ty: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The whole viewport, contained and centred. Never upscaled beyond 1:1. */
export function fitLayout(vw: number, vh: number, boxW: number, boxH: number): Layout {
  const scale = Math.min(1, boxW / vw, boxH / vh)
  return { scale, tx: (boxW - vw * scale) / 2, ty: (boxH - vh * scale) / 2 }
}

/** The viewport fills the box (cover) and is anchored to its top edge, centred horizontally. Used for tall captures. */
export function coverTopLayout(vw: number, vh: number, boxW: number, boxH: number): Layout {
  const scale = Math.max(boxW / vw, boxH / vh)
  return { scale, tx: (boxW - vw * scale) / 2, ty: 0 }
}

export const THUMB_W = 96
export const THUMB_H = 64
const PADDING = 24

/**
 * Frames the union of `rects` (viewport coordinates) in a box: padded, grown to the box's aspect ratio
 * around its centre and moved inside the viewport. Falls back to the whole viewport when that frame
 * wouldn't fit in it, or when there is nothing to frame.
 */
export function frameLayout(rects: Rect[], vw: number, vh: number, boxW = THUMB_W, boxH = THUMB_H, padding = PADDING): Layout {
  if (rects.length === 0) return fitLayout(vw, vh, boxW, boxH)
  const left = Math.min(...rects.map((r) => r.x)) - padding
  const top = Math.min(...rects.map((r) => r.y)) - padding
  const right = Math.max(...rects.map((r) => r.x + r.width)) + padding
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + padding
  const aspect = boxW / boxH
  let fw = right - left
  let fh = bottom - top
  if (fw / fh < aspect) fw = fh * aspect
  else fh = fw / aspect
  // A frame bigger than the viewport shrinks to it (same aspect) as long as the selection still fits inside.
  const shrink = Math.min(1, vw / fw, vh / fh)
  fw *= shrink
  fh *= shrink
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const contains = (x0: number, y0: number) =>
    x0 <= left + padding + 1e-6 && y0 <= top + padding + 1e-6 && x0 + fw >= right - padding - 1e-6 && y0 + fh >= bottom - padding - 1e-6
  const place = (c: number, size: number, max: number) => Math.min(Math.max(c - size / 2, 0), max - size)
  const fx = place(cx, fw, vw)
  const fy = place(cy, fh, vh)
  if (!contains(fx, fy)) return fitLayout(vw, vh, boxW, boxH)
  // Never upscale: when the frame is smaller than the box at 1:1, show as much page around it as the box holds.
  if (boxW / fw > 1) {
    const gw = Math.min(boxW, vw)
    const gh = Math.min(boxH, vh)
    const gx = place(cx, gw, vw)
    const gy = place(cy, gh, vh)
    return { scale: 1, tx: (boxW - gw) / 2 - gx, ty: (boxH - gh) / 2 - gy }
  }
  const scale = boxW / fw
  return { scale, tx: (boxW - fw * scale) / 2 - fx * scale, ty: (boxH - fh * scale) / 2 - fy * scale }
}

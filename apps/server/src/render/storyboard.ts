// Which moments of a recording become storyboard frames. The selection is pure; `renderStoryboard`
// draws the candidates in an open render session.
import { createHash } from 'node:crypto'
import type { Capture } from '@nooted/shared'
import { buildTimeline, formatEntry } from '../capture/timeline.ts'
import type { TimelineEntry } from '../capture/timeline.ts'
import type { Outline, RenderSession } from './page.ts'

export const MAX_FRAMES = 6
/** How long after an event its frame is taken, so click effects are visible. */
export const FRAME_DELAY_MS = 400

export type MomentKind = 'start' | 'click' | 'tap' | 'typing' | 'navigation' | 'error' | 'end' | 'idle-click'

export type Moment = {
  kind: MomentKind
  /** The event's time in ms from the start of the recording. */
  t: number
  /** When the frame is drawn: just after the event, clamped. */
  frameAt: number
  caption: string
  outlines: Outline[]
}

export type StoryboardFrame = { t: number; caption: string; image: Buffer }

// Lower number = kept first when there are too many moments.
const PRIORITY: Record<MomentKind, number> = { start: -1, end: -1, navigation: 0, click: 1, tap: 1, error: 2, typing: 3, 'idle-click': 4 }

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Keeps at most `max` moments: the first and the last, then by priority (navigation, click or tap on
 * something interactive, error, typing, click or tap on something else) and by time within a priority. The result is in time order.
 */
export function selectMoments<T extends { kind: MomentKind; t: number }>(moments: readonly T[], max = MAX_FRAMES): T[] {
  if (moments.length <= max) return [...moments]
  const keep = new Set<number>([0, moments.length - 1])
  const rest = moments
    .map((moment, index) => ({ moment, index }))
    .filter(({ index }) => !keep.has(index))
    .sort((a, b) => PRIORITY[a.moment.kind] - PRIORITY[b.moment.kind] || a.moment.t - b.moment.t || a.index - b.index)
  for (const { index } of rest) {
    if (keep.size >= max) break
    keep.add(index)
  }
  return moments.filter((_, index) => keep.has(index))
}

/** The moments of a recording, in time order, with their captions and what to outline. */
export function buildMoments(capture: Pick<Capture, 'events' | 'url'>, duration: number): Moment[] {
  const { entries } = buildTimeline(capture)
  const shorten = (href: string) => {
    try {
      const u = new URL(href)
      return u.origin === new URL(capture.url).origin ? u.pathname + u.search : href
    } catch {
      return href
    }
  }
  const caption = (t: number, what: string) => `${formatClock(t)}  ${what}`
  const moments: Moment[] = [{ kind: 'start', t: 0, frameAt: 0, caption: caption(0, 'start'), outlines: [] }]
  entries.forEach((entry, i) => {
    const kind = momentKind(entry)
    if (!kind) return
    // Just before the next entry when it comes sooner than the usual delay.
    const next = entries.slice(i + 1).find((e) => e.t > entry.t)
    let frameAt = entry.t + FRAME_DELAY_MS
    if (next && next.t - 1 < frameAt) frameAt = Math.max(entry.t, next.t - 1)
    frameAt = Math.min(frameAt, duration)
    const outlines: Outline[] = (entry.kind === 'click' || entry.kind === 'tap') && entry.nodeId !== undefined ? [{ nodeId: entry.nodeId }] : []
    moments.push({ kind, t: entry.t, frameAt, caption: caption(entry.t, formatEntry(entry, { href: shorten })), outlines })
  })
  moments.push({ kind: 'end', t: duration, frameAt: duration, caption: caption(duration, 'end'), outlines: [] })
  return moments
}

function momentKind(entry: TimelineEntry): MomentKind | undefined {
  switch (entry.kind) {
    case 'click':
    case 'tap':
      return entry.interactive === false ? 'idle-click' : entry.kind
    case 'typing':
    case 'navigation':
    case 'error':
      return entry.kind
    default:
      return undefined // resize and checkbox changes don't get frames of their own
  }
}

/** Draws the storyboard of a recording: dedup by clean-frame hash, select, then the outlined frames. */
export async function renderStoryboard(session: RenderSession, capture: Pick<Capture, 'events' | 'url'>): Promise<StoryboardFrame[]> {
  const candidates = buildMoments(capture, session.duration)
  const distinct: Moment[] = []
  let previous: string | undefined
  for (const moment of candidates) {
    await session.seek(moment.frameAt)
    const hash = createHash('sha256').update(await session.clean()).digest('hex')
    if (hash === previous) continue
    previous = hash
    distinct.push(moment)
  }
  const frames: StoryboardFrame[] = []
  for (const moment of selectMoments(distinct)) {
    await session.seek(moment.frameAt)
    frames.push({ t: moment.t, caption: moment.caption, image: await session.outlined(moment.outlines) })
  }
  return frames
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import type { Capture } from '@nooted/shared'
import type { BrowserManager } from './browser.ts'
import { RenderError } from './errors.ts'
import { restrictNetwork } from './network.ts'

/** Long side limit Claude downscales to; stills are drawn no larger than this. */
export const MAX_IMAGE_SIDE = 1568
export const RENDER_TIMEOUT_MS = 20_000
export const SETTLE_TIMEOUT_MS = 3_000

export type Rect = { x: number; y: number; width: number; height: number }
/**
 * An outline target: a rect in viewport coordinates, or a recorded node by rrweb id. The node's rect is
 * measured in the replay; `fallback` (viewport coordinates) is drawn when the node is missing or empty.
 */
export type Outline = Rect | { nodeId: number; fallback?: Rect }

export type ShotOptions = { format?: 'jpeg' | 'png' }

export type RenderSession = {
  /** Total span of the recording in ms from its first event. */
  duration: number
  /** Seeks the replay to `t` ms (default: the last frame) and waits for it to settle. */
  seek(t?: number): Promise<void>
  /** Screenshot of the viewport with nothing drawn on top. */
  clean(options?: ShotOptions): Promise<Buffer>
  /** Screenshot with outlines drawn over the replayed frame. */
  outlined(outlines: Outline[], options?: ShotOptions): Promise<Buffer>
  /** The replayed iframe document's HTML, for checks that need the rendered content. */
  frameHtml(): Promise<string>
}

export type SessionInput = {
  events: unknown[]
  viewport: { width: number; height: number }
  allowedOrigins: readonly string[]
  sdkDistDir: string
}

export type SessionOptions = {
  timeoutMs?: number
  settleMs?: number
}

// The in-page code below runs in the browser; the server has no DOM types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Anything = any

const SHELL_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;overflow:hidden}
#root{position:absolute;left:0;top:0}
.replayer-wrapper{position:absolute!important;left:0;top:0;transform:none!important}
.replayer-wrapper iframe{border:0!important}
.replayer-mouse,.replayer-mouse-tail{display:none!important}
.nooted-outline{position:absolute;box-sizing:border-box;outline:3px solid #ff2d55;box-shadow:0 0 0 5px #fff;pointer-events:none}
</style></head><body><div id="root"></div></body></html>`

export function stillScale(viewport: { width: number; height: number }): number {
  return Math.min(1, MAX_IMAGE_SIDE / Math.max(viewport.width, viewport.height))
}

/**
 * Opens a fresh, network-restricted browser context with the replay of `input`
 * loaded, runs `fn`, and always closes the context. The whole call, including
 * `fn`, is bounded by `timeoutMs` (default 20 s). Failures are RenderErrors.
 */
export async function withRenderSession<T>(
  manager: BrowserManager,
  input: SessionInput,
  fn: (session: RenderSession) => Promise<T>,
  options: SessionOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS
  const settleMs = options.settleMs ?? SETTLE_TIMEOUT_MS
  const replayJs = await readFile(join(input.sdkDistDir, 'replay.js'), 'utf8').catch((error: unknown) => {
    throw new RenderError('failed', 'The replay bundle is not available.', { cause: error })
  })

  return manager.withBrowser(async (browser) => {
    let context: BrowserContext | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const work = (async () => {
      context = await browser.newContext({
        viewport: input.viewport,
        deviceScaleFactor: stillScale(input.viewport),
        serviceWorkers: 'block',
        javaScriptEnabled: true,
      })
      await restrictNetwork(context, input.allowedOrigins)
      const page = await context.newPage()
      const duration = await openShell(page, replayJs, input.events)
      return fn(createSession(page, settleMs, duration, checkpointTimes(input.events)))
    })()
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(new RenderError('timeout', `Rendering took longer than ${timeoutMs} ms.`))
        // Closing the context rejects whatever `work` is still waiting on.
        void context?.close().catch(() => {})
      }, timeoutMs)
    })
    try {
      return await Promise.race([work, deadline])
    } catch (error) {
      if (error instanceof RenderError) throw error
      throw new RenderError(timedOut ? 'timeout' : 'failed', `Rendering failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error })
    } finally {
      clearTimeout(timer)
      work.catch(() => {})
      await context?.close().catch(() => {})
    }
  })
}

async function openShell(page: Page, replayJs: string, events: unknown[]): Promise<number> {
  await page.setContent(SHELL_HTML)
  await page.evaluate(() => {
    ;(globalThis as Anything).nooted = {}
  })
  await page.addScriptTag({ content: replayJs })
  return page.evaluate((evts) => {
    const g = globalThis as Anything
    const api = g.nooted?.p
    if (!api) throw new Error('The replay bundle did not register.')
    const style = g.document.createElement('style')
    style.textContent = api.css
    g.document.head.append(style)
    const root = g.document.getElementById('root')
    g.__replay = api.createReplayer(root, evts)
    return g.__replay.duration as number
  }, events)
}

/**
 * Times (ms from the first event) of the later full snapshots a recording takes (its checkpoints). rrweb
 * applies a checkpoint wrongly when one seek fast-forwards across both it and earlier mutations (attributes
 * changed before it come back stale), so seeks past a checkpoint hop to just before it first.
 */
function checkpointTimes(events: unknown[]): number[] {
  const list = events as Array<{ type?: number; timestamp?: number }>
  const start = list[0]?.timestamp
  if (typeof start !== 'number') return []
  const times: number[] = []
  list.forEach((event, i) => {
    // A checkpoint is a Meta event (4) followed by a full snapshot (2); the first pair is the recording's start.
    if (event.type === 4 && i > 0 && list[i + 1]?.type === 2 && typeof event.timestamp === 'number') times.push(event.timestamp - start)
  })
  return times
}

function createSession(page: Page, settleMs: number, duration: number, checkpoints: number[]): RenderSession {
  const seekOnce = (t: number | undefined) =>
    page.evaluate(
        async ([time, settle]) => {
          const g = globalThis as Anything
          const handle = g.__replay
          // Seeking back to before the first full snapshot (a few ms in) leaves rrweb on the current
          // frame, so the earliest frame drawn is the one at 10 ms.
          handle.pause(Math.min(handle.duration, Math.max(10, time ?? handle.duration)))
          const doc = handle.iframe.contentDocument
          const wait = async () => {
            await doc.fonts?.ready
            const images = [...doc.images] as Anything[]
            await Promise.all(
              images.map((img) => (img.complete ? undefined : new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true })
                img.addEventListener('error', resolve, { once: true })
              }))),
            )
          }
          await Promise.race([wait(), new Promise((resolve) => g.setTimeout(resolve, settle))])
          await new Promise((resolve) => g.requestAnimationFrame(() => g.requestAnimationFrame(resolve)))
        },
        [t ?? null, settleMs] as [number | null, number],
    )

  const shot = (options?: ShotOptions) =>
    options?.format === 'png' ? page.screenshot({ type: 'png' }) : page.screenshot({ type: 'jpeg', quality: 80 })

  return {
    duration,
    async seek(t) {
      const target = Math.min(duration, Math.max(10, t ?? duration))
      // Hop to just before each checkpoint at or before the target (see checkpointTimes), skipping any
      // that a hop already passed.
      let at = 0
      for (const checkpoint of checkpoints) {
        const before = checkpoint - 1
        if (checkpoint <= target && before > at && before >= 10) {
          await seekOnce(before)
          at = before
        }
      }
      await seekOnce(t)
    },
    clean: async (options) => {
      await page.evaluate(() => {
        for (const el of (globalThis as Anything).document.querySelectorAll('.nooted-outline')) el.remove()
      })
      return shot(options)
    },
    outlined: async (outlines, options) => {
      await page.evaluate((targets) => {
        const g = globalThis as Anything
        for (const el of g.document.querySelectorAll('.nooted-outline')) el.remove()
        for (const target of targets) {
          let rect = 'nodeId' in target ? g.__replay.nodeRect(target.nodeId) : target
          if ('nodeId' in target && (!rect || rect.width <= 0 || rect.height <= 0)) rect = target.fallback
          if (!rect) continue
          const div = g.document.createElement('div')
          div.className = 'nooted-outline'
          div.style.left = `${rect.x}px`
          div.style.top = `${rect.y}px`
          div.style.width = `${rect.width}px`
          div.style.height = `${rect.height}px`
          g.document.body.append(div)
        }
      }, outlines)
      return shot(options)
    },
    frameHtml: () => page.evaluate(() => (globalThis as Anything).__replay.iframe.contentDocument.documentElement.outerHTML as string),
  }
}

/**
 * Marks of a point capture as outlines. Each follows its node in the replay, so layout differences between
 * the reporter's browser and this one do not shift it; the recorded rect minus the capture's scroll (like
 * the console) is the fallback when the node is not in the snapshot.
 */
export function markOutlines(capture: Pick<Capture, 'marks' | 'scroll'>): Outline[] {
  return capture.marks.map((mark) => ({
    nodeId: mark.nodeId,
    fallback: {
      x: mark.rect.x - capture.scroll.x,
      y: mark.rect.y - capture.scroll.y,
      width: mark.rect.width,
      height: mark.rect.height,
    },
  }))
}

export type StillInput = {
  capture: Pick<Capture, 'events' | 'viewport' | 'marks' | 'scroll'>
  allowedOrigins: readonly string[]
  sdkDistDir: string
}

/** Draws a capture's final frame with its marks outlined. JPEG unless `format` says otherwise. */
export function renderStill(
  manager: BrowserManager,
  input: StillInput,
  options: SessionOptions & ShotOptions = {},
): Promise<Buffer> {
  const { capture } = input
  return withRenderSession(
    manager,
    { events: capture.events, viewport: capture.viewport, allowedOrigins: input.allowedOrigins, sdkDistDir: input.sdkDistDir },
    async (session) => {
      await session.seek()
      return session.outlined(markOutlines(capture), options)
    },
    options,
  )
}

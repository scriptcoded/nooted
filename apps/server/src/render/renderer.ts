import type { Capture } from '@nooted/shared'
import type { BlobStore } from '../blobs.ts'
import type { Config } from '../config.ts'
import { createBrowserManager } from './browser.ts'
import type { BrowserManager } from './browser.ts'
import { createRenderCache } from './cache.ts'
import { renderStill, withRenderSession } from './page.ts'
import { renderStoryboard } from './storyboard.ts'
import type { StoryboardFrame } from './storyboard.ts'

export type RenderContext = {
  projectId: string
  itemId: string
  capture: Capture
  /** The project's allowed origins: the only hosts the render may load from. */
  allowedOrigins: readonly string[]
}

/** What the MCP tools use to draw captures. Rejects with a RenderError when an image can't be drawn. */
export interface CaptureRenderer {
  /** False when images are turned off or the browser recently failed to launch. */
  available(): boolean
  /** A capture's still: a point capture with its marks outlined, or a recording's last frame. */
  still(ctx: RenderContext): Promise<Buffer>
  /** A recording's storyboard: at most 6 captioned frames in time order. */
  frames(ctx: RenderContext): Promise<StoryboardFrame[]>
  close(): Promise<void>
}

export function createCaptureRenderer(deps: { config: Pick<Config, 'captureImages' | 'chromiumPath' | 'sdkDistDir'>; blobs: BlobStore; manager?: BrowserManager }): CaptureRenderer {
  const manager =
    deps.manager ??
    createBrowserManager({ mode: deps.config.captureImages, ...(deps.config.chromiumPath ? { chromiumPath: deps.config.chromiumPath } : {}) })
  const cache = createRenderCache(deps.blobs)
  const { sdkDistDir } = deps.config
  const target = (ctx: RenderContext) => ({ projectId: ctx.projectId, itemId: ctx.itemId, n: ctx.capture.n })

  return {
    available: () => manager.isAvailable(),
    still: (ctx) =>
      cache.still(target(ctx), () => renderStill(manager, { capture: ctx.capture, allowedOrigins: ctx.allowedOrigins, sdkDistDir })),
    frames: (ctx) =>
      cache.frames(target(ctx), () =>
        withRenderSession(
          manager,
          { events: ctx.capture.events, viewport: ctx.capture.viewport, allowedOrigins: ctx.allowedOrigins, sdkDistDir },
          (session) => renderStoryboard(session, ctx.capture),
        ),
      ),
    close: () => manager.close(),
  }
}

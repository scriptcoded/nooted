// Rendered images live in the blob store under the project's prefix, so deleting a project deletes
// them. Reports never change, so a render is valid until RENDER_VERSION is bumped.
import type { BlobStore } from '../blobs.ts'
import type { StoryboardFrame } from './storyboard.ts'

/** Bump when drawing changes; renders of older versions are ignored. */
export const RENDER_VERSION = 2

export type CacheTarget = { projectId: string; itemId: string; n: number }

const prefix = ({ projectId, itemId }: CacheTarget) => `projects/${projectId}/renders/${itemId}/v${RENDER_VERSION}/`
export const stillKey = (target: CacheTarget) => `${prefix(target)}${target.n}-still.jpg`
export const manifestKey = (target: CacheTarget) => `${prefix(target)}${target.n}-frames.json`
export const frameKey = (target: CacheTarget, i: number) => `${prefix(target)}${target.n}-frame-${i}.jpg`

export type RenderCache = {
  still(target: CacheTarget, render: () => Promise<Buffer>): Promise<Buffer>
  frames(target: CacheTarget, render: () => Promise<StoryboardFrame[]>): Promise<StoryboardFrame[]>
}

export function createRenderCache(blobs: BlobStore): RenderCache {
  // Concurrent requests for the same key share one render. Rejections are never stored anywhere.
  const inflight = new Map<string, Promise<unknown>>()
  const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>
    const promise = run().finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  return {
    still: (target, render) =>
      once(stillKey(target), async () => {
        const hit = await blobs.get(stillKey(target))
        if (hit) return Buffer.from(hit)
        const image = await render()
        await blobs.put(stillKey(target), image)
        return image
      }),

    frames: (target, render) =>
      once(manifestKey(target), async () => {
        const manifest = await blobs.get(manifestKey(target))
        if (manifest) {
          const cached = await readFrames(blobs, target, manifest)
          if (cached) return cached
        }
        const frames = await render()
        // Frames first and the manifest last, so a manifest always points at complete frames.
        await Promise.all(frames.map((frame, i) => blobs.put(frameKey(target, i), frame.image)))
        const body = { frames: frames.map(({ t, caption }) => ({ t, caption })) }
        await blobs.put(manifestKey(target), Buffer.from(JSON.stringify(body)))
        return frames
      }),
  }
}

async function readFrames(blobs: BlobStore, target: CacheTarget, manifest: Uint8Array): Promise<StoryboardFrame[] | null> {
  try {
    const parsed = JSON.parse(Buffer.from(manifest).toString('utf8')) as { frames: { t: number; caption: string }[] }
    const frames: StoryboardFrame[] = []
    for (const [i, meta] of parsed.frames.entries()) {
      const image = await blobs.get(frameKey(target, i))
      if (!image) return null
      frames.push({ t: meta.t, caption: meta.caption, image: Buffer.from(image) })
    }
    return frames
  } catch {
    return null
  }
}

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { AppDeps } from '../app.ts'

const BUNDLES = {
  'nooted.js': 'text/javascript; charset=utf-8',
  'nooted.js.map': 'application/json',
  'replay.js': 'text/javascript; charset=utf-8',
  'replay.js.map': 'application/json',
} as const

type Entry = { mtimeMs: number; body: string; etag: string }

// Mounted at /sdk, outside auth and CORS: a plain <script src> load needs neither.
export function createSdkBundleRoutes(deps: AppDeps) {
  const { sdkDistDir } = deps.config
  // Keyed by file path. An entry is reused until the file's mtime changes.
  const cache = new Map<string, Entry>()
  let warnedMissing = false

  async function load(file: string): Promise<Entry | null> {
    let mtimeMs: number
    try {
      mtimeMs = (await stat(file)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    }
    const cached = cache.get(file)
    if (cached && cached.mtimeMs === mtimeMs) return cached
    const body = await readFile(file, 'utf8')
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
    const entry = { mtimeMs, body, etag }
    cache.set(file, entry)
    return entry
  }

  const app = new Hono()
  for (const [name, contentType] of Object.entries(BUNDLES)) {
    app.get(`/v1/${name}`, async (c) => {
      const entry = await load(join(sdkDistDir, name))
      if (!entry) {
        if (!warnedMissing) {
          warnedMissing = true
          console.warn(`[nooted] SDK bundle not found at ${join(sdkDistDir, name)}. Run pnpm --filter @nooted/sdk build.`)
        }
        return c.json({ error: 'not_found' as const }, 404)
      }
      const headers = {
        ETag: entry.etag,
        'Cache-Control': 'no-cache',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      }
      if (matchesEtag(c.req.header('if-none-match'), entry.etag)) return c.body(null, 304, headers)
      return c.body(entry.body, 200, { ...headers, 'Content-Type': contentType })
    })
  }
  return app
}

// Handles lists and weak validators, which browsers may send.
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag)
}

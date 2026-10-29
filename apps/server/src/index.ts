import { existsSync, mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from './app.ts'
import { createOidcProvider } from './auth/oidc.ts'
import { createFsBlobStore } from './blobs.ts'
import { frameHeaders } from './frame-headers.ts'
import { loadConfig } from './config.ts'
import { migrateToLatest } from './db/migrate.ts'
import { createKysely, openDatabase } from './db/node-sqlite-adapter.ts'
import type { DB } from './db/schema.ts'
import { cleanupOauth } from './oauth/cleanup.ts'
import { createCaptureRenderer } from './render/renderer.ts'
import { createShutdown } from './shutdown.ts'

const config = loadConfig()

mkdirSync(config.dataDir, { recursive: true })
const db = createKysely<DB>(openDatabase(join(config.dataDir, 'nooted.db')))
await migrateToLatest(db)
const runOauthCleanup = () => cleanupOauth(db).catch((error) => console.error('OAuth cleanup failed', error))
await runOauthCleanup()
setInterval(runOauthCleanup, 60 * 60 * 1000).unref()
const blobs = createFsBlobStore(join(config.dataDir, 'blobs'))

const oidc = createOidcProvider({
  issuer: config.oidcIssuer,
  clientId: config.oidcClientId,
  clientSecret: config.oidcClientSecret,
})

// Explicit WEB_DIST_DIR wins. In production without one, use the web build next to this package.
const webDistDir =
  config.webDistDir ??
  (process.env.NODE_ENV === 'production'
    ? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
    : undefined)

const renderer = createCaptureRenderer({ config, blobs })
// Signals are handled by the shutdown below (Playwright's own handlers are off); this covers a normal exit.
process.on('exit', () => void renderer.close())

const app = new Hono().route('/', createApp({ config, db, blobs, oidc, renderer }))

if (webDistDir) {
  if (!existsSync(join(webDistDir, 'index.html'))) {
    throw new Error(`Web build not found: ${join(webDistDir, 'index.html')} is missing (run pnpm --filter @nooted/web build)`)
  }
  // Server-owned paths never fall back to the SPA, so unknown API calls keep their 404.
  const serverOwned = (path: string) => ['/api', '/auth', '/sdk', '/oauth', '/.well-known', '/mcp'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  const files = serveStatic({ root: webDistDir })
  const index = serveStatic({ root: webDistDir, path: 'index.html' })
  app.get('*', frameHeaders, (c, next) => (serverOwned(c.req.path) ? c.notFound() : next()), files, index)
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`nooted server listening on http://localhost:${info.port}`)
})

const shutdown = createShutdown({
  server: server as Server, // plain HTTP, so never the HTTP/2 variant of ServerType
  closers: [() => renderer.close(), () => db.destroy()],
  exit: process.exit,
  log: (line) => console.log(line),
})
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

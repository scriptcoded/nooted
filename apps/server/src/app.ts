import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Kysely } from 'kysely'
import { requireUser } from './auth/middleware.ts'
import type { OidcProvider } from './auth/oidc.ts'
import { createAuthRoutes } from './auth/routes.ts'
import type { BlobStore } from './blobs.ts'
import type { Config } from './config.ts'
import type { DB } from './db/schema.ts'
import { createProjectRoutes } from './projects/routes.ts'
import { createSdkBundleRoutes } from './sdk/bundle.ts'
import { createSdkApiRoutes } from './sdk/routes.ts'
import { createSdkSignInRoutes } from './sdk/sign-in.ts'

export type AppDeps = {
  config: Config
  db: Kysely<DB>
  blobs: BlobStore
  oidc: OidcProvider
}

// No CORS on the console API: it is same-origin. SDK routes add their own CORS.
export function createApp(deps: AppDeps) {
  const api = new Hono()
    .get('/health', (c) => c.json({ status: 'ok' as const }))
    .get('/me', requireUser(deps), (c) => c.json(c.var.user))
    .route('/projects', createProjectRoutes(deps))
    .route('/sdk', createSdkApiRoutes(deps))

  return new Hono()
    .use(logger())
    .route('/api', api)
    .route('/auth', createAuthRoutes(deps))
    .route('/sdk', createSdkBundleRoutes(deps))
    .route('/sdk', createSdkSignInRoutes(deps))
}

export type AppType = ReturnType<typeof createApp>

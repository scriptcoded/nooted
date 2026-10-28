import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Kysely } from 'kysely'
import { requireUser } from './auth/middleware.ts'
import type { OidcProvider } from './auth/oidc.ts'
import { createAuthRoutes } from './auth/routes.ts'
import type { BlobStore } from './blobs.ts'
import { frameHeaders } from './frame-headers.ts'
import type { Config } from './config.ts'
import type { DB } from './db/schema.ts'
import { createMcpRoutes } from './mcp/routes.ts'
import type { CaptureRenderer } from './render/renderer.ts'
import { createOauthApiRoutes, createOauthRoutes } from './oauth/routes.ts'
import type { OauthHooks } from './oauth/shared.ts'
import { createProjectRoutes } from './projects/routes.ts'
import { createSdkBundleRoutes } from './sdk/bundle.ts'
import { createSdkApiRoutes } from './sdk/routes.ts'
import { createSdkSignInRoutes } from './sdk/sign-in.ts'

export type AppDeps = {
  config: Config
  db: Kysely<DB>
  blobs: BlobStore
  oidc: OidcProvider
  /** Draws capture images for MCP. Absent means images aren't available. */
  renderer?: CaptureRenderer
  /** Test hooks: a fake clock and the registration rate limiter. */
  oauth?: OauthHooks
}

// No CORS on the console API: it is same-origin. SDK routes add their own CORS.
export function createApp(deps: AppDeps) {
  const api = new Hono()
    .get('/health', (c) => c.json({ status: 'ok' as const }))
    .get('/me', requireUser(deps), (c) => c.json(c.var.user))
    .route('/projects', createProjectRoutes(deps))
    .route('/sdk', createSdkApiRoutes(deps))
    .route('/oauth', createOauthApiRoutes(deps))

  return new Hono()
    .use(logger())
    .use(frameHeaders)
    .route('/api', api)
    .route('/auth', createAuthRoutes(deps))
    .route('/', createOauthRoutes(deps))
    .route('/', createMcpRoutes(deps))
    .route('/sdk', createSdkBundleRoutes(deps))
    .route('/sdk', createSdkSignInRoutes(deps))
}

export type AppType = ReturnType<typeof createApp>

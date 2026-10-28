import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuthorizeRoutes } from './authorize.ts'
import { createOauthConsoleRoutes } from './console-api.ts'
import { createDiscoveryRoutes } from './discovery.ts'
import { createRegisterRoutes } from './register.ts'
import type { OauthDeps } from './shared.ts'
import { createTokenRoutes } from './token.ts'

// Browser-based MCP clients call discovery, registration, token and revocation cross-origin. No credentials
// are involved, so a wildcard origin is safe. /oauth/authorize and the console API stay without CORS.
const publicCors = cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'], maxAge: 600 })

// Mounted at the root: /.well-known/* and /oauth/*.
export function createOauthRoutes(deps: OauthDeps) {
  return new Hono()
    .use('/.well-known/*', publicCors)
    .use('/oauth/token', publicCors)
    .use('/oauth/register', publicCors)
    .use('/oauth/revoke', publicCors)
    .route('/.well-known', createDiscoveryRoutes(deps))
    .route('/oauth', createRegisterRoutes(deps))
    .route('/oauth', createAuthorizeRoutes(deps))
    .route('/oauth', createTokenRoutes(deps))
}

// Mounted at /api/oauth (session required).
export { createOauthConsoleRoutes as createOauthApiRoutes }

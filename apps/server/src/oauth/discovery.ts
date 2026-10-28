import { Hono } from 'hono'
import { SCOPES, resourceUrl } from './shared.ts'
import type { OauthDeps } from './shared.ts'

export function createDiscoveryRoutes(deps: OauthDeps) {
  const issuer = deps.config.publicUrl
  const protectedResource = {
    resource: resourceUrl(deps.config),
    authorization_servers: [issuer],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
  }
  const authorizationServer = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
  }
  return new Hono()
    .get('/oauth-protected-resource', (c) => c.json(protectedResource))
    .get('/oauth-protected-resource/mcp', (c) => c.json(protectedResource))
    .get('/oauth-authorization-server', (c) => c.json(authorizationServer))
}

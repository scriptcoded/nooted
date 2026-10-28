import type { AuthUser } from '../auth/middleware.ts'
import { isInstanceAdmin } from '../auth/middleware.ts'
import { ACCESS_PREFIX, SCOPES, hashSecret, nowOf, resourceUrl, splitScopes } from './shared.ts'
import type { OauthDeps } from './shared.ts'

export type BearerAuth = { user: AuthUser; grantId: string; clientId: string; scopes: string[] }
export type BearerResult = BearerAuth | { error: 'missing' | 'invalid' }

const LAST_USED_THROTTLE_MS = 60_000

/** Authenticates an MCP access token from the Authorization header. Used only by /mcp. */
export async function authenticateBearer(deps: OauthDeps, request: Request): Promise<BearerResult> {
  const header = request.headers.get('authorization')
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null
  if (!match?.[1]) return { error: 'missing' }
  const token = match[1]
  if (!token.startsWith(ACCESS_PREFIX)) return { error: 'invalid' }

  const now = nowOf(deps)
  const row = await deps.db
    .selectFrom('oauth_tokens')
    .innerJoin('oauth_grants', 'oauth_grants.id', 'oauth_tokens.grant_id')
    .innerJoin('oauth_clients', 'oauth_clients.id', 'oauth_grants.client_id')
    .innerJoin('users', 'users.id', 'oauth_grants.user_id')
    .select([
      'oauth_tokens.scopes as token_scopes',
      'oauth_grants.id as grant_id',
      'oauth_grants.scopes as grant_scopes',
      'oauth_grants.last_used_at',
      'oauth_clients.id as client_id',
      'users.id as user_id',
      'users.email',
      'users.email_verified',
      'users.name',
    ])
    .where('oauth_tokens.hash', '=', hashSecret(token))
    .where('oauth_tokens.kind', '=', 'access')
    .where('oauth_tokens.expires_at', '>', now)
    .where('oauth_tokens.revoked_at', 'is', null)
    .where('oauth_tokens.resource', '=', resourceUrl(deps.config))
    .where('oauth_grants.revoked_at', 'is', null)
    .executeTakeFirst()
  if (!row) return { error: 'invalid' }

  if (row.last_used_at === null || row.last_used_at < now - LAST_USED_THROTTLE_MS) {
    await deps.db.updateTable('oauth_grants').set({ last_used_at: now }).where('id', '=', row.grant_id).execute()
  }
  return {
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      isAdmin: isInstanceAdmin(deps.config, { email: row.email, email_verified: row.email_verified }),
    },
    grantId: row.grant_id,
    clientId: row.client_id,
    // Intersect with the grant's current scopes so a narrowing re-consent applies to existing tokens.
    scopes: splitScopes(row.token_scopes).filter(
      (s) => (SCOPES as readonly string[]).includes(s) && splitScopes(row.grant_scopes).includes(s),
    ),
  }
}

/** The WWW-Authenticate value for a 401 from /mcp. */
export function bearerChallenge(publicUrl: string, error?: 'missing' | 'invalid'): string {
  const base = `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`
  return error === 'invalid' ? `${base}, error="invalid_token"` : base
}

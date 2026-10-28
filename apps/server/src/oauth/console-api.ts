import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware.ts'
import type { AuthEnv } from '../auth/middleware.ts'
import { validate } from '../validation.ts'
import { CODE_TTL_MS, hashSecret, nowOf, randomToken, requireJson, requireSameOrigin, revokeGrant, splitScopes } from './shared.ts'
import type { OauthDeps } from './shared.ts'

const decisionBody = z.object({ approve: z.boolean() })
const notFound = { error: 'not_found' as const }

// Console routes for the consent page and the Connected agents page. Session cookie only.
export function createOauthConsoleRoutes(deps: OauthDeps) {
  const { config, db } = deps
  const sameOrigin = requireSameOrigin(deps)

  return new Hono<AuthEnv>()
    .use(requireUser(deps))
    .get('/requests/:id', async (c) => {
      const row = await db
        .selectFrom('oauth_requests')
        .innerJoin('oauth_clients', 'oauth_clients.id', 'oauth_requests.client_id')
        .select(['oauth_clients.name', 'oauth_requests.redirect_uri', 'oauth_requests.scopes'])
        .where('oauth_requests.id', '=', c.req.param('id'))
        .where('oauth_requests.user_id', '=', c.var.user.id)
        .where('oauth_requests.used_at', 'is', null)
        .where('oauth_requests.expires_at', '>', nowOf(deps))
        .executeTakeFirst()
      if (!row) return c.json(notFound, 404)
      return c.json({
        clientName: row.name,
        redirectHost: new URL(row.redirect_uri).host,
        scopes: splitScopes(row.scopes),
        email: c.var.user.email,
      })
    })
    .post('/requests/:id/decision', sameOrigin, requireJson(), validate('json', decisionBody), async (c) => {
      const { approve } = c.req.valid('json')
      const now = nowOf(deps)
      // Single use: only one concurrent decision can claim the request.
      const request = await db
        .updateTable('oauth_requests')
        .set({ used_at: now })
        .where('id', '=', c.req.param('id'))
        .where('user_id', '=', c.var.user.id)
        .where('used_at', 'is', null)
        .where('expires_at', '>', now)
        .returningAll()
        .executeTakeFirst()
      if (!request) return c.json(notFound, 404)

      const target = new URL(request.redirect_uri)
      if (!approve) {
        target.searchParams.set('error', 'access_denied')
        if (request.state !== null) target.searchParams.set('state', request.state)
        target.searchParams.set('iss', config.publicUrl)
        return c.json({ redirectTo: target.toString() })
      }

      const code = randomToken(32)
      await db.transaction().execute(async (trx) => {
        // One statement, so two concurrent first-time approvals for the same (user, client) cannot both insert.
        const grant = await trx
          .insertInto('oauth_grants')
          .values({
            id: randomToken(16),
            user_id: request.user_id,
            client_id: request.client_id,
            scopes: request.scopes,
            created_at: now,
            last_used_at: null,
            revoked_at: null,
          })
          .onConflict((oc) =>
            oc.columns(['user_id', 'client_id']).where('revoked_at', 'is', null).doUpdateSet({ scopes: request.scopes }),
          )
          .returning('id')
          .executeTakeFirstOrThrow()
        const grantId = grant.id
        await trx
          .insertInto('oauth_codes')
          .values({
            hash: hashSecret(code),
            grant_id: grantId,
            request_id: request.id,
            redirect_uri: request.redirect_uri,
            code_challenge: request.code_challenge,
            resource: request.resource,
            scopes: request.scopes,
            expires_at: now + CODE_TTL_MS,
            used_at: null,
          })
          .execute()
      })
      target.searchParams.set('code', code)
      if (request.state !== null) target.searchParams.set('state', request.state)
      target.searchParams.set('iss', config.publicUrl)
      return c.json({ redirectTo: target.toString() })
    })
    .get('/grants', async (c) => {
      const rows = await db
        .selectFrom('oauth_grants')
        .innerJoin('oauth_clients', 'oauth_clients.id', 'oauth_grants.client_id')
        .select([
          'oauth_grants.id',
          'oauth_clients.name',
          'oauth_grants.scopes',
          'oauth_grants.created_at',
          'oauth_grants.last_used_at',
        ])
        .where('oauth_grants.user_id', '=', c.var.user.id)
        .where('oauth_grants.revoked_at', 'is', null)
        .orderBy('oauth_grants.created_at', 'desc')
        .execute()
      return c.json(
        rows.map((r) => ({
          id: r.id,
          clientName: r.name,
          scopes: splitScopes(r.scopes),
          createdAt: r.created_at,
          lastUsedAt: r.last_used_at,
        })),
      )
    })
    .delete('/grants/:id', sameOrigin, async (c) => {
      const grant = await db
        .selectFrom('oauth_grants')
        .select('id')
        .where('id', '=', c.req.param('id'))
        .where('user_id', '=', c.var.user.id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst()
      if (!grant) return c.json(notFound, 404)
      await revokeGrant(db, grant.id, nowOf(deps))
      return c.body(null, 204)
    })
}

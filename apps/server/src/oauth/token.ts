import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import type { Kysely } from 'kysely'
import type { DB } from '../db/schema.ts'
import {
  ACCESS_PREFIX,
  BODY_LIMIT,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  hashSecret,
  nowOf,
  noStoreHeaders,
  oauthError,
  parseScopes,
  randomToken,
  revokeGrant,
  splitScopes,
} from './shared.ts'
import type { OauthDeps } from './shared.ts'

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/

// null: unsupported content type or malformed body. 'duplicate': a parameter was sent twice (RFC 6749 3.1).
async function readParams(c: Context): Promise<Record<string, string> | null | 'duplicate'> {
  const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  const out: Record<string, string> = Object.create(null) as Record<string, string>
  try {
    if (type === 'application/x-www-form-urlencoded') {
      const form = new URLSearchParams(await c.req.text())
      for (const [k, v] of form) {
        if (Object.hasOwn(out, k)) return 'duplicate'
        out[k] = v
      }
      return out
    }
    // Lenient: some clients send JSON.
    if (type === 'application/json') {
      const body: unknown = await c.req.json()
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
      for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v
      return out
    }
  } catch {
    return null
  }
  return null
}

const hashChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(hashChallenge(verifier))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}

/** Marker stored in oauth_codes.expires_at once a code has been replayed. */
const REPLAYED = -1

const intersectScopes = (a: string, b: string): string => {
  const allowed = splitScopes(b)
  return splitScopes(a).filter((s) => allowed.includes(s)).join(' ')
}

async function revokeFamily(db: Kysely<DB>, grantId: string, family: string, now: number): Promise<void> {
  await db.updateTable('oauth_tokens').set({ revoked_at: now }).where('grant_id', '=', grantId).where('family', '=', family).where('revoked_at', 'is', null).execute()
}

type Issue = { grantId: string; clientId: string; family: string; scopes: string; resource: string }

async function issueTokens(db: Kysely<DB>, issue: Issue, now: number) {
  const access = ACCESS_PREFIX + randomToken(32)
  const refresh = REFRESH_PREFIX + randomToken(32)
  await db.transaction().execute(async (trx) => {
    const base = { grant_id: issue.grantId, family: issue.family, scopes: issue.scopes, resource: issue.resource, used_at: null, revoked_at: null, created_at: now }
    await trx.insertInto('oauth_tokens').values({ ...base, hash: hashSecret(access), kind: 'access', expires_at: now + ACCESS_TOKEN_TTL_MS }).execute()
    await trx.insertInto('oauth_tokens').values({ ...base, hash: hashSecret(refresh), kind: 'refresh', expires_at: now + REFRESH_TOKEN_TTL_MS }).execute()
    await trx.updateTable('oauth_grants').set({ last_used_at: now }).where('id', '=', issue.grantId).execute()
    await trx.updateTable('oauth_clients').set({ last_used_at: now }).where('id', '=', issue.clientId).execute()
  })
  return { access, refresh }
}

export function createTokenRoutes(deps: OauthDeps) {
  const { db } = deps
  const invalidGrant = (c: Context, description = 'The grant is invalid, expired or revoked') =>
    oauthError(c, 400, 'invalid_grant', description)
  const respond = (c: Context, tokens: { access: string; refresh: string }, scopes: string) =>
    c.json(
      {
        access_token: tokens.access,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_MS / 1000,
        refresh_token: tokens.refresh,
        scope: scopes,
      },
      200,
      noStoreHeaders,
    )

  const tooLarge = bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) => c.json({ error: 'invalid_request', error_description: 'Request body too large' }, 413),
  })

  return new Hono()
    .post('/token', tooLarge, async (c) => {
      c.header('Cache-Control', 'no-store')
      c.header('Pragma', 'no-cache')
      const params = await readParams(c)
      if (params === 'duplicate') return oauthError(c, 400, 'invalid_request', 'Parameters must not be repeated')
      if (!params) return oauthError(c, 400, 'invalid_request', 'Send application/x-www-form-urlencoded parameters')
      const clientId = params.client_id
      if (!clientId) return oauthError(c, 400, 'invalid_request', 'client_id is required')
      const client = await db.selectFrom('oauth_clients').select('id').where('id', '=', clientId).executeTakeFirst()
      if (!client) return oauthError(c, 401, 'invalid_client', 'Unknown client')
      const now = nowOf(deps)

      if (params.grant_type === 'authorization_code') {
        const { code, redirect_uri: redirectUri, code_verifier: verifier } = params
        if (!code || !redirectUri || !verifier) {
          return oauthError(c, 400, 'invalid_request', 'code, redirect_uri and code_verifier are required')
        }
        if (!VERIFIER.test(verifier)) return oauthError(c, 400, 'invalid_request', 'code_verifier must be 43 to 128 URL-safe characters')
        const hash = hashSecret(code)
        const row = await db.selectFrom('oauth_codes').selectAll().where('hash', '=', hash).executeTakeFirst()
        if (!row) return invalidGrant(c)
        // Claim the code atomically; it is consumed whatever happens next.
        const claimed = await db
          .updateTable('oauth_codes')
          .set({ used_at: now })
          .where('hash', '=', hash)
          .where('used_at', 'is', null)
          .where('expires_at', '>', now)
          .returning('hash')
          .executeTakeFirst()
        const grant = await db.selectFrom('oauth_grants').selectAll().where('id', '=', row.grant_id).executeTakeFirst()
        if (!claimed) {
          // A code presented twice suggests it was stolen (RFC 6749 4.1.2). Revoke only the tokens this code
          // produced; the grant's other tokens are unaffected. The claim may have failed because a concurrent
          // exchange won, so re-read the row: used_at tells a replay from an expired or unclaimable code.
          const current = await db.selectFrom('oauth_codes').select('used_at').where('hash', '=', hash).executeTakeFirst()
          if (current?.used_at != null && grant && grant.client_id === client.id) {
            // Marker for the winner, whose token insert may not have happened yet; it re-checks after issuing.
            await db.updateTable('oauth_codes').set({ expires_at: REPLAYED }).where('hash', '=', hash).execute()
            await revokeFamily(db, grant.id, hash, now)
          }
          return invalidGrant(c)
        }
        if (!grant || grant.revoked_at !== null || grant.client_id !== client.id) return invalidGrant(c)
        if (row.redirect_uri !== redirectUri) return invalidGrant(c, 'redirect_uri does not match')
        if (params.resource !== undefined && params.resource !== row.resource) {
          return oauthError(c, 400, 'invalid_target', 'resource does not match the authorization request')
        }
        if (!pkceMatches(verifier, row.code_challenge)) return invalidGrant(c, 'PKCE verification failed')

        const scopes = intersectScopes(row.scopes, grant.scopes)
        if (scopes === '') return invalidGrant(c)
        const tokens = await issueTokens(
          db,
          { grantId: grant.id, clientId: client.id, family: hash, scopes, resource: row.resource },
          now,
        )
        const after = await db.selectFrom('oauth_codes').select('expires_at').where('hash', '=', hash).executeTakeFirst()
        if (after?.expires_at === REPLAYED) {
          await revokeFamily(db, grant.id, hash, now)
          return invalidGrant(c)
        }
        return respond(c, tokens, scopes)
      }

      if (params.grant_type === 'refresh_token') {
        const presented = params.refresh_token
        if (!presented) return oauthError(c, 400, 'invalid_request', 'refresh_token is required')
        const hash = hashSecret(presented)
        const token = await db.selectFrom('oauth_tokens').selectAll().where('hash', '=', hash).where('kind', '=', 'refresh').executeTakeFirst()
        if (!token) return invalidGrant(c)
        const grant = await db.selectFrom('oauth_grants').selectAll().where('id', '=', token.grant_id).executeTakeFirst()
        if (!grant || grant.client_id !== client.id) return invalidGrant(c)
        if (token.used_at !== null) {
          await revokeGrant(db, grant.id, now)
          return invalidGrant(c)
        }
        if (grant.revoked_at !== null || token.revoked_at !== null || token.expires_at <= now) return invalidGrant(c)

        // A re-consent may have narrowed the grant since this token was issued.
        let scopes = intersectScopes(token.scopes, grant.scopes)
        if (scopes === '') return invalidGrant(c)
        if (params.scope !== undefined) {
          const requested = parseScopes(params.scope)
          const allowed = splitScopes(scopes)
          if (!requested || !requested.every((s) => allowed.includes(s))) {
            return oauthError(c, 400, 'invalid_scope', 'Scopes cannot be widened')
          }
          scopes = requested.join(' ')
        }
        const claimed = await db
          .updateTable('oauth_tokens')
          .set({ used_at: now })
          .where('hash', '=', hash)
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .returning('hash')
          .executeTakeFirst()
        if (!claimed) {
          // Lost a race with another use of the same refresh token.
          await revokeGrant(db, grant.id, now)
          return invalidGrant(c)
        }
        const tokens = await issueTokens(
          db,
          { grantId: grant.id, clientId: client.id, family: token.family, scopes, resource: token.resource },
          now,
        )
        return respond(c, tokens, scopes)
      }

      return oauthError(c, 400, 'unsupported_grant_type', 'Supported: authorization_code, refresh_token')
    })
    .post('/revoke', tooLarge, async (c) => {
      c.header('Cache-Control', 'no-store')
      const params = await readParams(c)
      if (params === 'duplicate') return oauthError(c, 400, 'invalid_request', 'Parameters must not be repeated')
      if (!params || !params.token || !params.client_id) {
        return oauthError(c, 400, 'invalid_request', 'token and client_id are required')
      }
      const now = nowOf(deps)
      const hash = hashSecret(params.token)
      const row = await db
        .selectFrom('oauth_tokens')
        .innerJoin('oauth_grants', 'oauth_grants.id', 'oauth_tokens.grant_id')
        .select(['oauth_tokens.kind', 'oauth_tokens.grant_id', 'oauth_tokens.family', 'oauth_grants.client_id'])
        .where('oauth_tokens.hash', '=', hash)
        .executeTakeFirst()
      // Unknown tokens and tokens of other clients are a silent no-op (RFC 7009 section 2.2).
      if (row && row.client_id === params.client_id) {
        let q = db.updateTable('oauth_tokens').set({ revoked_at: now }).where('revoked_at', 'is', null)
        q = row.kind === 'refresh' ? q.where('grant_id', '=', row.grant_id).where('family', '=', row.family) : q.where('hash', '=', hash)
        await q.execute()
      }
      return c.body(null, 200)
    })
}

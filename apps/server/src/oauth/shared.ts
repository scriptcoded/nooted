import { createHash, randomBytes } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import type { Config } from '../config.ts'
import type { DB } from '../db/schema.ts'

export const SCOPES = ['feedback.read', 'feedback.write'] as const
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const CODE_TTL_MS = 60 * 1000
export const REQUEST_TTL_MS = 10 * 60 * 1000
export const BODY_LIMIT = 16 * 1024
export const ACCESS_PREFIX = 'nat_'
export const REFRESH_PREFIX = 'nrt_'

export type RateLimiter = { hit(key: string): boolean; reset(): void }

// Injection points so tests control time and the registration rate limit.
export type OauthHooks = {
  now?: () => number
  registerLimiter?: RateLimiter
  /** Cap on clients without grants created in the last 24 h. Default 1000. */
  maxUnusedClients?: number
}
export type OauthDeps = { config: Config; db: Kysely<DB>; oauth?: OauthHooks }

export const nowOf = (deps: { oauth?: OauthHooks }): number => deps.oauth?.now?.() ?? Date.now()
export const resourceUrl = (config: Config): string => `${config.publicUrl}/mcp`
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')
export const hashSecret = (value: string): string => createHash('sha256').update(value).digest('base64url')

const MAX_LIMITER_KEYS = 10_000

// Sliding window, in memory. The map is capped (least recently hit keys are evicted first) so it cannot
// grow without bound, and idle keys are pruned only when the cap is reached.
export function createRateLimiter(options: { limit: number; windowMs: number; now: () => number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>()
  const maxKeys = options.maxKeys ?? MAX_LIMITER_KEYS
  return {
    hit(key) {
      const now = options.now()
      const recent = (hits.get(key) ?? []).filter((t) => t > now - options.windowMs)
      // Re-insert so Map order is recency order.
      hits.delete(key)
      const allowed = recent.length < options.limit
      if (allowed) recent.push(now)
      hits.set(key, recent)
      if (hits.size > maxKeys) {
        for (const [k, times] of hits) if (times.every((t) => t <= now - options.windowMs)) hits.delete(k)
        while (hits.size > maxKeys) {
          const oldest = hits.keys().next().value
          if (oldest === undefined) break
          hits.delete(oldest)
        }
      }
      return allowed
    },
    reset: () => hits.clear(),
  }
}

/**
 * The address to rate limit by. By default the socket address; X-Forwarded-For is honoured only when
 * TRUST_PROXY_HOPS > 0, taking the entry that many hops from the right (the one the nearest trusted proxy appended).
 */
export function clientIp(c: Context, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const parts = (c.req.header('x-forwarded-for') ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '')
    const entry = parts[parts.length - trustProxyHops]
    if (entry) return entry
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Parses a space-separated scope string. Returns null when it is empty or has an unsupported scope. */
export function parseScopes(value: string): string[] | null {
  const parts = value.split(' ').filter((p) => p !== '')
  if (parts.length === 0) return null
  const unique = [...new Set(parts)]
  return unique.every((p) => (SCOPES as readonly string[]).includes(p)) ? unique : null
}

export const splitScopes = (value: string): string[] => value.split(' ').filter((p) => p !== '')

export function oauthError(c: Context, status: 400 | 401, error: string, description: string) {
  return c.json({ error, error_description: description }, status)
}

export const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

/**
 * CSRF defence for state-changing console endpoints (the session cookie is SameSite=Lax, so this is
 * defence in depth): the Origin header must be the public origin. Missing or foreign Origin is rejected.
 */
export function requireSameOrigin(deps: { config: Config }) {
  const expected = new URL(deps.config.publicUrl).origin
  return createMiddleware(async (c, next) => {
    if (c.req.header('origin') !== expected) return c.json({ error: 'forbidden' as const }, 403)
    return next()
  })
}

export function requireJson() {
  return createMiddleware(async (c, next) => {
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (type !== 'application/json') return c.json({ error: 'unsupported_media_type' as const }, 415)
    return next()
  })
}

/** Revokes a grant and every token it issued, immediately. */
export async function revokeGrant(db: Kysely<DB>, grantId: string, now: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('oauth_grants').set({ revoked_at: now }).where('id', '=', grantId).where('revoked_at', 'is', null).execute()
    await trx.updateTable('oauth_tokens').set({ revoked_at: now }).where('grant_id', '=', grantId).where('revoked_at', 'is', null).execute()
  })
}

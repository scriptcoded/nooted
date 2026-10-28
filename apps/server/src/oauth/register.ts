import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import { BODY_LIMIT, clientIp, createRateLimiter, nowOf, randomToken } from './shared.ts'
import type { OauthDeps } from './shared.ts'

const GRANT_TYPES = ['authorization_code', 'refresh_token']
const RESPONSE_TYPES = ['code']
const MAX_UNUSED_CLIENTS = 1000
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** https any host, or http on a loopback host (any port). No fragment, no userinfo. */
export function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('#')) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'https:') return url.hostname !== ''
  return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

export function createRegisterRoutes(deps: OauthDeps) {
  const limiter =
    deps.oauth?.registerLimiter ?? createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000, now: () => nowOf(deps) })
  const fail = (c: Context, error: 'invalid_redirect_uri' | 'invalid_client_metadata', description: string) =>
    c.json({ error, error_description: description }, 400, { 'Cache-Control': 'no-store' })

  const maxUnused = deps.oauth?.maxUnusedClients ?? MAX_UNUSED_CLIENTS
  const tooLarge = bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) => c.json({ error: 'invalid_request', error_description: 'Request body too large' }, 413),
  })

  return new Hono().post('/register', tooLarge, async (c) => {
    if (!limiter.hit(clientIp(c, deps.config.trustProxyHops))) {
      return c.json({ error: 'too_many_requests', error_description: 'Too many registrations, try again later' }, 429, {
        'Retry-After': '3600',
      })
    }
    const body: unknown = await c.req.json().catch(() => null)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail(c, 'invalid_client_metadata', 'The request body must be a JSON object')
    }
    const meta = body as Record<string, unknown>

    const uris = meta.redirect_uris
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) {
      return fail(c, 'invalid_redirect_uri', 'redirect_uris must contain 1 to 5 entries')
    }
    if (!uris.every(isValidRedirectUri)) {
      return fail(c, 'invalid_redirect_uri', 'redirect_uris must be https URLs or http loopback URLs without fragments or credentials')
    }

    let name = 'Unnamed client'
    if (meta.client_name !== undefined) {
      if (typeof meta.client_name !== 'string') return fail(c, 'invalid_client_metadata', 'client_name must be a string')
      // eslint-disable-next-line no-control-regex
      const cleaned = meta.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
      if (cleaned.length > 100) return fail(c, 'invalid_client_metadata', 'client_name must be at most 100 characters')
      if (cleaned !== '') name = cleaned
    }

    if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none') {
      return fail(c, 'invalid_client_metadata', "token_endpoint_auth_method must be 'none'")
    }
    let grantTypes = ['authorization_code']
    if (meta.grant_types !== undefined) {
      if (!isStringArray(meta.grant_types) || meta.grant_types.length === 0 || !meta.grant_types.every((g) => GRANT_TYPES.includes(g))) {
        return fail(c, 'invalid_client_metadata', 'grant_types must be a subset of authorization_code and refresh_token')
      }
      grantTypes = [...new Set(meta.grant_types)]
    }
    let responseTypes = ['code']
    if (meta.response_types !== undefined) {
      if (!isStringArray(meta.response_types) || meta.response_types.length === 0 || !meta.response_types.every((r) => RESPONSE_TYPES.includes(r))) {
        return fail(c, 'invalid_client_metadata', "response_types must be ['code']")
      }
      responseTypes = [...new Set(meta.response_types)]
    }

    // Global cap on never-used clients, so a spread-out flood cannot fill the database.
    const unused = await deps.db
      .selectFrom('oauth_clients')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('created_at', '>', nowOf(deps) - 24 * 60 * 60 * 1000)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('oauth_grants').select('oauth_grants.id').whereRef('oauth_grants.client_id', '=', 'oauth_clients.id'))))
      .executeTakeFirstOrThrow()
    if (Number(unused.n) >= maxUnused) {
      return c.json({ error: 'too_many_requests', error_description: 'Too many pending registrations, try again later' }, 429, {
        'Retry-After': '3600',
      })
    }

    const redirectUris = [...new Set(uris as string[])]
    const clientId = randomToken(32)
    const createdAt = nowOf(deps)
    await deps.db
      .insertInto('oauth_clients')
      .values({ id: clientId, name, redirect_uris: JSON.stringify(redirectUris), created_at: createdAt, last_used_at: null })
      .execute()
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(createdAt / 1000),
        redirect_uris: redirectUris,
        client_name: name,
        token_endpoint_auth_method: 'none',
        grant_types: grantTypes,
        response_types: responseTypes,
      },
      201,
      { 'Cache-Control': 'no-store' },
    )
  })
}

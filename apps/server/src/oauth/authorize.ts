import { Hono } from 'hono'
import type { Context } from 'hono'
import { getSessionUser } from '../auth/middleware.ts'
import {
  REQUEST_TTL_MS,
  SCOPES,
  nowOf,
  parseScopes,
  randomToken,
  resourceUrl,
} from './shared.ts'
import type { OauthDeps } from './shared.ts'

const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/
const MAX_STATE = 1024

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function errorPage(c: Context, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorization error</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}</style></head><body><h1>Cannot connect this app</h1><p>${escapeHtml(message)}</p><p>Go back to the app you were connecting and start again.</p></body></html>`
  return c.html(html, 400, {
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
}

export function createAuthorizeRoutes(deps: OauthDeps) {
  const { config, db } = deps

  const redirectWithError = (c: Context, redirectUri: string, state: string | undefined, error: string, description: string) => {
    const url = new URL(redirectUri)
    url.searchParams.set('error', error)
    url.searchParams.set('error_description', description)
    if (state !== undefined) url.searchParams.set('state', state)
    url.searchParams.set('iss', config.publicUrl)
    return c.redirect(url.toString(), 302)
  }

  return new Hono().get('/authorize', async (c) => {
    c.header('Cache-Control', 'no-store')
    const q = (name: string) => c.req.query(name)

    // 1. Never redirect to an unverified redirect_uri.
    const clientId = q('client_id')
    const client = clientId ? await db.selectFrom('oauth_clients').selectAll().where('id', '=', clientId).executeTakeFirst() : undefined
    if (!client) return errorPage(c, 'The application is not registered.')
    const registered: unknown = JSON.parse(client.redirect_uris)
    const redirectUri = q('redirect_uri')
    if (!redirectUri || !Array.isArray(registered) || !registered.includes(redirectUri)) {
      return errorPage(c, 'The redirect address does not match the one registered by the application.')
    }

    // 2. Everything else is reported to the client.
    const state = q('state')
    if (state !== undefined && state.length > MAX_STATE) {
      return redirectWithError(c, redirectUri, undefined, 'invalid_request', 'state is too long')
    }
    const fail = (error: string, description: string) => redirectWithError(c, redirectUri, state, error, description)

    if (q('response_type') !== 'code') return fail('unsupported_response_type', "response_type must be 'code'")
    const challenge = q('code_challenge')
    if (!challenge || !CHALLENGE.test(challenge)) return fail('invalid_request', 'A valid PKCE code_challenge is required')
    if (q('code_challenge_method') !== 'S256') return fail('invalid_request', "code_challenge_method must be 'S256'")
    const resource = resourceUrl(config)
    const requestedResource = q('resource')
    if (requestedResource !== undefined && requestedResource !== resource) {
      return fail('invalid_target', `resource must be ${resource}`)
    }
    let scopes: string[] = [...SCOPES]
    const scopeParam = q('scope')
    if (scopeParam !== undefined) {
      const parsed = parseScopes(scopeParam)
      if (!parsed) return fail('invalid_scope', `scope must be a non-empty subset of: ${SCOPES.join(' ')}`)
      scopes = parsed
    }

    // 3. Sign in first if needed.
    const user = await getSessionUser(deps, c)
    if (!user) {
      const url = new URL(c.req.url)
      return c.redirect(`/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`, 302)
    }

    // 4. Park the request; the console shows the consent page.
    const id = randomToken(32)
    await db
      .insertInto('oauth_requests')
      .values({
        id,
        client_id: client.id,
        user_id: user.id,
        redirect_uri: redirectUri,
        state: state ?? null,
        code_challenge: challenge,
        scopes: scopes.join(' '),
        resource,
        expires_at: nowOf(deps) + REQUEST_TTL_MS,
        used_at: null,
      })
      .execute()
    return c.redirect(`/connect/${id}`, 302)
  })
}

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createTestApp, signIn } from '../test-helpers.ts'

export const ORIGIN = 'http://localhost:5173'
export const REDIRECT = 'http://127.0.0.1:54321/callback'
export const RESOURCE = `${ORIGIN}/mcp`

export type Clock = { t: number }

export async function setup() {
  const clock: Clock = { t: 1_800_000_000_000 }
  const t = await createTestApp({ oauth: { now: () => clock.t } })
  const user = await signIn(t, { email: 'user@example.com' })
  const other = await signIn(t, { email: 'other@example.com' })
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    t.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const form = (path: string, body: Record<string, string>) =>
    t.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })

  async function register(redirectUris: string[] = [REDIRECT], name = 'Claude Code') {
    const res = await json('/oauth/register', { redirect_uris: redirectUris, client_name: name })
    assert.equal(res.status, 201)
    return ((await res.json()) as { client_id: string }).client_id
  }

  function pkce() {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
  }

  function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string | undefined> = {}) {
    const params: Record<string, string | undefined> = {
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'st4te',
      resource: RESOURCE,
      ...extra,
    }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
    return q.toString()
  }

  const authorize = (query: string, cookie?: string) =>
    t.app.request(`/oauth/authorize?${query}`, { headers: cookie ? { cookie } : {} })

  /** Starts authorization as `cookie` and returns the stored request id. */
  async function startRequest(clientId: string, challenge: string, cookie = user.cookie, extra: Record<string, string | undefined> = {}) {
    const res = await authorize(authorizeQuery(clientId, challenge, extra), cookie)
    assert.equal(res.status, 302)
    const location = res.headers.get('location') ?? ''
    const match = /^\/connect\/(.+)$/.exec(location)
    assert.ok(match, `unexpected location ${location}`)
    return match[1] as string
  }

  const decide = (requestId: string, approve: boolean, cookie = user.cookie, headers: Record<string, string> = { origin: ORIGIN }) =>
    json(`/api/oauth/requests/${requestId}/decision`, { approve }, { cookie, ...headers })

  /** Whole code flow up to a code. */
  async function getCode(clientId: string, challenge: string, extra: Record<string, string | undefined> = {}) {
    const requestId = await startRequest(clientId, challenge, user.cookie, extra)
    const res = await decide(requestId, true)
    assert.equal(res.status, 200)
    const { redirectTo } = (await res.json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')
    assert.ok(code)
    return code
  }

  type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string }

  async function exchange(clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
    return form('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      ...extra,
    })
  }

  async function connect(extra: Record<string, string | undefined> = {}) {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const code = await getCode(clientId, challenge, extra)
    const res = await exchange(clientId, code, verifier)
    assert.equal(res.status, 200)
    return { clientId, tokens: (await res.json()) as Tokens, code, verifier }
  }

  const refresh = (clientId: string, refreshToken: string, extra: Record<string, string> = {}) =>
    form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, ...extra })

  const bearer = (token: string) => new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${token}` } })

  return { t, clock, user, other, json, form, register, pkce, authorizeQuery, authorize, startRequest, decide, getCode, exchange, connect, refresh, bearer }
}

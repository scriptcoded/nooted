import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppDeps } from '../app.ts'
import { createSession, destroySession, isSecure } from './sessions.ts'

export const LOGIN_COOKIE = 'nooted_login'
const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000

/** Same-origin path (with query and hash) or '/'. Parsed, because browsers strip tabs and newlines and treat backslashes as slashes. */
export function sanitizeReturnTo(value: string | undefined, publicUrl: string): string {
  // eslint-disable-next-line no-control-regex
  if (!value || !value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return '/'
  try {
    const u = new URL(value, publicUrl)
    if (u.origin !== new URL(publicUrl).origin) return '/'
    return u.pathname + u.search + u.hash
  } catch {
    return '/'
  }
}

const random = (bytes: number) => randomBytes(bytes).toString('base64url')

export function createAuthRoutes(deps: AppDeps) {
  const { config, db, oidc } = deps
  const redirectUri = `${config.publicUrl}/auth/callback`
  const loginCookieOptions = { path: '/auth', secure: isSecure(config) }

  return new Hono()
    .get('/login', async (c) => {
      const returnTo = sanitizeReturnTo(c.req.query('returnTo'), config.publicUrl)
      const attempt = {
        id: random(32),
        state: random(32),
        nonce: random(32),
        code_verifier: random(32),
        return_to: returnTo,
        expires_at: Date.now() + LOGIN_ATTEMPT_TTL_MS,
      }
      const url = await oidc.authorizationUrl({
        state: attempt.state,
        nonce: attempt.nonce,
        codeChallenge: createHash('sha256').update(attempt.code_verifier).digest('base64url'),
        redirectUri,
      })
      await db.insertInto('login_attempts').values(attempt).execute()
      setCookie(c, LOGIN_COOKIE, attempt.id, {
        ...loginCookieOptions,
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: LOGIN_ATTEMPT_TTL_MS / 1000,
      })
      return c.redirect(url, 302)
    })
    .get('/callback', async (c) => {
      const badRequest = () => {
        deleteCookie(c, LOGIN_COOKIE, loginCookieOptions)
        return c.json({ error: 'invalid_login_attempt' as const }, 400)
      }

      const attemptId = getCookie(c, LOGIN_COOKIE)
      if (!attemptId) return badRequest()
      // Deleting on load makes the attempt single use.
      const attempt = await db
        .deleteFrom('login_attempts')
        .where('id', '=', attemptId)
        .returningAll()
        .executeTakeFirst()
      if (!attempt || attempt.expires_at <= Date.now() || c.req.query('state') !== attempt.state) {
        return badRequest()
      }

      let identity
      try {
        // Rebuild the URL on the public origin; the server may sit behind a proxy.
        const currentUrl = new URL(`${redirectUri}${new URL(c.req.url).search}`)
        identity = await oidc.exchange({
          currentUrl,
          state: attempt.state,
          nonce: attempt.nonce,
          codeVerifier: attempt.code_verifier,
          redirectUri,
        })
      } catch (error) {
        console.error('OIDC code exchange failed', error)
        return badRequest()
      }

      const userId = await db.transaction().execute(async (trx) => {
        const fields = {
          email: identity.email,
          email_verified: identity.emailVerified ? 1 : 0,
          name: identity.name,
        }
        const existing = await trx
          .selectFrom('users')
          .select('id')
          .where('issuer', '=', identity.issuer)
          .where('subject', '=', identity.subject)
          .executeTakeFirst()
        let id: string
        if (existing) {
          id = existing.id
          await trx.updateTable('users').set(fields).where('id', '=', id).execute()
        } else {
          id = randomUUID()
          await trx
            .insertInto('users')
            .values({ id, issuer: identity.issuer, subject: identity.subject, created_at: Date.now(), ...fields })
            .execute()
        }
        if (identity.emailVerified) {
          await trx
            .updateTable('project_members')
            .set({ user_id: id })
            .where('email_lower', '=', identity.email.toLowerCase())
            .where('user_id', 'is', null)
            .execute()
        }
        return id
      })

      await createSession(c, deps, userId)
      deleteCookie(c, LOGIN_COOKIE, loginCookieOptions)
      return c.redirect(sanitizeReturnTo(attempt.return_to, config.publicUrl), 302)
    })
    .post('/logout', async (c) => {
      await destroySession(c, deps)
      return c.body(null, 204)
    })
}

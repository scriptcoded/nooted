import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { html, raw } from 'hono/html'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { getSessionUser } from '../auth/middleware.ts'
import type { AuthUser } from '../auth/middleware.ts'
import type { DB } from '../db/schema.ts'
import { normalizeOrigin } from '../projects/origin.ts'
import { validate } from '../validation.ts'
import { issueUploadToken } from './tokens.ts'

export const SIGN_IN_HEADER = 'x-nooted-sign-in'

type Check =
  | { ok: true; user: AuthUser; projectId: string; origin: string }
  | { ok: false; reason: 'no_session' }
  | { ok: false; reason: 'unknown_key' }
  | { ok: false; reason: 'bad_origin'; origin: string }
  | { ok: false; reason: 'not_member'; origin: string }

// Session, project key, allowed origin, then membership. Shared by the page and the token endpoint.
async function check(deps: AppDeps, c: Context, key: string | undefined, rawOrigin: string | undefined): Promise<Check> {
  const user = await getSessionUser(deps, c)
  if (!user) return { ok: false, reason: 'no_session' }
  const project = key
    ? await deps.db.selectFrom('projects').select('id').where('public_key', '=', key).executeTakeFirst()
    : undefined
  if (!project) return { ok: false, reason: 'unknown_key' }
  const origin = normalizeOrigin(rawOrigin ?? '')
  const allowed = origin
    ? await deps.db
        .selectFrom('project_origins')
        .select('origin')
        .where('project_id', '=', project.id)
        .where('origin', '=', origin)
        .executeTakeFirst()
    : undefined
  if (!origin || !allowed) return { ok: false, reason: 'bad_origin', origin: rawOrigin?.trim() || '(none)' }
  if (!user.isAdmin && !(await isMember(deps.db, project.id, user.id))) return { ok: false, reason: 'not_member', origin }
  return { ok: true, user, projectId: project.id, origin }
}

async function isMember(db: Kysely<DB>, projectId: string, userId: string) {
  const row = await db
    .selectFrom('project_members')
    .select('user_id')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row !== undefined
}

// Safe to embed inside a <script> element.
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function page(c: Context, status: 200 | 403 | 404, title: string, message: string, script?: (nonce: string) => string) {
  const nonce = randomBytes(16).toString('base64url')
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  )
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Cache-Control', 'no-store')
  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>
            body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; color: #1a1a1a; background: #fff; }
            main { max-width: 28rem; margin: 10vh auto 0; }
            h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
            p { margin: 0 0 0.75rem; }
            @media (prefers-color-scheme: dark) { body { color: #eee; background: #161616; } }
          </style>
        </head>
        <body>
          <main>
            <h1>${title}</h1>
            <p id="msg">${message}</p>
          </main>
          ${script ? raw(`<script nonce="${nonce}">${script(nonce)}</script>`) : ''}
        </body>
      </html>`,
    status,
  )
}

const tokenBody = z.object({ key: z.string(), origin: z.string() })

export function createSdkSignInRoutes(deps: AppDeps) {
  const { config, db } = deps
  const publicOrigin = new URL(config.publicUrl).origin

  return new Hono()
    .get('/sign-in', async (c) => {
      const key = c.req.query('key')
      const result = await check(deps, c, key, c.req.query('origin'))
      if (!result.ok) {
        switch (result.reason) {
          case 'no_session': {
            const url = new URL(c.req.url)
            c.header('Cache-Control', 'no-store')
            return c.redirect(`/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`, 302)
          }
          case 'unknown_key':
            return page(c, 404, 'Unknown project', 'This sign-in link does not match any project. Start again from the report window.')
          case 'bad_origin':
            return page(
              c,
              403,
              'Origin not allowed',
              `The page at ${result.origin} is not allowed to sign in to this project. Ask a project admin to add it to the allowed origins.`,
            )
          case 'not_member':
            return page(
              c,
              403,
              'No access to this project',
              'You are signed in, but you are not a member of this project. Ask a project admin to add you, then try again.',
              () => `var o=window.opener;if(o){o.postMessage({type:'nooted:sign-in-error',reason:'not_member'},${scriptJson(result.origin)})}`,
            )
        }
      }
      const signInConfig = { key, origin: result.origin, header: SIGN_IN_HEADER }
      return page(c, 200, 'Signing you in', 'Signing you in…', () =>
        `(function(){var cfg=${scriptJson(signInConfig)};var msg=document.getElementById('msg');` +
        `function fail(t){msg.textContent=t}` +
        `if(!window.opener){fail('Start the sign-in from the report window on the site you are reporting on, not from this tab.');return}` +
        `var h={'content-type':'application/json'};h[cfg.header]='1';` +
        `fetch('/sdk/sign-in/token',{method:'POST',credentials:'include',headers:h,body:JSON.stringify({key:cfg.key,origin:cfg.origin})})` +
        `.then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error('failed');return b})})` +
        `.then(function(b){window.opener.postMessage({type:'nooted:token',token:b.token,expiresAt:b.expiresAt,user:b.user},cfg.origin);window.close();fail('Signed in. You can close this window.')})` +
        `.catch(function(){fail('Sign-in failed. Close this window and try again.')})})()`,
      )
    })
    .post('/sign-in/token', validate('json', tokenBody), async (c) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header(SIGN_IN_HEADER) !== '1') return c.json({ error: 'forbidden' as const }, 403)
      const requestOrigin = c.req.header('origin')
      if (requestOrigin !== undefined && requestOrigin !== publicOrigin) return c.json({ error: 'forbidden' as const }, 403)
      const body = c.req.valid('json')
      const result = await check(deps, c, body.key, body.origin)
      if (!result.ok) {
        if (result.reason === 'no_session') return c.json({ error: 'unauthorized' as const }, 401)
        if (result.reason === 'unknown_key') return c.json({ error: 'not_found' as const }, 404)
        return c.json({ error: result.reason }, 403)
      }
      const { token, expiresAt } = await issueUploadToken(db, { userId: result.user.id, projectId: result.projectId })
      return c.json({ token, expiresAt, user: { name: result.user.name, email: result.user.email } })
    })
}

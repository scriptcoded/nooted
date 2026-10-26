import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import type { Config } from '../config.ts'
import type { DB } from '../db/schema.ts'
import { SESSION_COOKIE, hashSessionId } from './sessions.ts'

export type AuthUser = { id: string; email: string; name: string; isAdmin: boolean }
export type AuthEnv = { Variables: { user: AuthUser } }

// Admin status is derived from current user data, never stored.
export function isInstanceAdmin(config: Config, user: { email: string; email_verified: number }): boolean {
  return user.email_verified === 1 && config.adminEmails.includes(user.email.toLowerCase())
}

// Reads only the session cookie. Authorization headers are deliberately ignored.
export async function getSessionUser(deps: { config: Config; db: Kysely<DB> }, c: Context): Promise<AuthUser | null> {
  const id = getCookie(c, SESSION_COOKIE)
  if (!id) return null
  const idHash = hashSessionId(id)
  const row = await deps.db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['sessions.expires_at', 'users.id', 'users.email', 'users.email_verified', 'users.name'])
    .where('sessions.id_hash', '=', idHash)
    .executeTakeFirst()
  if (row && row.expires_at > Date.now()) {
    return { id: row.id, email: row.email, name: row.name, isAdmin: isInstanceAdmin(deps.config, row) }
  }
  if (row) await deps.db.deleteFrom('sessions').where('id_hash', '=', idHash).execute()
  return null
}

export function requireUser(deps: { config: Config; db: Kysely<DB> }) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = await getSessionUser(deps, c)
    if (!user) return c.json({ error: 'unauthorized' as const }, 401)
    c.set('user', user)
    return next()
  })
}

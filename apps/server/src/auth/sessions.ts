import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Kysely } from 'kysely'
import type { Config } from '../config.ts'
import type { DB } from '../db/schema.ts'

export const SESSION_COOKIE = 'nooted_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function isSecure(config: Config): boolean {
  return config.publicUrl.startsWith('https:')
}

export function hashSessionId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

export async function createSession(c: Context, deps: { config: Config; db: Kysely<DB> }, userId: string) {
  const id = randomBytes(32).toString('base64url')
  const now = Date.now()
  await deps.db
    .insertInto('sessions')
    .values({ id_hash: hashSessionId(id), user_id: userId, created_at: now, expires_at: now + SESSION_TTL_MS })
    .execute()
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(deps.config),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function destroySession(c: Context, deps: { config: Config; db: Kysely<DB> }) {
  const id = getCookie(c, SESSION_COOKIE)
  if (id) await deps.db.deleteFrom('sessions').where('id_hash', '=', hashSessionId(id)).execute()
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecure(deps.config) })
}

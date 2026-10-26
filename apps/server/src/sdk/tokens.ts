import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import type { DB } from '../db/schema.ts'

export const UPLOAD_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const TOKEN_PREFIX = 'nt_'

export type UploadContext = { tokenId: string; userId: string; projectId: string }
export type UploadEnv = { Variables: { upload: UploadContext } }

export const hashUploadToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function issueUploadToken(
  db: Kysely<DB>,
  params: { userId: string; projectId: string },
): Promise<{ token: string; expiresAt: number }> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const now = Date.now()
  const expiresAt = now + UPLOAD_TOKEN_TTL_MS
  await db
    .insertInto('upload_tokens')
    .values({
      id: randomUUID(),
      hash: hashUploadToken(token),
      user_id: params.userId,
      project_id: params.projectId,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: now,
    })
    .execute()
  return { token, expiresAt }
}

// Returns the token row whatever its state, or undefined if unknown.
export function findUploadToken(db: Kysely<DB>, token: string) {
  return db.selectFrom('upload_tokens').selectAll().where('hash', '=', hashUploadToken(token)).executeTakeFirst()
}

export async function verifyUploadToken(
  db: Kysely<DB>,
  token: string,
): Promise<{ tokenId: string; userId: string; projectId: string; expiresAt: number } | null> {
  const row = await findUploadToken(db, token)
  if (!row || row.revoked_at !== null || row.expires_at <= Date.now()) return null
  return { tokenId: row.id, userId: row.user_id, projectId: row.project_id, expiresAt: row.expires_at }
}

export async function revokeUploadToken(db: Kysely<DB>, token: string): Promise<void> {
  await db
    .updateTable('upload_tokens')
    .set({ revoked_at: Date.now() })
    .where('hash', '=', hashUploadToken(token))
    .where('revoked_at', 'is', null)
    .execute()
}

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer (nt_\S+)$/.exec(header ?? '')
  return match?.[1] ?? null
}

// Reads only `Authorization: Bearer nt_...`. Cookies are ignored.
export function requireUploadToken(deps: { db: Kysely<DB> }) {
  return createMiddleware<UploadEnv>(async (c, next) => {
    const token = bearerToken(c.req.header('authorization'))
    const verified = token ? await verifyUploadToken(deps.db, token) : null
    if (!verified) return c.json({ error: 'unauthorized' as const }, 401)
    c.set('upload', { tokenId: verified.tokenId, userId: verified.userId, projectId: verified.projectId })
    return next()
  })
}

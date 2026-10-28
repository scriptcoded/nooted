import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../db/schema.ts'

const UNUSED_CLIENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Deletes expired requests, codes and tokens, and clients that never got a grant within 30 days. */
export async function cleanupOauth(db: Kysely<DB>, now: number = Date.now()): Promise<void> {
  await db.deleteFrom('oauth_requests').where('expires_at', '<', now).execute()
  await db.deleteFrom('oauth_codes').where('expires_at', '<', now).execute()
  await db.deleteFrom('oauth_tokens').where('expires_at', '<', now).execute()
  await db
    .deleteFrom('oauth_clients')
    .where('last_used_at', 'is', null)
    .where('created_at', '<', now - UNUSED_CLIENT_MAX_AGE_MS)
    .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM oauth_grants WHERE oauth_grants.client_id = oauth_clients.id)`)
    .execute()
}

import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Tokens carry their own scopes and resource (copied from the code, or the previous token on refresh).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE oauth_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT ''`.execute(db)
  await sql`ALTER TABLE oauth_tokens ADD COLUMN resource TEXT NOT NULL DEFAULT ''`.execute(db)
}

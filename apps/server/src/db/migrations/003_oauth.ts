import { sql } from 'kysely'
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('oauth_clients')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('redirect_uris', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('last_used_at', 'integer')
    .execute()

  await db.schema
    .createTable('oauth_requests')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('client_id', 'text', (c) => c.notNull().references('oauth_clients.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('redirect_uri', 'text', (c) => c.notNull())
    .addColumn('state', 'text')
    .addColumn('code_challenge', 'text', (c) => c.notNull())
    .addColumn('scopes', 'text', (c) => c.notNull())
    .addColumn('resource', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .addColumn('used_at', 'integer')
    .execute()
  await db.schema.createIndex('oauth_requests_expires_at_idx').on('oauth_requests').column('expires_at').execute()

  await db.schema
    .createTable('oauth_grants')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('client_id', 'text', (c) => c.notNull().references('oauth_clients.id').onDelete('cascade'))
    .addColumn('scopes', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addColumn('last_used_at', 'integer')
    .addColumn('revoked_at', 'integer')
    .execute()
  await db.schema
    .createIndex('oauth_grants_active_unique')
    .on('oauth_grants')
    .columns(['user_id', 'client_id'])
    .unique()
    .where(sql.ref('revoked_at'), 'is', null)
    .execute()

  await db.schema
    .createTable('oauth_codes')
    .addColumn('hash', 'text', (c) => c.primaryKey())
    .addColumn('grant_id', 'text', (c) => c.notNull().references('oauth_grants.id').onDelete('cascade'))
    .addColumn('request_id', 'text', (c) => c.notNull())
    .addColumn('redirect_uri', 'text', (c) => c.notNull())
    .addColumn('code_challenge', 'text', (c) => c.notNull())
    .addColumn('resource', 'text', (c) => c.notNull())
    .addColumn('scopes', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .addColumn('used_at', 'integer')
    .execute()
  await db.schema.createIndex('oauth_codes_grant_id_idx').on('oauth_codes').column('grant_id').execute()
  await db.schema.createIndex('oauth_codes_expires_at_idx').on('oauth_codes').column('expires_at').execute()

  await db.schema
    .createTable('oauth_tokens')
    .addColumn('hash', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('grant_id', 'text', (c) => c.notNull().references('oauth_grants.id').onDelete('cascade'))
    .addColumn('family', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .addColumn('used_at', 'integer')
    .addColumn('revoked_at', 'integer')
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .execute()
  await db.schema.createIndex('oauth_tokens_grant_id_idx').on('oauth_tokens').column('grant_id').execute()
  await db.schema.createIndex('oauth_tokens_expires_at_idx').on('oauth_tokens').column('expires_at').execute()

  await sql`UPDATE feedback_items SET status = 'new' WHERE status NOT IN ('new', 'in_progress', 'done', 'dismissed')`.execute(db)
}

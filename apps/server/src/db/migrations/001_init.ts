import { sql } from 'kysely'
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('issuer', 'text', (c) => c.notNull())
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('email_verified', 'integer', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addUniqueConstraint('users_issuer_subject_unique', ['issuer', 'subject'])
    .execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id_hash', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .execute()
  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute()

  await db.schema
    .createTable('login_attempts')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('state', 'text', (c) => c.notNull())
    .addColumn('code_verifier', 'text', (c) => c.notNull())
    .addColumn('nonce', 'text', (c) => c.notNull())
    .addColumn('return_to', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('projects')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('public_key', 'text', (c) => c.notNull().unique())
    .addColumn('retention_days', 'integer')
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('project_origins')
    .addColumn('project_id', 'text', (c) => c.notNull().references('projects.id').onDelete('cascade'))
    .addColumn('origin', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('project_origins_pk', ['project_id', 'origin'])
    .execute()
  await db.schema.createIndex('project_origins_origin_idx').on('project_origins').column('origin').execute()

  await db.schema
    .createTable('project_members')
    .addColumn('project_id', 'text', (c) => c.notNull().references('projects.id').onDelete('cascade'))
    .addColumn('email_lower', 'text', (c) => c.notNull())
    .addColumn('user_id', 'text', (c) => c.references('users.id').onDelete('set null'))
    .addPrimaryKeyConstraint('project_members_pk', ['project_id', 'email_lower'])
    .execute()
  await db.schema.createIndex('project_members_email_lower_idx').on('project_members').column('email_lower').execute()
  await db.schema.createIndex('project_members_user_id_idx').on('project_members').column('user_id').execute()

  await db.schema
    .createTable('upload_tokens')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('hash', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('project_id', 'text', (c) => c.notNull().references('projects.id').onDelete('cascade'))
    .addColumn('expires_at', 'integer', (c) => c.notNull())
    .addColumn('revoked_at', 'integer')
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .execute()
  await db.schema.createIndex('upload_tokens_project_id_idx').on('upload_tokens').column('project_id').execute()
  await db.schema.createIndex('upload_tokens_user_id_idx').on('upload_tokens').column('user_id').execute()

  await db.schema
    .createTable('feedback_items')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('project_id', 'text', (c) => c.notNull().references('projects.id').onDelete('cascade'))
    .addColumn('client_report_id', 'text', (c) => c.notNull())
    .addColumn('reporter_id', 'text', (c) => c.notNull().references('users.id'))
    .addColumn('note', 'text', (c) => c.notNull())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('captured_at', 'integer', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo(sql`'new'`))
    .addColumn('release', 'text')
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('created_at', 'integer', (c) => c.notNull())
    .addUniqueConstraint('feedback_items_project_client_report_unique', ['project_id', 'client_report_id'])
    .execute()
  await db.schema
    .createIndex('feedback_items_project_created_idx')
    .on('feedback_items')
    .columns(['project_id', 'created_at'])
    .execute()
}

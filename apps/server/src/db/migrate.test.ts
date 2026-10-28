import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { migrateToLatest } from './migrate.ts'
import * as m001 from './migrations/001_init.ts'
import * as m002 from './migrations/002_capture_count.ts'
import { createKysely, openDatabase } from './node-sqlite-adapter.ts'
import type { DB } from './schema.ts'

describe('migrations', () => {
  let db: Kysely<DB>

  beforeEach(() => {
    db = createKysely<DB>(openDatabase(':memory:'))
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('applies once and is a no-op the second time', async () => {
    await migrateToLatest(db)
    const executed = await db.selectFrom('kysely_migration' as never).selectAll().execute()
    assert.equal(executed.length, 4)
    await migrateToLatest(db)
    assert.equal((await db.selectFrom('kysely_migration' as never).selectAll().execute()).length, 4)
  })

  it('creates tables that match the DB types and cascades deletes', async () => {
    await migrateToLatest(db)
    const now = Date.now()
    await db
      .insertInto('users')
      .values({ id: 'u1', issuer: 'iss', subject: 'sub', email: 'a@example.com', email_verified: 1, name: 'A', created_at: now })
      .execute()
    await db.insertInto('sessions').values({ id_hash: 'h', user_id: 'u1', expires_at: now + 1, created_at: now }).execute()
    await db
      .insertInto('login_attempts')
      .values({ id: 'l1', state: 's', code_verifier: 'v', nonce: 'n', return_to: '/', expires_at: now + 1 })
      .execute()
    await db
      .insertInto('projects')
      .values({ id: 'p1', name: 'Shop', public_key: 'pk_1', retention_days: null, created_at: now })
      .execute()
    await db.insertInto('project_origins').values({ project_id: 'p1', origin: 'https://shop.example.com' }).execute()
    await db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'a@example.com', user_id: 'u1' }).execute()
    await db
      .insertInto('upload_tokens')
      .values({ id: 't1', hash: 'th', user_id: 'u1', project_id: 'p1', expires_at: now + 1, revoked_at: null, created_at: now })
      .execute()
    await db
      .insertInto('feedback_items')
      .values({
        id: 'f1', project_id: 'p1', client_report_id: 'c1', reporter_id: 'u1', note: 'n', url: 'https://x',
        captured_at: now, release: null, blob_key: 'reports/f1.json.gz', created_at: now,
      })
      .execute()

    const item = await db.selectFrom('feedback_items').selectAll().executeTakeFirstOrThrow()
    assert.equal(item.status, 'new')
    assert.equal((await db.selectFrom('users').selectAll().execute()).length, 1)
    assert.equal((await db.selectFrom('sessions').selectAll().execute()).length, 1)
    assert.equal((await db.selectFrom('login_attempts').selectAll().execute()).length, 1)
    assert.equal((await db.selectFrom('upload_tokens').selectAll().execute()).length, 1)

    await assert.rejects(
      db
        .insertInto('feedback_items')
        .values({
          id: 'f2', project_id: 'p1', client_report_id: 'c1', reporter_id: 'u1', note: 'n', url: 'u',
          captured_at: now, release: null, blob_key: 'k', created_at: now,
        })
        .execute(),
      /UNIQUE/,
    )

    await db.deleteFrom('projects').where('id', '=', 'p1').execute()
    for (const table of ['project_origins', 'project_members', 'upload_tokens', 'feedback_items'] as const) {
      assert.equal((await db.selectFrom(table).selectAll().execute()).length, 0, table)
    }

    // deleting a user cascades sessions
    await db.deleteFrom('users').where('id', '=', 'u1').execute()
    assert.equal((await db.selectFrom('sessions').selectAll().execute()).length, 0)
  })

  it('sets project_members.user_id null when the user is deleted', async () => {
    await migrateToLatest(db)
    const now = Date.now()
    await db
      .insertInto('users')
      .values({ id: 'u1', issuer: 'i', subject: 's', email: 'a@example.com', email_verified: 1, name: 'A', created_at: now })
      .execute()
    await db.insertInto('projects').values({ id: 'p1', name: 'P', public_key: 'pk_1', retention_days: 90, created_at: now }).execute()
    await db.insertInto('project_members').values({ project_id: 'p1', email_lower: 'a@example.com', user_id: 'u1' }).execute()
    await db.deleteFrom('users').execute()
    const member = await db.selectFrom('project_members').selectAll().executeTakeFirstOrThrow()
    assert.equal(member.user_id, null)
  })

  it('adds capture_count with 0 for rows that existed before 002', async () => {
    const first = new Migrator({ db, provider: { getMigrations: async () => ({ '001_init': m001 }) } })
    const { error } = await first.migrateToLatest()
    assert.equal(error, undefined)
    const now = Date.now()
    await db
      .insertInto('users')
      .values({ id: 'u1', issuer: 'i', subject: 's', email: 'a@example.com', email_verified: 1, name: 'A', created_at: now })
      .execute()
    await db.insertInto('projects').values({ id: 'p1', name: 'P', public_key: 'pk_1', retention_days: 90, created_at: now }).execute()
    await db
      .insertInto('feedback_items')
      .values({
        id: 'f1', project_id: 'p1', client_report_id: 'c1', reporter_id: 'u1', note: 'n', url: 'https://x',
        captured_at: now, release: null, blob_key: 'k', created_at: now,
      })
      .execute()
    await migrateToLatest(db)
    assert.equal((await db.selectFrom('feedback_items').selectAll().executeTakeFirstOrThrow()).capture_count, 0)
  })

  it('003 creates the oauth tables and normalizes unknown statuses', async () => {
    const first = new Migrator({ db, provider: { getMigrations: async () => ({ '001_init': m001, '002_capture_count': m002 }) } })
    assert.equal((await first.migrateToLatest()).error, undefined)
    const now = Date.now()
    await db
      .insertInto('users')
      .values({ id: 'u1', issuer: 'i', subject: 's', email: 'a@example.com', email_verified: 1, name: 'A', created_at: now })
      .execute()
    await db.insertInto('projects').values({ id: 'p1', name: 'P', public_key: 'pk_1', retention_days: 90, created_at: now }).execute()
    const statuses = ['new', 'in_progress', 'done', 'dismissed', 'archived', 'Open', '']
    for (const [i, status] of statuses.entries()) {
      await db
        .insertInto('feedback_items')
        .values({
          id: `f${i}`, project_id: 'p1', client_report_id: `c${i}`, reporter_id: 'u1', note: 'n', url: 'https://x',
          captured_at: now, status, release: null, blob_key: 'k', created_at: now,
        })
        .execute()
    }
    await migrateToLatest(db)
    const rows = await db.selectFrom('feedback_items').select(['id', 'status']).orderBy('id').execute()
    assert.deepEqual(
      rows.map((r) => r.status),
      ['new', 'in_progress', 'done', 'dismissed', 'new', 'new', 'new'],
    )

    // Tables exist with usable columns and cascades.
    await db.insertInto('oauth_clients').values({ id: 'c1', name: 'Claude', redirect_uris: '["http://127.0.0.1/cb"]', created_at: now, last_used_at: null }).execute()
    await db
      .insertInto('oauth_requests')
      .values({
        id: 'r1', client_id: 'c1', user_id: 'u1', redirect_uri: 'http://127.0.0.1/cb', state: null, code_challenge: 'x',
        scopes: 'feedback.read', resource: 'http://x/mcp', expires_at: now + 1, used_at: null,
      })
      .execute()
    const grant = { id: 'g1', user_id: 'u1', client_id: 'c1', scopes: 'feedback.read', created_at: now, last_used_at: null, revoked_at: null }
    await db.insertInto('oauth_grants').values(grant).execute()
    await assert.rejects(db.insertInto('oauth_grants').values({ ...grant, id: 'g2' }).execute(), /UNIQUE/)
    await db.updateTable('oauth_grants').set({ revoked_at: now }).where('id', '=', 'g1').execute()
    await db.insertInto('oauth_grants').values({ ...grant, id: 'g2' }).execute()
    await db
      .insertInto('oauth_codes')
      .values({
        hash: 'h', grant_id: 'g2', request_id: 'r1', redirect_uri: 'http://127.0.0.1/cb', code_challenge: 'x',
        resource: 'http://x/mcp', scopes: 'feedback.read', expires_at: now + 1, used_at: null,
      })
      .execute()
    await db
      .insertInto('oauth_tokens')
      .values({ hash: 't', kind: 'access', grant_id: 'g2', family: 'fam', expires_at: now + 1, used_at: null, revoked_at: null, created_at: now, scopes: 'feedback.read', resource: 'http://x/mcp' })
      .execute()
    await db.deleteFrom('oauth_clients').execute()
    for (const table of ['oauth_requests', 'oauth_grants', 'oauth_codes', 'oauth_tokens'] as const) {
      assert.equal((await db.selectFrom(table).selectAll().execute()).length, 0, table)
    }
  })
})

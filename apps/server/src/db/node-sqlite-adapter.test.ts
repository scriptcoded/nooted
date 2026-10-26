import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { sql } from 'kysely'
import type { Kysely } from 'kysely'
import { createKysely, openDatabase } from './node-sqlite-adapter.ts'

type TestDB = { thing: { id: number | null; name: string; qty: number } }

describe('node:sqlite adapter', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    db = createKysely<TestDB>(openDatabase(':memory:'))
    await sql`create table thing (id integer primary key autoincrement, name text not null, qty integer not null)`.execute(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('round-trips insert, select and update', async () => {
    await db.insertInto('thing').values({ id: null, name: 'a', qty: 1 }).execute()
    await db.updateTable('thing').set({ qty: 5 }).where('name', '=', 'a').execute()
    const row = await db.selectFrom('thing').selectAll().where('name', '=', 'a').executeTakeFirstOrThrow()
    assert.equal(row.name, 'a')
    assert.equal(row.qty, 5)
  })

  it('reports insertId and numAffectedRows', async () => {
    const inserted = await db.insertInto('thing').values({ id: null, name: 'a', qty: 1 }).executeTakeFirstOrThrow()
    assert.equal(inserted.insertId, 1n)
    assert.equal(inserted.numInsertedOrUpdatedRows, 1n)
    await db.insertInto('thing').values({ id: null, name: 'b', qty: 1 }).execute()
    const updated = await db.updateTable('thing').set({ qty: 2 }).executeTakeFirstOrThrow()
    assert.equal(updated.numUpdatedRows, 2n)
    const deleted = await db.deleteFrom('thing').where('name', '=', 'a').executeTakeFirstOrThrow()
    assert.equal(deleted.numDeletedRows, 1n)
  })

  it('supports insert ... returning', async () => {
    const row = await db
      .insertInto('thing')
      .values({ id: null, name: 'r', qty: 3 })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow()
    assert.deepEqual({ ...row }, { id: 1, name: 'r' })
  })

  it('rolls back a transaction that throws', async () => {
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await trx.insertInto('thing').values({ id: null, name: 'x', qty: 1 }).execute()
        throw new Error('boom')
      }),
      /boom/,
    )
    const rows = await db.selectFrom('thing').selectAll().execute()
    assert.equal(rows.length, 0)
  })

  it('commits a transaction that succeeds', async () => {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('thing').values({ id: null, name: 'x', qty: 1 }).execute()
    })
    assert.equal((await db.selectFrom('thing').selectAll().execute()).length, 1)
  })

  it('streams rows', async () => {
    for (const name of ['a', 'b', 'c']) {
      await db.insertInto('thing').values({ id: null, name, qty: 1 }).execute()
    }
    const names: string[] = []
    for await (const row of db.selectFrom('thing').select('name').orderBy('name').stream()) {
      names.push(row.name)
    }
    assert.deepEqual(names, ['a', 'b', 'c'])
  })

  it('enforces foreign keys', async () => {
    await sql`create table child (id integer primary key, thing_id integer references thing(id))`.execute(db)
    await assert.rejects(sql`insert into child (id, thing_id) values (1, 99)`.execute(db), /FOREIGN KEY/)
  })
})

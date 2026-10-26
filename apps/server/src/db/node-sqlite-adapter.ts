import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { Kysely, SqliteDialect } from 'kysely'
import type { SqliteDatabase, SqliteStatement } from 'kysely'

// Kysely's SqliteDialect expects a better-sqlite3-shaped database. This is the
// only module that touches node:sqlite directly.
export function wrapDatabase(db: DatabaseSync): SqliteDatabase {
  return {
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql)
      const bind = (parameters: ReadonlyArray<unknown>) => parameters as SQLInputValue[]
      return {
        reader: stmt.columns().length > 0,
        all: (parameters) => stmt.all(...bind(parameters)),
        run: (parameters) => {
          const { changes, lastInsertRowid } = stmt.run(...bind(parameters))
          return { changes, lastInsertRowid }
        },
        iterate: (parameters) => stmt.iterate(...bind(parameters)) as IterableIterator<unknown>,
      }
    },
    close: () => db.close(),
  }
}

export function openDatabase(path: string): SqliteDatabase {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return wrapDatabase(db)
}

// Deliberately no CamelCasePlugin: column names stay snake_case, matching SQL.
export function createKysely<DB>(database: SqliteDatabase): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database }) })
}

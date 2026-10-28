import { Migrator } from 'kysely/migration'
import type { Kysely } from 'kysely'
import type { MigrationProvider } from 'kysely/migration'
import * as m001 from './migrations/001_init.ts'
import * as m002 from './migrations/002_capture_count.ts'

// Explicit list so ordering is visible and nothing is read from the filesystem.
const provider: MigrationProvider = {
  async getMigrations() {
    return { '001_init': m001, '002_capture_count': m002 }
  },
}

export async function migrateToLatest(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error instanceof Error ? error : new Error(String(error))
}

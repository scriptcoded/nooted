import { sql } from 'kysely'
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('feedback_items')
    .addColumn('capture_count', 'integer', (c) => c.notNull().defaultTo(sql`0`))
    .execute()
}

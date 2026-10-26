import type { Kysely } from 'kysely'
import type { DB } from '../db/schema.ts'

export type FeedbackListItem = {
  id: string
  note: string
  url: string
  status: string
  createdAt: number
  capturedAt: number
  release: string | null
  reporter: { id: string; name: string; email: string }
}

export function createFeedbackRepo(db: Kysely<DB>) {
  return {
    async findByClientReportId(projectId: string, clientReportId: string): Promise<string | null> {
      const row = await db
        .selectFrom('feedback_items')
        .select('id')
        .where('project_id', '=', projectId)
        .where('client_report_id', '=', clientReportId)
        .executeTakeFirst()
      return row?.id ?? null
    },

    // Newest first. Never selects blob_key.
    async listForProject(projectId: string): Promise<FeedbackListItem[]> {
      const rows = await db
        .selectFrom('feedback_items')
        .innerJoin('users', 'users.id', 'feedback_items.reporter_id')
        .select([
          'feedback_items.id',
          'feedback_items.note',
          'feedback_items.url',
          'feedback_items.status',
          'feedback_items.created_at',
          'feedback_items.captured_at',
          'feedback_items.release',
          'users.id as reporter_id',
          'users.name as reporter_name',
          'users.email as reporter_email',
        ])
        .where('feedback_items.project_id', '=', projectId)
        .orderBy('feedback_items.created_at', 'desc')
        .orderBy('feedback_items.id', 'desc')
        .execute()
      return rows.map((r) => ({
        id: r.id,
        note: r.note,
        url: r.url,
        status: r.status,
        createdAt: r.created_at,
        capturedAt: r.captured_at,
        release: r.release,
        reporter: { id: r.reporter_id, name: r.reporter_name, email: r.reporter_email },
      }))
    },
  }
}

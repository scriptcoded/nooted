import type { Kysely } from 'kysely'
import { isFeedbackStatus } from '@nooted/shared/status'
import type { FeedbackStatus } from '@nooted/shared/status'
import type { DB } from '../db/schema.ts'

export type FeedbackListItem = {
  id: string
  note: string
  url: string
  status: string
  createdAt: number
  capturedAt: number
  release: string | null
  captureCount: number
  reporter: { id: string; name: string; email: string }
}

export type FeedbackItemRecord = FeedbackListItem & { blobKey: string }

export function createFeedbackRepo(db: Kysely<DB>) {
  return {
    /** Returns false when the item is not in the project. Throws on an invalid status. */
    async setStatus(projectId: string, itemId: string, status: FeedbackStatus): Promise<boolean> {
      if (!isFeedbackStatus(status)) throw new Error(`Invalid feedback status: ${String(status)}`)
      const res = await db
        .updateTable('feedback_items')
        .set({ status })
        .where('project_id', '=', projectId)
        .where('id', '=', itemId)
        .executeTakeFirst()
      return Number(res.numUpdatedRows) > 0
    },

    async findByClientReportId(projectId: string, clientReportId: string): Promise<string | null> {
      const row = await db
        .selectFrom('feedback_items')
        .select('id')
        .where('project_id', '=', projectId)
        .where('client_report_id', '=', clientReportId)
        .executeTakeFirst()
      return row?.id ?? null
    },

    // Keyset-paged, newest first (created_at desc, id desc). Never selects blob_key.
    async listPage(
      projectId: string,
      opts: { status?: FeedbackStatus; limit: number; after?: { createdAt: number; id: string } },
    ): Promise<{ items: FeedbackListItem[]; hasMore: boolean }> {
      let q = db
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
          'feedback_items.capture_count',
          'users.id as reporter_id',
          'users.name as reporter_name',
          'users.email as reporter_email',
        ])
        .where('feedback_items.project_id', '=', projectId)
      if (opts.status) q = q.where('feedback_items.status', '=', opts.status)
      const after = opts.after
      if (after) {
        q = q.where((eb) =>
          eb.or([
            eb('feedback_items.created_at', '<', after.createdAt),
            eb.and([eb('feedback_items.created_at', '=', after.createdAt), eb('feedback_items.id', '<', after.id)]),
          ]),
        )
      }
      const rows = await q
        .orderBy('feedback_items.created_at', 'desc')
        .orderBy('feedback_items.id', 'desc')
        .limit(opts.limit + 1)
        .execute()
      return {
        hasMore: rows.length > opts.limit,
        items: rows.slice(0, opts.limit).map((r) => ({
          id: r.id,
          note: r.note,
          url: r.url,
          status: r.status,
          createdAt: r.created_at,
          capturedAt: r.captured_at,
          release: r.release,
          captureCount: r.capture_count,
          reporter: { id: r.reporter_id, name: r.reporter_name, email: r.reporter_email },
        })),
      }
    },

    /** The project an item belongs to, for lookups by item id alone. */
    async findProjectId(itemId: string): Promise<string | null> {
      const row = await db.selectFrom('feedback_items').select('project_id').where('id', '=', itemId).executeTakeFirst()
      return row?.project_id ?? null
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
          'feedback_items.capture_count',
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
        captureCount: r.capture_count,
        reporter: { id: r.reporter_id, name: r.reporter_name, email: r.reporter_email },
      }))
    },

    // Internal: includes blob_key, which must never reach a response.
    async getForProject(projectId: string, itemId: string): Promise<FeedbackItemRecord | null> {
      const r = await db
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
          'feedback_items.capture_count',
          'feedback_items.blob_key',
          'users.id as reporter_id',
          'users.name as reporter_name',
          'users.email as reporter_email',
        ])
        .where('feedback_items.project_id', '=', projectId)
        .where('feedback_items.id', '=', itemId)
        .executeTakeFirst()
      if (!r) return null
      return {
        id: r.id,
        note: r.note,
        url: r.url,
        status: r.status,
        createdAt: r.created_at,
        capturedAt: r.captured_at,
        release: r.release,
        captureCount: r.capture_count,
        reporter: { id: r.reporter_id, name: r.reporter_name, email: r.reporter_email },
        blobKey: r.blob_key,
      }
    },
  }
}

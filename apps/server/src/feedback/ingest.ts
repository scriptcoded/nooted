import { randomUUID } from 'node:crypto'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { REPORT_LIMITS, ReportPayload } from '@nooted/shared'
import type { Kysely } from 'kysely'
import type { BlobStore } from '../blobs.ts'
import type { DB } from '../db/schema.ts'
import { createFeedbackRepo } from './repo.ts'

const gunzipAsync = promisify(gunzip)

export type IngestResult =
  | { ok: true; status: 200 | 201; id: string }
  | { ok: false; status: 400 | 413; error: 'invalid_gzip' | 'invalid_json' | 'payload_too_large' }
  | { ok: false; status: 400; error: 'invalid_report'; issues: { path: string; message: string }[] }

function isTooLarge(error: unknown): boolean {
  const e = error as { code?: string; name?: string }
  return e instanceof RangeError || e?.code === 'ERR_BUFFER_TOO_LARGE'
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export async function ingestReport(
  deps: { db: Kysely<DB>; blobs: BlobStore },
  upload: { userId: string; projectId: string },
  compressed: Uint8Array,
): Promise<IngestResult> {
  let raw: Buffer
  try {
    raw = await gunzipAsync(compressed, { maxOutputLength: REPORT_LIMITS.maxDecompressedBytes })
  } catch (error) {
    if (isTooLarge(error)) return { ok: false, status: 413, error: 'payload_too_large' }
    return { ok: false, status: 400, error: 'invalid_gzip' }
  }

  let json: unknown
  try {
    json = JSON.parse(raw.toString('utf8'))
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' }
  }

  const parsed = ReportPayload.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_report',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }
  }
  const report = parsed.data

  const repo = createFeedbackRepo(deps.db)
  const existing = await repo.findByClientReportId(upload.projectId, report.clientReportId)
  if (existing) return { ok: true, status: 200, id: existing }

  const id = randomUUID()
  const blobKey = `projects/${upload.projectId}/reports/${id}.json.gz`
  await deps.blobs.put(blobKey, compressed)
  try {
    await deps.db
      .insertInto('feedback_items')
      .values({
        id,
        project_id: upload.projectId,
        client_report_id: report.clientReportId,
        reporter_id: upload.userId,
        note: report.note,
        url: report.url,
        captured_at: report.capturedAt,
        release: report.release ?? null,
        blob_key: blobKey,
        capture_count: report.captures.length,
        created_at: Date.now(),
      })
      .execute()
  } catch (error) {
    await deps.blobs.delete(blobKey)
    if (isUniqueViolation(error)) {
      const winner = await repo.findByClientReportId(upload.projectId, report.clientReportId)
      if (winner) return { ok: true, status: 200, id: winner }
    }
    throw error
  }
  return { ok: true, status: 201, id }
}

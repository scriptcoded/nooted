// The seam between the report window and the upload pipeline.
import { nootedUrl, projectKey } from '../auth/sign-in.ts'
import type { ReportDraft } from '../state.ts'
import { upload } from './client.ts'
import { getRelease } from './config.ts'
import { gzip } from './gzip.ts'
import { buildPayload } from './payload.ts'
import * as queue from './queue.ts'
import { queued } from './retry.ts'

/**
 * - delivered: the server accepted the report
 * - queued: saved locally, will be retried automatically (offline, 5xx, 429 ...)
 * - unauthorized: the token was rejected (401); the caller signs in again and re-sends the same report
 * - failed: permanent rejection; the caller shows an error and keeps the window open
 */
export type SendOutcome = 'delivered' | 'queued' | 'unauthorized' | 'failed'

export interface SendInput {
  /** The report being written; keep the same object for the whole report so a re-send reuses the id. */
  draft: ReportDraft
  /** The bearer token string. */
  token: string
}

interface Built {
  note: string
  /** The draft's captures as they were when built (array and items compared by reference). */
  captures: readonly unknown[]
  clientReportId: string
  bytes: Uint8Array
}

/**
 * Keeps the id (and the bytes, while the note and captures are unchanged) of a report between interactive
 * attempts, so a re-send after sign-in or a failed attempt reuses the same client report id.
 */
const built = new WeakMap<ReportDraft, Built>()

function unchanged(previous: Built, draft: ReportDraft): boolean {
  return (
    previous.note === draft.note &&
    previous.captures.length === draft.captures.length &&
    draft.captures.every((capture, i) => capture === previous.captures[i])
  )
}

async function build({ draft }: SendInput): Promise<Built> {
  const previous = built.get(draft)
  if (previous && unchanged(previous, draft)) return previous
  const captures = [...draft.captures]
  const payload = buildPayload({
    clientReportId: previous?.clientReportId,
    note: draft.note,
    openedAt: draft.openedAt,
    url: draft.url,
    captures,
    release: getRelease(),
  })
  const next: Built = {
    note: draft.note,
    captures,
    clientReportId: payload.clientReportId,
    bytes: await gzip(JSON.stringify(payload)),
  }
  built.set(draft, next)
  return next
}

async function enqueue(report: Built): Promise<void> {
  await queue.add({ clientReportId: report.clientReportId, projectKey: projectKey(), bytes: report.bytes, createdAt: Date.now() })
  await queued()
}

export async function sendReport(input: SendInput): Promise<SendOutcome> {
  const report = await build(input)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue(report)
    return 'queued'
  }
  const outcome = await upload(report.bytes, input.token, nootedUrl())
  switch (outcome) {
    case 'delivered':
      built.delete(input.draft)
      return 'delivered'
    case 'unauthorized':
      // Not queued: the window keeps the note and captures and sends again (same id) after sign-in.
      return 'unauthorized'
    case 'temporary':
      built.delete(input.draft)
      await enqueue(report)
      return 'queued'
    default:
      return 'failed'
  }
}

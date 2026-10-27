// The seam between the report window and the upload pipeline.
import { nootedUrl, projectKey } from '../auth/sign-in.ts'
import type { FrozenReport } from '../state.ts'
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
  note: string
  frozen: FrozenReport
  /** The bearer token string. */
  token: string
  /** Focus range chosen on the timeline; ignored when the recording is left out. */
  focus?: { start: number; end: number }
  /** Default true. */
  includeRecording?: boolean
}

interface Built {
  note: string
  focus?: { start: number; end: number }
  includeRecording: boolean
  clientReportId: string
  bytes: Uint8Array
}

/**
 * Keeps the id (and the bytes, while the note is unchanged) of a report between interactive attempts,
 * so a re-send after sign-in or a failed attempt reuses the same client report id.
 */
const built = new WeakMap<FrozenReport, Built>()

async function build(input: SendInput): Promise<Built> {
  const previous = built.get(input.frozen)
  const includeRecording = input.includeRecording ?? true
  if (
    previous &&
    previous.note === input.note &&
    previous.includeRecording === includeRecording &&
    previous.focus?.start === input.focus?.start &&
    previous.focus?.end === input.focus?.end
  ) {
    return previous
  }
  const payload = buildPayload({
    clientReportId: previous?.clientReportId,
    note: input.note,
    frozen: input.frozen,
    release: getRelease(),
    focus: input.focus,
    includeRecording,
  })
  const next: Built = {
    note: input.note,
    focus: input.focus && { ...input.focus },
    includeRecording,
    clientReportId: payload.clientReportId,
    bytes: await gzip(JSON.stringify(payload)),
  }
  built.set(input.frozen, next)
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
      built.delete(input.frozen)
      return 'delivered'
    case 'unauthorized':
      // Not queued: the window keeps the note and buffer and sends again (same id) after sign-in.
      return 'unauthorized'
    case 'temporary':
      built.delete(input.frozen)
      await enqueue(report)
      return 'queued'
    default:
      return 'failed'
  }
}

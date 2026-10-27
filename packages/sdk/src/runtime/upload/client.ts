// One upload request. Returns what the caller should do next; never throws.
import { classify } from './classify.ts'
import type { UploadOutcome, UploadResult } from './classify.ts'
import { log } from '../safe.ts'

const REQUEST_TIMEOUT_MS = 60_000

export async function upload(bytes: Uint8Array, token: string, nootedUrl: string): Promise<UploadOutcome> {
  let result: UploadResult
  try {
    // No `keepalive`: it caps the body at 64 KB and reports are usually larger.
    const response = await fetch(`${nootedUrl}/api/sdk/reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        authorization: `Bearer ${token}`,
      },
      body: bytes as unknown as BodyInit,
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    })
    result = { status: response.status }
    // Drain so the connection can be reused; the body is not needed.
    void response.arrayBuffer().catch(() => undefined)
  } catch {
    result = { networkError: true }
  }
  const outcome = classify(result)
  if (outcome === 'permanent' && 'status' in result) {
    log.warn(`the server rejected the report (HTTP ${result.status}); it will not be retried`)
  }
  return outcome
}

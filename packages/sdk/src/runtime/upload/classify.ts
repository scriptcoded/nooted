export type UploadOutcome = 'delivered' | 'unauthorized' | 'permanent' | 'temporary'

export type UploadResult = { status: number } | { networkError: true }

/**
 * Maps an upload response to what the queue should do.
 *
 * - 200, 201: delivered
 * - 401: unauthorized (forget the token, keep queued)
 * - 400, 403, 413, 415: permanent (log, don't retry)
 * - network error, 408, 429, 5xx: temporary (retry with backoff)
 * - any other 4xx: permanent (a retry can't change the answer)
 * - anything else (other 2xx, 1xx, 3xx, nonsense): temporary, the safe choice
 *   since a retry is idempotent and the report is not lost
 */
export function classify(result: UploadResult): UploadOutcome {
  if ('networkError' in result) return 'temporary'
  const { status } = result
  if (status === 200 || status === 201) return 'delivered'
  if (status === 401) return 'unauthorized'
  if (status === 408 || status === 429) return 'temporary'
  if (status >= 400 && status < 500) return 'permanent'
  return 'temporary'
}

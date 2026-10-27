import { clearToken, loadToken } from '../auth/token.ts'
import { nootedUrl, projectKey } from '../auth/sign-in.ts'
import { log } from '../safe.ts'
import { getState, setState, subscribe } from '../state.ts'
import { upload } from './client.ts'
import * as queue from './queue.ts'

export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_MAX_MS = 30 * 60_000

/** Delay before retry number `attempt` (0-based): 30 s doubling, capped at 30 min. */
export function backoffDelay(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt))
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(n, 30))
}

// --- The retry loop (browser only) ---

let active = false
let running = false
let attempt = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** Updates the badge from the queue. */
export async function refreshPending(): Promise<void> {
  try {
    setState({ pending: await queue.count(projectKey()) })
  } catch (error) {
    log.warn(error)
  }
}

function schedule(): void {
  if (!active) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void pass()
  }, backoffDelay(attempt))
  attempt += 1
}

/** One pass over this project's queued reports. Only one runs at a time. */
export async function pass(): Promise<void> {
  if (!active || running) return
  running = true
  try {
    const items = await queue.list(projectKey())
    await refreshPending()
    if (items.length === 0) {
      clearTimeout(timer)
      timer = undefined
      attempt = 0
      return
    }
    for (const item of items) {
      if (!active) return
      // Without a valid token the reports wait; signing in triggers a new pass.
      const stored = loadToken(projectKey())
      if (!stored) return
      const outcome = await upload(item.bytes, stored.token, nootedUrl())
      if (!active) return
      if (outcome === 'unauthorized') {
        clearToken(projectKey())
        setState({ token: null })
        return
      }
      if (outcome === 'temporary') {
        schedule()
        return
      }
      // delivered, or permanently rejected (already logged by the client): either way it leaves the queue.
      await queue.remove(item.clientReportId)
      if (outcome === 'delivered') attempt = 0
      await refreshPending()
    }
  } catch (error) {
    log.warn(error)
  } finally {
    running = false
    await refreshPending()
  }
}

/** Called after a report was added to the queue: update the badge and make sure a retry is scheduled. */
export async function queued(): Promise<void> {
  await refreshPending()
  if (active && timer === undefined) schedule()
}

/** Starts retrying: now, on `online`, on sign-in and on the backoff timer. Returns the stop function. */
export function startRetry(): () => void {
  if (active) return stopRetry
  active = true
  attempt = 0
  const onOnline = () => void pass()
  window.addEventListener('online', onOnline)
  let hadToken = !!getState().token
  const unsubscribe = subscribe((state) => {
    const has = !!state.token
    if (has && !hadToken) void pass()
    hadToken = has
  })
  disposers = [() => window.removeEventListener('online', onOnline), unsubscribe]
  void pass()
  return stopRetry
}

let disposers: (() => void)[] = []

export function stopRetry(): void {
  active = false
  clearTimeout(timer)
  timer = undefined
  for (const dispose of disposers.splice(0)) dispose()
}

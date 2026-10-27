// iOS gates devicemotion behind DeviceMotionEvent.requestPermission(), which must be called
// from a user gesture. The outcome is cached for the session.
import { log } from '../safe.ts'

const KEY = 'nooted:motion'

type MotionResult = 'granted' | 'denied'
type PermissionApi = { requestPermission?: () => Promise<string> }

function api(): PermissionApi | undefined {
  return typeof DeviceMotionEvent === 'undefined' ? undefined : (DeviceMotionEvent as unknown as PermissionApi)
}

export function needsMotionPermission(): boolean {
  return typeof api()?.requestPermission === 'function'
}

export function cachedMotionPermission(): MotionResult | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

let inflight = false

/**
 * Call synchronously from a click handler. Asks at most once per session (and never twice at the same time);
 * `onGranted` runs when access is granted. Never throws, and a denial changes nothing else.
 */
export function requestMotionPermission(onGranted: () => void): void {
  const request = api()?.requestPermission
  if (typeof request !== 'function' || inflight || cachedMotionPermission()) return
  inflight = true
  let promise: Promise<string>
  try {
    promise = request.call(DeviceMotionEvent)
  } catch (error) {
    inflight = false
    log.warn(error)
    return
  }
  promise
    .then((result) => {
      const outcome: MotionResult = result === 'granted' ? 'granted' : 'denied'
      try {
        sessionStorage.setItem(KEY, outcome)
      } catch {
        // Not cached: the next tap asks again, which is harmless.
      }
      if (outcome === 'granted') onGranted()
    })
    .catch((error: unknown) => log.warn(error))
    .finally(() => {
      inflight = false
    })
}

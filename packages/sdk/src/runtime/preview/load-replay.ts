// On-demand loader for the replay player (dist/replay.js). Nothing is fetched until loadReplay()
// is called, which only happens when the user asks for a preview.
import type { ReplayApi } from '../../replay/types.ts'
import { log } from '../safe.ts'

const TIMEOUT_MS = 15_000

let pending: Promise<ReplayApi> | undefined

/** The script nonce of the runtime's own tag, read once at boot (document.currentScript is only set during execution). */
let nonce = ''

/** Call synchronously at the very start of the runtime IIFE. */
export function captureNonce(): void {
  try {
    const script = document.currentScript
    if (script instanceof HTMLScriptElement) nonce = script.nonce || script.getAttribute('nonce') || ''
  } catch (error) {
    log.warn(error)
  }
}

function inject(): Promise<ReplayApi> {
  return new Promise<ReplayApi>((resolve, reject) => {
    const registered = (): ReplayApi | undefined => window.nooted?.p
    const ready = registered()
    if (ready) return resolve(ready)
    const base = window.nooted?.u
    if (!base) return reject(new Error('no server url'))

    const script = document.createElement('script')
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (error?: Error) => {
      clearTimeout(timer)
      script.onload = script.onerror = null
      if (!error) {
        const api = registered()
        if (api) return resolve(api)
        error = new Error('replay script loaded without registering')
      }
      script.remove()
      reject(error)
    }
    script.async = true
    if (nonce) script.setAttribute('nonce', nonce)
    script.onload = () => settle()
    script.onerror = () => settle(new Error('replay script failed to load'))
    timer = setTimeout(() => settle(new Error('replay script timed out')), TIMEOUT_MS)
    script.src = `${base}/sdk/v1/replay.js`
    document.head.append(script)
  })
}

/**
 * Loads the replay player once per page. Concurrent calls share a promise; a failed load is forgotten
 * so the next explicit request retries.
 */
export function loadReplay(): Promise<ReplayApi> {
  if (!pending) {
    const attempt = (() => {
      try {
        return inject()
      } catch (error) {
        return Promise.reject(error)
      }
    })()
    pending = attempt
    attempt.catch((error: unknown) => {
      log.warn('replay player unavailable', error)
      if (pending === attempt) pending = undefined
    })
  }
  return pending
}

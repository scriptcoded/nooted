// Sign-in popup flow and sign-out. Browser-only (uses window).
import { clearToken, loadToken, saveToken } from './token.ts'
import type { StoredToken } from './token.ts'
import { log } from '../safe.ts'

export function projectKey(): string {
  return window.nooted?.k ?? ''
}

export function nootedUrl(): string {
  return window.nooted?.u ?? ''
}

function nootedOrigin(): string {
  try {
    return new URL(nootedUrl()).origin
  } catch {
    return ''
  }
}

export function signInUrl(): string {
  return `${nootedUrl()}/sdk/sign-in?key=${encodeURIComponent(projectKey())}&origin=${encodeURIComponent(location.origin)}`
}

/** The current valid token for this tab, if any. */
export function currentToken(): StoredToken | null {
  return loadToken(projectKey())
}

export interface SignInHandlers {
  onToken(token: StoredToken): void
  /** The popup reported an error, e.g. `not_member`. */
  onError(reason: string): void
  /** The popup was closed without a result. */
  onClosed(): void
}

export interface SignInSession {
  /** Stops listening and polling. Does not close the popup. */
  stop(): void
}

function parseToken(data: unknown): StoredToken | null {
  const d = data as Partial<StoredToken> | null
  if (!d || typeof d.token !== 'string' || typeof d.expiresAt !== 'number') return null
  const user = d.user as Partial<StoredToken['user']> | undefined
  return { token: d.token, expiresAt: d.expiresAt, user: { name: String(user?.name ?? ''), email: String(user?.email ?? '') } }
}

/**
 * Opens the sign-in popup. MUST be called synchronously from a click handler (popup blockers).
 * Returns null when the browser blocked the popup.
 */
export function startSignIn(handlers: SignInHandlers): SignInSession | null {
  const popup = window.open(signInUrl(), 'nooted-sign-in', 'popup,width=420,height=640')
  if (!popup) return null
  const origin = nootedOrigin()
  let done = false
  const stop = () => {
    done = true
    window.removeEventListener('message', onMessage)
    clearInterval(poll)
  }
  const onMessage = (event: MessageEvent) => {
    if (done || event.origin !== origin || event.source !== popup) return
    try {
      const data = event.data as { type?: unknown; reason?: unknown } | null
      if (data?.type === 'nooted:token') {
        const token = parseToken(data)
        if (!token) return
        saveToken(projectKey(), token)
        stop()
        handlers.onToken(token)
      } else if (data?.type === 'nooted:sign-in-error') {
        stop()
        handlers.onError(typeof data.reason === 'string' ? data.reason : 'unknown')
      }
    } catch (error) {
      log.warn(error)
    }
  }
  window.addEventListener('message', onMessage)
  // The popup closes itself after posting, so give a pending message a chance to arrive before calling it abandoned.
  const poll = setInterval(() => {
    let closed = false
    try {
      closed = popup.closed
    } catch {
      closed = true
    }
    if (closed && !done) {
      setTimeout(() => {
        if (done) return
        stop()
        handlers.onClosed()
      }, 300)
      clearInterval(poll)
    }
  }, 500)
  return { stop }
}

/** Best-effort revocation on the server; the local token is always forgotten. */
export async function signOut(): Promise<void> {
  const stored = loadToken(projectKey(), 0)
  clearToken(projectKey())
  if (!stored) return
  try {
    await fetch(`${nootedUrl()}/api/sdk/token`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${stored.token}` },
      keepalive: true,
    })
  } catch (error) {
    log.warn('sign-out could not reach the server', error)
  }
}

export interface StoredToken {
  token: string
  /** Epoch milliseconds (the server's `expiresAt`). */
  expiresAt: number
  user: { name: string; email: string }
}

/** Margin so an upload never starts with a token about to expire. */
export const TOKEN_MARGIN_MS = 60_000

export function isTokenValid(stored: Pick<StoredToken, 'expiresAt'> | null | undefined, now: number): boolean {
  return !!stored && typeof stored.expiresAt === 'number' && stored.expiresAt > now + TOKEN_MARGIN_MS
}

const storageKey = (projectKey: string) => `nooted:token:${projectKey}`

function isStoredToken(value: unknown): value is StoredToken {
  const v = value as Partial<StoredToken> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.token === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.user === 'object' &&
    v.user !== null
  )
}

/** The stored token for this tab and project, or null when absent, malformed or (within the margin of) expired. */
export function loadToken(projectKey: string, now: number = Date.now()): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(storageKey(projectKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isStoredToken(parsed) && isTokenValid(parsed, now) ? parsed : null
  } catch {
    return null
  }
}

export function saveToken(projectKey: string, stored: StoredToken): void {
  try {
    sessionStorage.setItem(storageKey(projectKey), JSON.stringify(stored))
  } catch {
    // Storage can be unavailable; the token then lives only in memory (app state) for this window.
  }
}

export function clearToken(projectKey: string): void {
  try {
    sessionStorage.removeItem(storageKey(projectKey))
  } catch {
    // Nothing to clear.
  }
}

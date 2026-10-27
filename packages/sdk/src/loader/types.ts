import type { ReplayApi } from '../replay/types.ts'

// Shared shapes between the loader (loader.ts, no runtime imports) and the runtime.
// Everything here is erased at build time.

export interface LoaderConfig {
  /** Project key. */
  k: string
  /** Nooted server URL, no trailing slash. */
  u: string
  /** Release label from the host app. */
  r?: string
}

/** An error the loader caught before the runtime took over. `time` is Date.now(). */
export type EarlyError =
  | {
      type: 'error'
      message: string
      source?: string
      line?: number
      column?: number
      stack?: string
      time: number
    }
  | { type: 'rejection'; reason: unknown; time: number }

export type ApiMethod = 'init' | 'open' | 'signOut' | 'disable'

/**
 * The `window.nooted` global. The loader defines it with queueing methods; the
 * runtime replaces the methods with real ones, drains `q` and `e`, then sets `t`.
 */
export interface NootedStub {
  /** Contract version. */
  v: 1
  k: string
  u: string
  r?: string
  /** Calls made before the runtime loaded, in order. */
  q: [ApiMethod, unknown[]][]
  /** Early errors (capped). The loader stops appending once `t` is true. */
  e: EarlyError[]
  /** Set by the runtime when it takes over. Stops the loader's error listeners from queueing. */
  t?: boolean
  /** Replay API, registered by dist/replay.js when the runtime loads it on demand. */
  p?: ReplayApi
  /** Injects the runtime script. Idempotent. */
  l(): void
  init(options?: unknown): void
  open(): void
  signOut(): void
  disable(): void
}

declare global {
  interface Window {
    nooted?: NootedStub
  }
}

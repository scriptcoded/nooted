import { loaderCode } from './loader/code.generated.ts'
import type { ApiMethod, LoaderConfig } from './loader/types.ts'

export type { LoaderConfig, NootedStub } from './loader/types.ts'

export interface LoaderOptions {
  projectKey: string
  /** Base URL of the Nooted server. A trailing slash is ignored. */
  nootedUrl: string
  release?: string
}

export interface InitOptions {
  release?: string
  /** Show the floating button. */
  button?: boolean
}

// JSON that is safe inside an inline <script>: no way to write </script> or an
// HTML comment opener, and no raw line separators.
const escapes: Record<string, string> = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }
function serialize(config: LoaderConfig): string {
  return JSON.stringify(config).replace(/[<>&\u2028\u2029]/g, (ch) => escapes[ch]!)
}

/**
 * The loader as plain JavaScript with its config applied. This exact text is the
 * body of the inline snippet (and what loaderCspHash hashes) and the content of the
 * Vite plugin's external loader file.
 */
export function loaderScript({ projectKey, nootedUrl, release }: LoaderOptions): string {
  const config: LoaderConfig = { k: projectKey, u: nootedUrl.replace(/\/+$/, '') }
  if (release) config.r = release
  return `(${loaderCode})(${serialize(config)})`
}

/** The complete inline `<script>` element to paste into a page's head. */
export function loaderSnippet(options: LoaderOptions): string {
  return `<script>${loaderScript(options)}</script>`
}

/**
 * CSP source expression (`'sha256-…'`) that allows exactly the snippet from
 * loaderSnippet(options). Async because it uses SubtleCrypto, which exists in browsers and Node.
 */
export async function loaderCspHash(options: LoaderOptions): Promise<string> {
  const bytes = new TextEncoder().encode(loaderScript(options))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  let binary = ''
  for (const b of digest) binary += String.fromCharCode(b)
  return `'sha256-${btoa(binary)}'`
}

let warned = false

// Forwards to the loader's global (or the runtime that replaced its methods). Never throws.
function call(method: ApiMethod, args: unknown[]): void {
  try {
    const stub = globalThis.window?.nooted
    if (!stub) {
      if (!warned) {
        warned = true
        console.warn('[nooted] No loader found on this page, so nooted.' + method + '() did nothing. Add the loader snippet or the Vite plugin.')
      }
      return
    }
    ;(stub[method] as (...a: unknown[]) => void)(...args)
  } catch (error) {
    console.warn('[nooted]', error)
  }
}

export const nooted = {
  /** Enables Nooted on this device and loads the SDK. */
  init: (options?: InitOptions): void => call('init', [options]),
  /** Opens the report window. */
  open: (): void => call('open', []),
  /** Revokes the upload token and forgets it locally. */
  signOut: (): void => call('signOut', []),
  /** Disables Nooted on this device. */
  disable: (): void => call('disable', []),
}

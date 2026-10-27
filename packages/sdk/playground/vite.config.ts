import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { nooted } from '../src/vite.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_NOOTED_URL = 'http://localhost:5173'
const PLACEHOLDER_KEY = 'pk_playground_placeholder'

/**
 * Per-request response modes for exercising the loader under hostile page policies,
 * chosen with query parameters on the page URL:
 *   ?csp=strict   script-src 'self' + the Nooted origin (the Vite plugin's default loader file works)
 *   ?csp=nonce    script-src 'self' + a fresh nonce on every <script>; the Nooted origin is NOT allowed,
 *                 so the SDK script only loads if the loader copies the nonce onto it
 *   ?csp=strict-style   like strict, plus style-src 'self' (no inline styles: blocks rrweb's <style> elements in the preview)
 *   ?csp=missing  script-src 'self' only (no Nooted origin)
 *   ?coop=same-origin   adds Cross-Origin-Opener-Policy: same-origin
 * (The nonce mode keeps 'self' because Vite dev serves the app as ES modules, whose imports a
 * nonce alone would not allow; the Nooted origin is what the nonce has to unlock.)
 */
function playgroundHeaders(nootedOrigin: string): Plugin {
  return {
    name: 'playground-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Only the HTML document carries the policy; modules and assets don't need it.
        if (req.headers.accept?.includes('text/html')) applyHeaders(req.url ?? '/', req.headers.host ?? 'localhost:5174', nootedOrigin, res)
        next()
      })
    },
  }
}

function applyHeaders(url: string, host: string, nootedOrigin: string, res: ServerResponse): void {
  const params = new URL(url, 'http://localhost').searchParams
  const csp = params.get('csp')
  const connect = `connect-src 'self' ${nootedOrigin} ws://${host}`

  if (csp === 'strict') {
    res.setHeader('Content-Security-Policy', `script-src 'self' ${nootedOrigin}; ${connect}`)
  } else if (csp === 'strict-style') {
    res.setHeader('Content-Security-Policy', `script-src 'self' ${nootedOrigin}; style-src 'self'; ${connect}`)
  } else if (csp === 'missing') {
    res.setHeader('Content-Security-Policy', `script-src 'self'; ${connect}`)
  } else if (csp === 'nonce') {
    const nonce = randomBytes(16).toString('base64')
    res.setHeader('Content-Security-Policy', `script-src 'self' 'nonce-${nonce}'; ${connect}`)
    addNonce(res, nonce)
  }
  if (params.get('coop') === 'same-origin') res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
}

// Vite sends the finished HTML through res.end(), so rewrite it there.
function addNonce(res: ServerResponse, nonce: string): void {
  const end = res.end.bind(res) as (chunk?: unknown, ...rest: unknown[]) => ServerResponse
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string' && String(res.getHeader('Content-Type')).includes('text/html')) {
      const html = chunk.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`)
      res.removeHeader('Content-Length')
      return end(html, ...rest)
    }
    return end(chunk, ...rest)
  }) as typeof res.end
}

export default defineConfig(({ mode }) => {
  // The env file lives at the package root, so the same .env.local serves the SDK tests too.
  // loadEnv also reads process.env for NOOTED_* keys and lets them win, which is how e2e passes the key.
  const env = loadEnv(mode, packageRoot, 'NOOTED_')
  let projectKey = env.NOOTED_PROJECT_KEY
  if (!projectKey) {
    projectKey = PLACEHOLDER_KEY
    console.warn(
      '\n[nooted playground] NOOTED_PROJECT_KEY is not set. Create packages/sdk/.env.local with:\n' +
        '  NOOTED_PROJECT_KEY=<public key from the console>\n' +
        '  (optional) NOOTED_URL=http://localhost:5173\n' +
        'Serving with a placeholder key, so the loader will not be able to sign in.\n',
    )
  }
  const nootedUrl = env.NOOTED_URL || DEFAULT_NOOTED_URL

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: packageRoot,
    plugins: [nooted({ projectKey, nootedUrl }), playgroundHeaders(nootedUrl.replace(/\/+$/, ''))],
    server: {
      port: 5174,
      strictPort: true,
    },
  }
})

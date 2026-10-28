import type { BrowserContext } from 'playwright-core'

/**
 * Locks a render context's network down: only data:/blob: and exact allowed
 * origins (fetched without following redirects) get through. Everything else,
 * including a 3xx from an allowed origin and every WebSocket, is blocked.
 */
export async function restrictNetwork(context: BrowserContext, allowedOrigins: readonly string[]): Promise<void> {
  const allowed = new Set(allowedOrigins)

  await context.routeWebSocket(/.*/, (ws) => {
    void ws.close()
  })

  await context.route('**/*', async (route) => {
    const url = route.request().url()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return route.abort('blockedbyclient')
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return route.continue()
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && allowed.has(parsed.origin)) {
      try {
        const response = await route.fetch({ maxRedirects: 0 })
        // Never hand a redirect to the browser: it would follow it to any host.
        if (response.status() >= 300 && response.status() < 400) return route.abort('blockedbyclient')
        return await route.fulfill({ response })
      } catch {
        return route.abort('failed').catch(() => {})
      }
    }
    return route.abort('blockedbyclient')
  })
}

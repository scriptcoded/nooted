import { createMiddleware } from 'hono/factory'

// Anti-framing for everything the server serves (console, consent page, APIs), so the consent page
// cannot be clickjacked. The SDK bundles under /sdk/v1 are scripts loaded cross-origin by host pages.
export const frameHeaders = createMiddleware(async (c, next) => {
  await next()
  if (c.req.path.startsWith('/sdk/v1/')) return
  // Routes with their own CSP keep it; frame-ancestors is appended when it lacks one.
  const csp = c.res.headers.get('Content-Security-Policy')
  if (csp === null) c.header('Content-Security-Policy', "frame-ancestors 'none'")
  else if (!/(^|;)\s*frame-ancestors\b/.test(csp)) c.header('Content-Security-Policy', `${csp}; frame-ancestors 'none'`)
  c.header('X-Frame-Options', 'DENY')
})

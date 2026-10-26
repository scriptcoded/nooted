import { REPORT_LIMITS } from '@nooted/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppDeps } from '../app.ts'
import { ingestReport } from '../feedback/ingest.ts'
import { isOriginAllowedForProject, sdkOriginCheck, sdkPreflight } from './cors.ts'
import { bearerToken, findUploadToken, requireUploadToken, revokeUploadToken } from './tokens.ts'
import type { UploadEnv } from './tokens.ts'

// Mounted at /api/sdk. Bearer upload tokens only; CORS limited to the token's project origins.
export function createSdkApiRoutes(deps: AppDeps) {
  const { db } = deps
  return new Hono<UploadEnv>()
    .use(sdkPreflight(deps))
    .delete('/token', async (c) => {
      const token = bearerToken(c.req.header('authorization'))
      if (!token) return c.json({ error: 'unauthorized' as const }, 401)
      // Idempotent and non-revealing: known (even revoked/expired) and unknown tokens both give 204.
      const row = await findUploadToken(db, token)
      const origin = c.req.header('origin')
      if (row && origin !== undefined) {
        if (!(await isOriginAllowedForProject(db, row.project_id, origin))) {
          return c.json({ error: 'origin_not_allowed' as const }, 403)
        }
        c.header('Access-Control-Allow-Origin', origin)
        c.header('Vary', 'Origin')
      }
      if (row) await revokeUploadToken(db, token)
      return c.body(null, 204)
    })
    .post(
      '/reports',
      requireUploadToken(deps),
      sdkOriginCheck(deps),
      async (c, next) => {
        if (c.req.header('content-encoding')?.trim().toLowerCase() !== 'gzip') {
          return c.json({ error: 'unsupported_encoding' as const }, 415)
        }
        return next()
      },
      bodyLimit({
        maxSize: REPORT_LIMITS.maxCompressedBytes,
        onError: (c) => c.json({ error: 'payload_too_large' as const }, 413),
      }),
      async (c) => {
        // Hono does not decompress; these are the raw gzip bytes as received.
        const bytes = new Uint8Array(await c.req.arrayBuffer())
        const result = await ingestReport(deps, c.var.upload, bytes)
        if (result.ok) return c.json({ id: result.id }, result.status)
        if (result.error === 'invalid_report') return c.json({ error: result.error, issues: result.issues }, 400)
        if (result.status === 413) return c.json({ error: result.error }, 413)
        return c.json({ error: result.error }, 400)
      },
    )
}

import { createHash } from 'node:crypto'
import { REPORT_LIMITS } from '@nooted/shared'
import type { Mark } from '@nooted/shared'
import { FEEDBACK_STATUSES } from '@nooted/shared/status'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { validate } from '../validation.ts'
import type { AuthEnv } from '../auth/middleware.ts'
import { createProjectRepo } from '../projects/repo.ts'
import { createFeedbackRepo } from './repo.ts'
import { createReportStore } from './report-store.ts'
import type { ReportStore } from './report-store.ts'

type DetailCapture = {
  n: number
  url: string
  capturedAt: number
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  demo: boolean
  durationMs: number
  marks: Mark[]
}

// Mounted inside the projects router, which has already required a session.
const statusBody = z.object({ status: z.enum(FEEDBACK_STATUSES) })

export function createFeedbackRoutes(deps: AppDeps, store: ReportStore = createReportStore(deps)) {
  const projects = createProjectRepo(deps.db, deps.blobs)
  const feedback = createFeedbackRepo(deps.db)
  const notFound = { error: 'not_found' as const }

  async function find(user: AuthEnv['Variables']['user'], projectId: string, itemId: string) {
    if (!(await projects.get(user, projectId))) return null
    return feedback.getForProject(projectId, itemId)
  }

  return new Hono<AuthEnv>()
    .get('/:id/feedback/:itemId', async (c) => {
      const item = await find(c.var.user, c.req.param('id'), c.req.param('itemId'))
      if (!item) return c.json(notFound, 404)
      const report = await store.loadReport(item)
      const base = {
        id: item.id,
        note: item.note,
        url: item.url,
        status: item.status,
        createdAt: item.createdAt,
        capturedAt: item.capturedAt,
        release: item.release,
        reporter: item.reporter,
      }
      const body =
        report.kind === 'v2'
          ? {
              ...base,
              device: report.payload.device,
              legacy: false as boolean,
              captures: report.payload.captures.map((cap) => ({
                n: cap.n,
                url: cap.url,
                capturedAt: cap.capturedAt,
                viewport: cap.viewport,
                scroll: cap.scroll,
                demo: cap.demo,
                durationMs: Math.max(0, cap.events[cap.events.length - 1]!.timestamp - cap.events[0]!.timestamp),
                marks: cap.marks,
              })),
            }
          : {
              ...base,
              device: report.device ?? null,
              legacy: true as boolean,
              captures: [] as DetailCapture[],
            }
      const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`
      c.header('Cache-Control', 'private, no-cache')
      c.header('ETag', etag)
      if (c.req.header('if-none-match') === etag) return c.body(null, 304)
      return c.json(body)
    })
    .patch('/:id/feedback/:itemId', validate('json', statusBody), async (c) => {
      const item = await find(c.var.user, c.req.param('id'), c.req.param('itemId'))
      if (!item) return c.json(notFound, 404)
      const { status } = c.req.valid('json')
      await feedback.setStatus(c.req.param('id'), item.id, status)
      return c.json({ status })
    })
    .get('/:id/feedback/:itemId/captures/:n/events', async (c) => {
      const n = Number(c.req.param('n'))
      if (!/^\d+$/.test(c.req.param('n')) || n < 1 || n > REPORT_LIMITS.maxCaptures) return c.json(notFound, 404)
      const item = await find(c.var.user, c.req.param('id'), c.req.param('itemId'))
      if (!item) return c.json(notFound, 404)
      const report = await store.loadReport(item)
      const capture = report.kind === 'v2' ? report.payload.captures.find((cap) => cap.n === n) : undefined
      if (!capture) return c.json(notFound, 404)
      c.header('Cache-Control', 'private, max-age=31536000, immutable')
      return c.json(capture.events)
    })
}

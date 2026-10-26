import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { requireUser } from '../auth/middleware.ts'
import type { AuthEnv, AuthUser } from '../auth/middleware.ts'
import { validate } from '../validation.ts'
import { createFeedbackRepo } from '../feedback/repo.ts'
import { normalizeOrigin } from './origin.ts'
import { createProjectRepo } from './repo.ts'

const name = z.string().trim().min(1).max(200)
const email = z.string().trim().toLowerCase().pipe(z.email())
const origin = z
  .string()
  .transform((v) => normalizeOrigin(v))
  .pipe(z.string({ error: 'Not a valid origin' }))

const createBody = z.object({ name })
const patchBody = z.object({
  name: name.optional(),
  retentionDays: z.number().int().min(1).nullable().optional(),
})
const originBody = z.object({ origin })
const memberBody = z.object({ email })

export function createProjectRoutes(deps: AppDeps) {
  const repo = createProjectRepo(deps.db, deps.blobs)
  const feedback = createFeedbackRepo(deps.db)

  return new Hono<AuthEnv>()
    .use(requireUser(deps))
    .post('/', validate('json', createBody), async (c) => {
      if (!c.var.user.isAdmin) return c.json({ error: 'forbidden' as const }, 403)
      return c.json(await repo.create(c.req.valid('json').name), 201)
    })
    .get('/', async (c) => c.json(await repo.list(c.var.user)))
    .get('/:id', async (c) => {
      const project = await repo.get(c.var.user, c.req.param('id'))
      if (!project) return c.json({ error: 'not_found' as const }, 404)
      return c.json(project)
    })
    .get('/:id/feedback', async (c) => {
      const id = c.req.param('id')
      if (!(await repo.get(c.var.user, id))) return c.json({ error: 'not_found' as const }, 404)
      return c.json({ items: await feedback.listForProject(id) })
    })
    .patch('/:id', validate('json', patchBody), async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.update(id, c.req.valid('json'))
      return c.json(await repo.get(c.var.user, id))
    })
    .delete('/:id', async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.remove(id)
      return c.body(null, 204)
    })
    .post('/:id/origins', validate('json', originBody), async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.addOrigin(id, c.req.valid('json').origin)
      return c.json(await repo.get(c.var.user, id))
    })
    .delete('/:id/origins', validate('json', originBody), async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.removeOrigin(id, c.req.valid('json').origin)
      return c.json(await repo.get(c.var.user, id))
    })
    .post('/:id/members', validate('json', memberBody), async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.addMember(id, c.req.valid('json').email)
      return c.json(await repo.get(c.var.user, id))
    })
    .delete('/:id/members', validate('json', memberBody), async (c) => {
      const id = c.req.param('id')
      const denied = await deny(c.var.user, id)
      if (denied) return c.json({ error: denied.error }, denied.status)
      await repo.removeMember(id, c.req.valid('json').email)
      return c.json(await repo.get(c.var.user, id))
    })

  // Admin-only mutations: 404 for invisible projects first, then 403 for non-admins.
  async function deny(user: AuthUser, id: string) {
    if (!(await repo.get(user, id))) return { error: 'not_found' as const, status: 404 as const }
    if (!user.isAdmin) return { error: 'forbidden' as const, status: 403 as const }
    return null
  }
}

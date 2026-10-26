import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import type { DB } from '../db/schema.ts'
import type { UploadEnv } from './tokens.ts'

export async function isOriginAllowedForProject(db: Kysely<DB>, projectId: string, origin: string): Promise<boolean> {
  const row = await db
    .selectFrom('project_origins')
    .select('origin')
    .where('project_id', '=', projectId)
    .where('origin', '=', origin)
    .executeTakeFirst()
  return row !== undefined
}

async function isOriginAllowedAnywhere(db: Kysely<DB>, origin: string): Promise<boolean> {
  const row = await db.selectFrom('project_origins').select('origin').where('origin', '=', origin).executeTakeFirst()
  return row !== undefined
}

// Runs before token verification: a preflight carries no Authorization header, so it
// passes if the origin is configured on any project. The real request enforces the project.
export function sdkPreflight(deps: { db: Kysely<DB> }) {
  return createMiddleware(async (c, next) => {
    if (c.req.method !== 'OPTIONS') return next()
    const origin = c.req.header('origin')
    if (!origin || !(await isOriginAllowedAnywhere(deps.db, origin))) return c.body(null, 403)
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Encoding',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    })
  })
}

// Runs after token verification. Requests without an Origin header (curl, servers) pass.
export function sdkOriginCheck(deps: { db: Kysely<DB> }) {
  return createMiddleware<UploadEnv>(async (c, next) => {
    const origin = c.req.header('origin')
    if (origin === undefined) return next()
    if (!(await isOriginAllowedForProject(deps.db, c.var.upload.projectId, origin))) {
      return c.json({ error: 'origin_not_allowed' as const }, 403)
    }
    await next()
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.append('Vary', 'Origin')
  })
}

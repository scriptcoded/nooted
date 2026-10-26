import { randomBytes, randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { AuthUser } from '../auth/middleware.ts'
import type { BlobStore } from '../blobs.ts'
import type { DB } from '../db/schema.ts'

export const DEFAULT_RETENTION_DAYS = 90

export type ProjectSummary = { id: string; name: string; publicKey: string; retentionDays: number | null }

const toSummary = (row: { id: string; name: string; public_key: string; retention_days: number | null }): ProjectSummary => ({
  id: row.id,
  name: row.name,
  publicKey: row.public_key,
  retentionDays: row.retention_days,
})

export function createProjectRepo(db: Kysely<DB>, blobs: BlobStore) {
  const visible = (user: AuthUser) => {
    const q = db.selectFrom('projects').selectAll('projects')
    return user.isAdmin
      ? q
      : q.where('projects.id', 'in', db.selectFrom('project_members').select('project_id').where('user_id', '=', user.id))
  }

  return {
    async create(name: string): Promise<ProjectSummary> {
      const row = {
        id: randomUUID(),
        name,
        public_key: `pk_${randomBytes(16).toString('base64url')}`,
        retention_days: DEFAULT_RETENTION_DAYS,
        created_at: Date.now(),
      }
      await db.insertInto('projects').values(row).execute()
      return toSummary(row)
    },

    async list(user: AuthUser): Promise<ProjectSummary[]> {
      return (await visible(user).orderBy('projects.created_at').orderBy('projects.id').execute()).map(toSummary)
    },

    async get(user: AuthUser, id: string) {
      const row = await visible(user).where('projects.id', '=', id).executeTakeFirst()
      if (!row) return null
      const origins = await db
        .selectFrom('project_origins')
        .select('origin')
        .where('project_id', '=', id)
        .orderBy('origin')
        .execute()
      const members = await db
        .selectFrom('project_members')
        .leftJoin('users', 'users.id', 'project_members.user_id')
        .select(['project_members.email_lower', 'project_members.user_id', 'users.name'])
        .where('project_members.project_id', '=', id)
        .orderBy('project_members.email_lower')
        .execute()
      return {
        ...toSummary(row),
        origins: origins.map((o) => o.origin),
        members: members.map((m) => ({
          email: m.email_lower,
          userId: m.user_id,
          name: m.name,
          pending: m.user_id === null,
        })),
        canManage: user.isAdmin,
      }
    },

    async update(id: string, patch: { name?: string; retentionDays?: number | null }) {
      const set: { name?: string; retention_days?: number | null } = {}
      if (patch.name !== undefined) set.name = patch.name
      if (patch.retentionDays !== undefined) set.retention_days = patch.retentionDays
      if (Object.keys(set).length > 0) await db.updateTable('projects').set(set).where('id', '=', id).execute()
    },

    async remove(id: string) {
      // FK cascades remove origins, members, tokens and items.
      await db.deleteFrom('projects').where('id', '=', id).execute()
      await blobs.deletePrefix(`projects/${id}/`)
    },

    async addOrigin(id: string, origin: string) {
      await db.insertInto('project_origins').values({ project_id: id, origin }).onConflict((oc) => oc.doNothing()).execute()
    },

    async removeOrigin(id: string, origin: string) {
      await db.deleteFrom('project_origins').where('project_id', '=', id).where('origin', '=', origin).execute()
    },

    async addMember(id: string, email: string) {
      const user = await db
        .selectFrom('users')
        .select('id')
        .where((eb) => eb(eb.fn('lower', ['email']), '=', email))
        .where('email_verified', '=', 1)
        .executeTakeFirst()
      await db
        .insertInto('project_members')
        .values({ project_id: id, email_lower: email, user_id: user?.id ?? null })
        .onConflict((oc) => oc.doNothing())
        .execute()
    },

    async removeMember(id: string, email: string) {
      await db.transaction().execute(async (trx) => {
        const member = await trx
          .selectFrom('project_members')
          .select('user_id')
          .where('project_id', '=', id)
          .where('email_lower', '=', email)
          .executeTakeFirst()
        if (!member) return
        await trx.deleteFrom('project_members').where('project_id', '=', id).where('email_lower', '=', email).execute()
        if (member.user_id) {
          await trx
            .updateTable('upload_tokens')
            .set({ revoked_at: Date.now() })
            .where('project_id', '=', id)
            .where('user_id', '=', member.user_id)
            .where('revoked_at', 'is', null)
            .execute()
        }
      })
    },
  }
}

export type ProjectRepo = ReturnType<typeof createProjectRepo>

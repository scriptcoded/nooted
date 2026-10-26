import type { Generated } from 'kysely'

// Timestamps are INTEGER epoch milliseconds; booleans are INTEGER 0/1.

export interface UsersTable {
  id: string
  issuer: string
  subject: string
  email: string
  email_verified: number
  name: string
  created_at: number
}

export interface SessionsTable {
  id_hash: string
  user_id: string
  expires_at: number
  created_at: number
}

export interface LoginAttemptsTable {
  id: string
  state: string
  code_verifier: string
  nonce: string
  return_to: string
  expires_at: number
}

export interface ProjectsTable {
  id: string
  name: string
  public_key: string
  retention_days: number | null
  created_at: number
}

export interface ProjectOriginsTable {
  project_id: string
  origin: string
}

export interface ProjectMembersTable {
  project_id: string
  email_lower: string
  user_id: string | null
}

export interface UploadTokensTable {
  id: string
  hash: string
  user_id: string
  project_id: string
  expires_at: number
  revoked_at: number | null
  created_at: number
}

export interface FeedbackItemsTable {
  id: string
  project_id: string
  client_report_id: string
  reporter_id: string
  note: string
  url: string
  captured_at: number
  status: Generated<string>
  release: string | null
  blob_key: string
  created_at: number
}

export interface DB {
  users: UsersTable
  sessions: SessionsTable
  login_attempts: LoginAttemptsTable
  projects: ProjectsTable
  project_origins: ProjectOriginsTable
  project_members: ProjectMembersTable
  upload_tokens: UploadTokensTable
  feedback_items: FeedbackItemsTable
}

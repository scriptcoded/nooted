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
  capture_count: Generated<number>
  created_at: number
}

// OAuth (MCP access). Secrets (codes, tokens) are stored only as SHA-256 hashes.
// Scopes are space-separated strings, e.g. 'feedback.read feedback.write'.

/** A dynamically registered public client (RFC 7591). */
export interface OauthClientsTable {
  id: string // the client_id
  name: string
  redirect_uris: string // JSON array of strings
  created_at: number
  last_used_at: number | null
}

/** A pending authorization request awaiting the user's decision in the console. Single use. */
export interface OauthRequestsTable {
  id: string
  client_id: string
  user_id: string
  redirect_uri: string
  state: string | null
  code_challenge: string // PKCE S256
  scopes: string
  resource: string
  expires_at: number
  used_at: number | null
}

/** A user's consent for a client. At most one non-revoked grant per (user, client). */
export interface OauthGrantsTable {
  id: string
  user_id: string
  client_id: string
  scopes: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

/** Authorization codes, keyed by the hash of the code. Single use. */
export interface OauthCodesTable {
  hash: string
  grant_id: string
  request_id: string // the oauth_requests row it came from (no FK; requests are cleaned up sooner)
  redirect_uri: string
  code_challenge: string
  resource: string
  scopes: string
  expires_at: number
  used_at: number | null
}

/** Access and refresh tokens, keyed by the hash of the full token string. */
export interface OauthTokensTable {
  hash: string
  kind: string // 'access' | 'refresh'
  grant_id: string
  family: string // refresh-token family id (one per grant issuance chain); access tokens carry their refresh token's family
  expires_at: number
  used_at: number | null // refresh tokens: set when rotated; presenting a used one revokes the grant
  revoked_at: number | null
  created_at: number
  scopes: string // space-separated; copied from the code, or the previous token on refresh
  resource: string // the resource the token is bound to
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
  oauth_clients: OauthClientsTable
  oauth_requests: OauthRequestsTable
  oauth_grants: OauthGrantsTable
  oauth_codes: OauthCodesTable
  oauth_tokens: OauthTokensTable
}

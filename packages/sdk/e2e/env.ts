import { fileURLToPath } from 'node:url'

// Defaults match pnpm dev's neighbours. Dex only allows the console redirect URIs on :3000 and :5173,
// so the server must run on :3000 unless E2E_OIDC_ISSUER points at a Dex that allows another one.
export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3000)
export const PLAYGROUND_PORT = Number(process.env.E2E_PLAYGROUND_PORT ?? 5174)
export const NOOTED_URL = `http://localhost:${SERVER_PORT}`
export const PLAYGROUND_URL = `http://localhost:${PLAYGROUND_PORT}`

export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'password'
export const OIDC_ISSUER = process.env.E2E_OIDC_ISSUER ?? 'http://localhost:5556/dex'

const dir = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export const SDK_DIR = dir('..')
export const SERVER_DIR = dir('../../../apps/server')
/** Generated state (gitignored): the admin's storageState and the project's id and key. */
export const AUTH_DIR = dir('./.auth')
export const STORAGE_STATE = `${AUTH_DIR}/admin.json`
export const PROJECT_FILE = `${AUTH_DIR}/project.json`

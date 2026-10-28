import { fileURLToPath } from 'node:url'

// Own ports, so the suite can run next to pnpm dev (:4800/:4801/:4810). Dex allows the console redirect URI
// on :4820, so change E2E_SERVER_PORT only together with E2E_OIDC_ISSUER pointing at a Dex that allows it.
export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 4820)
export const PLAYGROUND_PORT = Number(process.env.E2E_PLAYGROUND_PORT ?? 4821)
export const NOOTED_URL = `http://localhost:${SERVER_PORT}`
export const PLAYGROUND_URL = `http://localhost:${PLAYGROUND_PORT}`

export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'password'
export const OIDC_ISSUER = process.env.E2E_OIDC_ISSUER ?? 'http://localhost:4856/dex'

const dir = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export const SDK_DIR = dir('..')
export const WEB_DIR = dir('../../../apps/web')
export const SERVER_DIR = dir('../../../apps/server')
/** Generated state (gitignored): the admin's storageState and the project's id and key. */
export const AUTH_DIR = dir('./.auth')
export const STORAGE_STATE = `${AUTH_DIR}/admin.json`
export const PROJECT_FILE = `${AUTH_DIR}/project.json`

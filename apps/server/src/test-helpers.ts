import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './app.ts'
import type { OidcIdentity, OidcProvider } from './auth/oidc.ts'
import { createFsBlobStore } from './blobs.ts'
import type { Config } from './config.ts'
import { migrateToLatest } from './db/migrate.ts'
import { createKysely, openDatabase } from './db/node-sqlite-adapter.ts'
import type { DB } from './db/schema.ts'

export type FakeOidc = OidcProvider & { identity: OidcIdentity }

export function createFakeOidc(identity?: Partial<OidcIdentity>): FakeOidc {
  const fake: FakeOidc = {
    identity: {
      issuer: 'http://oidc.test',
      subject: 'user-1',
      email: 'user@example.com',
      emailVerified: true,
      name: 'Test User',
      ...identity,
    },
    authorizationUrl: ({ state, nonce, codeChallenge, redirectUri }) => {
      const url = new URL('http://oidc.test/authorize')
      url.search = new URLSearchParams({ state, nonce, code_challenge: codeChallenge, redirect_uri: redirectUri }).toString()
      return url.toString()
    },
    // Reads `fake.identity` at call time so tests can change who signs in.
    exchange: async () => ({ ...fake.identity }),
  }
  return fake
}

export const testConfig: Config = {
  publicUrl: 'http://localhost:5173',
  port: 3000,
  dataDir: './data',
  webDistDir: undefined,
  oidcIssuer: 'http://oidc.test',
  oidcClientId: 'nooted',
  oidcClientSecret: 'secret',
  adminEmails: ['admin@example.com'],
}

export async function createTestApp(overrides: { config?: Partial<Config>; identity?: Partial<OidcIdentity> } = {}) {
  const config: Config = { ...testConfig, ...overrides.config }
  const db = createKysely<DB>(openDatabase(':memory:'))
  await migrateToLatest(db)
  const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-test-blobs-')))
  const oidc = createFakeOidc(overrides.identity)
  const app = createApp({ config, db, blobs, oidc })
  return { app, db, blobs, oidc, config }
}

// Signs in through the real login/callback flow using the fake OIDC and returns a cookie header.
// Each distinct email gets its own subject so it maps to its own user.
export async function signIn(t: { app: ReturnType<typeof createApp>; oidc: FakeOidc }, identity: Partial<OidcIdentity> & { email: string }) {
  t.oidc.identity = {
    issuer: 'http://oidc.test',
    subject: `sub-${identity.email.toLowerCase()}`,
    emailVerified: true,
    name: 'Test User',
    ...identity,
  }
  const login = await t.app.request('/auth/login')
  const state = new URL(login.headers.get('location') ?? '').searchParams.get('state') ?? ''
  const cookieValue = (res: Response, name: string) =>
    res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`))?.split(';')[0]?.split('=')[1]
  const res = await t.app.request(`/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: `nooted_login=${cookieValue(login, 'nooted_login')}` },
  })
  const session = cookieValue(res, 'nooted_session')
  if (!session) throw new Error('sign-in failed')
  return { cookie: `nooted_session=${session}` }
}

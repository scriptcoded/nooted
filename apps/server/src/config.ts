import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Resolved from this file, so it does not depend on the working directory.
const defaultSdkDistDir = fileURLToPath(new URL('../../../packages/sdk/dist', import.meta.url))

const httpUrl = () => z.url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' })

const schema = z.object({
  PUBLIC_URL: httpUrl().refine((value) => !value.endsWith('/'), {
    error: 'must not end with a trailing slash',
  }),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be between 1 and 65535' })
    .max(65535, { error: 'must be between 1 and 65535' })
    .default(3000),
  DATA_DIR: z.string().min(1, { error: 'must not be empty' }).default('./data'),
  WEB_DIST_DIR: z.string().min(1, { error: 'must not be empty' }).optional(),
  SDK_DIST_DIR: z.string().min(1, { error: 'must not be empty' }).default(defaultSdkDistDir),
  OIDC_ISSUER: httpUrl(),
  OIDC_CLIENT_ID: z.string().min(1, { error: 'must not be empty' }),
  OIDC_CLIENT_SECRET: z.string().min(1, { error: 'must not be empty' }),
  TRUST_PROXY_HOPS: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(0, { error: 'must be 0 or more' })
    .default(0),
  NOOTED_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== ''),
    )
    .pipe(z.array(z.email({ error: 'contains an invalid email address' }))),
})

export type Config = {
  publicUrl: string
  port: number
  dataDir: string
  webDistDir: string | undefined
  sdkDistDir: string
  oidcIssuer: string
  oidcClientId: string
  oidcClientSecret: string
  adminEmails: string[]
  trustProxyHops: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat blank values (e.g. `PORT=` in an env file) the same as unset.
  const raw: Record<string, string | undefined> = {}
  for (const key of Object.keys(schema.shape)) {
    const value = env[key]?.trim()
    raw[key] = value === undefined || value === '' ? undefined : value
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    // One line per variable, even when a variable produces several issues.
    const reported = new Map<string, string>()
    for (const issue of result.error.issues) {
      const key = String(issue.path[0])
      if (reported.has(key)) continue
      const reason = raw[key] === undefined ? 'missing (required)' : issue.message
      reported.set(key, reason)
    }
    const lines = [...reported].map(([key, reason]) => `  - ${key}: ${reason}`)
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`)
  }

  const data = result.data
  return {
    publicUrl: data.PUBLIC_URL,
    port: data.PORT,
    dataDir: data.DATA_DIR,
    webDistDir: data.WEB_DIST_DIR,
    sdkDistDir: data.SDK_DIST_DIR,
    oidcIssuer: data.OIDC_ISSUER,
    oidcClientId: data.OIDC_CLIENT_ID,
    oidcClientSecret: data.OIDC_CLIENT_SECRET,
    adminEmails: data.NOOTED_ADMIN_EMAILS,
    trustProxyHops: data.TRUST_PROXY_HOPS,
  }
}

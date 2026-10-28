import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.ts'

const valid = {
  PUBLIC_URL: 'http://localhost:5173',
  PORT: '3000',
  DATA_DIR: './data',
  OIDC_ISSUER: 'http://localhost:5556/dex',
  OIDC_CLIENT_ID: 'nooted',
  OIDC_CLIENT_SECRET: 'nooted-dev-secret',
  NOOTED_ADMIN_EMAILS: 'admin@example.com',
}

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    assert.deepEqual(loadConfig(valid), {
      publicUrl: 'http://localhost:5173',
      port: 3000,
      dataDir: './data',
      webDistDir: undefined,
      sdkDistDir: fileURLToPath(new URL('../../../packages/sdk/dist', import.meta.url)),
      captureImages: 'auto',
      chromiumPath: undefined,
      oidcIssuer: 'http://localhost:5556/dex',
      oidcClientId: 'nooted',
      oidcClientSecret: 'nooted-dev-secret',
      adminEmails: ['admin@example.com'],
      trustProxyHops: 0,
    })
  })

  it('reads TRUST_PROXY_HOPS as a non-negative integer', () => {
    assert.equal(loadConfig({ ...valid, TRUST_PROXY_HOPS: '2' }).trustProxyHops, 2)
    assert.equal(loadConfig({ ...valid, TRUST_PROXY_HOPS: '' }).trustProxyHops, 0)
    assert.throws(() => loadConfig({ ...valid, TRUST_PROXY_HOPS: '-1' }), /TRUST_PROXY_HOPS/)
    assert.throws(() => loadConfig({ ...valid, TRUST_PROXY_HOPS: '1.5' }), /TRUST_PROXY_HOPS/)
    assert.throws(() => loadConfig({ ...valid, TRUST_PROXY_HOPS: 'x' }), /TRUST_PROXY_HOPS/)
  })

  it('reads an optional WEB_DIST_DIR and rejects a blank one as unset', () => {
    assert.equal(loadConfig({ ...valid, WEB_DIST_DIR: '/app/apps/web/dist' }).webDistDir, '/app/apps/web/dist')
    assert.equal(loadConfig({ ...valid, WEB_DIST_DIR: '   ' }).webDistDir, undefined)
  })

  it('reads SDK_DIST_DIR, defaulting to packages/sdk/dist in the repo', () => {
    assert.equal(loadConfig(valid).sdkDistDir, fileURLToPath(new URL('../../../packages/sdk/dist', import.meta.url)))
    assert.equal(loadConfig({ ...valid, SDK_DIST_DIR: '/srv/sdk' }).sdkDistDir, '/srv/sdk')
    assert.equal(loadConfig({ ...valid, SDK_DIST_DIR: '   ' }).sdkDistDir, loadConfig(valid).sdkDistDir)
  })

  it('reads CAPTURE_IMAGES (auto or off) and an optional CHROMIUM_PATH', () => {
    assert.equal(loadConfig(valid).captureImages, 'auto')
    assert.equal(loadConfig({ ...valid, CAPTURE_IMAGES: 'off' }).captureImages, 'off')
    assert.equal(loadConfig({ ...valid, CAPTURE_IMAGES: '' }).captureImages, 'auto')
    assert.throws(() => loadConfig({ ...valid, CAPTURE_IMAGES: 'on' }), /- CAPTURE_IMAGES: /)
    assert.equal(loadConfig({ ...valid, CHROMIUM_PATH: '/usr/bin/chromium' }).chromiumPath, '/usr/bin/chromium')
    assert.equal(loadConfig({ ...valid, CHROMIUM_PATH: ' ' }).chromiumPath, undefined)
  })

  it('applies defaults for PORT and DATA_DIR and treats blank values as unset', () => {
    const config = loadConfig({ ...valid, PORT: '', DATA_DIR: '   ' })
    assert.equal(config.port, 3000)
    assert.equal(config.dataDir, './data')
  })

  it('lists every missing required variable', () => {
    const { OIDC_ISSUER: _issuer, OIDC_CLIENT_SECRET: _secret, ...env } = valid
    assert.throws(
      () => loadConfig(env),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^Invalid configuration:/)
        assert.match(error.message, /- OIDC_ISSUER: missing \(required\)/)
        assert.match(error.message, /- OIDC_CLIENT_SECRET: missing \(required\)/)
        assert.doesNotMatch(error.message, /PUBLIC_URL/)
        return true
      },
    )
  })

  it('rejects an empty environment with every required variable listed', () => {
    assert.throws(() => loadConfig({}), (error: unknown) => {
      assert.ok(error instanceof Error)
      for (const key of ['PUBLIC_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) {
        assert.match(error.message, new RegExp(`- ${key}: missing`))
      }
      return true
    })
  })

  it('rejects a PUBLIC_URL that is not an http(s) URL', () => {
    assert.throws(() => loadConfig({ ...valid, PUBLIC_URL: 'not a url' }), /- PUBLIC_URL: /)
    assert.throws(() => loadConfig({ ...valid, PUBLIC_URL: 'ftp://example.com' }), /- PUBLIC_URL: /)
  })

  it('rejects a PUBLIC_URL with a trailing slash', () => {
    assert.throws(
      () => loadConfig({ ...valid, PUBLIC_URL: 'http://localhost:5173/' }),
      /- PUBLIC_URL: must not end with a trailing slash/,
    )
  })

  it('rejects an invalid OIDC_ISSUER and PORT', () => {
    assert.throws(
      () => loadConfig({ ...valid, OIDC_ISSUER: 'localhost:5556' }),
      /- OIDC_ISSUER: /,
    )
    assert.throws(() => loadConfig({ ...valid, PORT: 'abc' }), /- PORT: /)
    assert.throws(() => loadConfig({ ...valid, PORT: '70000' }), /- PORT: /)
  })

  it('parses admin emails: comma-separated, trimmed, lowercased, empty allowed', () => {
    assert.deepEqual(
      loadConfig({ ...valid, NOOTED_ADMIN_EMAILS: ' Admin@Example.com , ops@example.com,' }).adminEmails,
      ['admin@example.com', 'ops@example.com'],
    )
    assert.deepEqual(loadConfig({ ...valid, NOOTED_ADMIN_EMAILS: '' }).adminEmails, [])
    assert.deepEqual(loadConfig({ ...valid, NOOTED_ADMIN_EMAILS: '  ' }).adminEmails, [])
    assert.deepEqual(loadConfig({ ...valid, NOOTED_ADMIN_EMAILS: undefined }).adminEmails, [])
  })

  it('rejects admin entries that are not email addresses', () => {
    assert.throws(
      () => loadConfig({ ...valid, NOOTED_ADMIN_EMAILS: 'admin@example.com, not-an-email' }),
      /- NOOTED_ADMIN_EMAILS: contains an invalid email address/,
    )
  })
})

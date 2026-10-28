import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ORIGIN, setup } from './test-utils.ts'

describe('discovery', () => {
  it('serves protected resource metadata on both paths', async () => {
    const { t } = await setup()
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await t.app.request(path)
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), {
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [ORIGIN],
        scopes_supported: ['feedback.read', 'feedback.write'],
        bearer_methods_supported: ['header'],
      })
    }
  })

  it('serves authorization server metadata', async () => {
    const { t } = await setup()
    const res = await t.app.request('/.well-known/oauth-authorization-server')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.issuer, ORIGIN)
    assert.equal(body.authorization_endpoint, `${ORIGIN}/oauth/authorize`)
    assert.equal(body.token_endpoint, `${ORIGIN}/oauth/token`)
    assert.equal(body.registration_endpoint, `${ORIGIN}/oauth/register`)
    assert.equal(body.revocation_endpoint, `${ORIGIN}/oauth/revoke`)
    assert.deepEqual(body.response_types_supported, ['code'])
    assert.deepEqual(body.grant_types_supported, ['authorization_code', 'refresh_token'])
    assert.deepEqual(body.code_challenge_methods_supported, ['S256'])
    assert.deepEqual(body.token_endpoint_auth_methods_supported, ['none'])
    assert.deepEqual(body.scopes_supported, ['feedback.read', 'feedback.write'])
  })

  it('allows cross-origin access to discovery, token, register and revoke, but not authorize or the console API', async () => {
    const { t } = await setup()
    const headers = { origin: 'https://app.example.org' }
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource']) {
      const res = await t.app.request(path, { headers })
      assert.equal(res.headers.get('access-control-allow-origin'), '*')
      assert.equal(res.headers.get('access-control-allow-credentials'), null)
    }
    for (const path of ['/oauth/token', '/oauth/register', '/oauth/revoke']) {
      const pre = await t.app.request(path, {
        method: 'OPTIONS',
        headers: { ...headers, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      })
      assert.equal(pre.status, 204, path)
      assert.equal(pre.headers.get('access-control-allow-origin'), '*')
      const post = await t.app.request(path, { method: 'POST', headers })
      assert.equal(post.headers.get('access-control-allow-origin'), '*', path)
    }
    const authorize = await t.app.request('/oauth/authorize', { headers })
    assert.equal(authorize.headers.get('access-control-allow-origin'), null)
    const api = await t.app.request('/api/oauth/grants', { headers })
    assert.equal(api.headers.get('access-control-allow-origin'), null)
  })
})

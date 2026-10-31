import * as client from 'openid-client'

export type OidcIdentity = {
  issuer: string
  subject: string
  email: string
  emailVerified: boolean
  name: string
}

export interface OidcProvider {
  authorizationUrl(params: {
    state: string
    nonce: string
    codeChallenge: string
    redirectUri: string
  }): Promise<string> | string
  exchange(params: {
    currentUrl: URL
    state: string
    nonce: string
    codeVerifier: string
    redirectUri: string
  }): Promise<OidcIdentity>
  /** The provider's end-session URL, or undefined when it has none (or can't be reached). */
  endSessionUrl(params: { postLogoutRedirectUri: string }): Promise<string | undefined> | string | undefined
}

export type OidcSettings = {
  issuer: string
  clientId: string
  clientSecret: string
}

export function createOidcProvider(settings: OidcSettings): OidcProvider {
  let cached: Promise<client.Configuration> | undefined

  // Discovery is lazy so a briefly unavailable IdP doesn't stop the server from
  // booting. A failed attempt is not cached, so the next request retries.
  function getConfiguration(): Promise<client.Configuration> {
    if (!cached) {
      const issuer = new URL(settings.issuer)
      const execute = issuer.protocol === 'http:' ? [client.allowInsecureRequests] : []
      const attempt = client.discovery(issuer, settings.clientId, settings.clientSecret, undefined, { execute })
      cached = attempt
      attempt.catch(() => {
        if (cached === attempt) cached = undefined
      })
    }
    return cached
  }

  return {
    async authorizationUrl({ state, nonce, codeChallenge, redirectUri }) {
      const configuration = await getConfiguration()
      return client
        .buildAuthorizationUrl(configuration, {
          redirect_uri: redirectUri,
          scope: 'openid email profile',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          nonce,
        })
        .href
    },
    async exchange({ currentUrl, state, nonce, codeVerifier }) {
      const configuration = await getConfiguration()
      const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      if (!claims) throw new Error('ID token missing from token response')
      const email = typeof claims.email === 'string' ? claims.email : ''
      const name = typeof claims.name === 'string' && claims.name !== '' ? claims.name : email
      return {
        issuer: settings.issuer,
        subject: claims.sub,
        email,
        emailVerified: claims.email_verified === true,
        name,
      }
    },
    async endSessionUrl({ postLogoutRedirectUri }) {
      // Signing out of Nooted must not depend on the IdP being up.
      const configuration = await getConfiguration().catch(() => undefined)
      if (!configuration?.serverMetadata().end_session_endpoint) return undefined
      // buildEndSessionUrl adds client_id, which identifies us in place of an id_token_hint.
      return client.buildEndSessionUrl(configuration, { post_logout_redirect_uri: postLogoutRedirectUri }).href
    },
  }
}

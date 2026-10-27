# sdk-sign-in Specification

## Purpose

Lets the in-page report window get a short-lived, upload-only token from a Nooted-hosted popup. The token never relies on third-party cookies and is delivered only to the project's allowed origins.

## Requirements

### Requirement: Sign-in window
The system SHALL serve a sign-in page at `/sdk/sign-in` that takes a project key and the opener's origin. If the user has no Nooted session, the page SHALL send them through OIDC sign-in and return to itself afterwards. If the session is valid, it SHALL continue without asking for input.

#### Scenario: Valid session skips the provider
- **WHEN** a member with a valid Nooted session opens `/sdk/sign-in?key=<key>&origin=https://shop.example.com`
- **THEN** the page issues a token without redirecting to the OIDC provider

#### Scenario: No session
- **WHEN** a user without a session opens the sign-in window
- **THEN** they are redirected to the provider and, after signing in, land back on the same sign-in URL

### Requirement: Origin check
The sign-in window SHALL only proceed when the given origin is in the project's allowed origins. It SHALL deliver the token with `postMessage` using exactly that origin as the target origin, so that no other opener origin can receive it.

#### Scenario: Origin not allowed
- **WHEN** the window is opened with an origin that is not in the project's allowed origins
- **THEN** no token is issued and the page shows an error naming the rejected origin

#### Scenario: Lying about the origin
- **WHEN** a page on `https://evil.example` opens the window claiming `origin=https://shop.example.com`
- **THEN** the browser does not deliver the message, because the target origin does not match the real opener

### Requirement: Membership check
The sign-in window SHALL issue tokens only to members of the project and to instance admins. Otherwise it SHALL post an error message to the opener and show an explanation.

#### Scenario: Not a member
- **WHEN** a signed-in user who is not a member opens the window for a project
- **THEN** no token is issued and the opener receives `{ type: "nooted:sign-in-error", reason: "not_member" }`

### Requirement: Token delivery
On success, the window SHALL post `{ type: "nooted:token", token, expiresAt, user: { name, email } }` to the opener and close itself. If there is no opener, it SHALL show a message telling the user to start from the report window. The message SHALL also explain that a site sending `Cross-Origin-Opener-Policy: same-origin` cuts the link to the popup, and that `same-origin-allow-popups` is needed.

#### Scenario: Successful delivery
- **WHEN** a member completes the sign-in window opened from an allowed origin
- **THEN** the opener receives the token message and the window closes

#### Scenario: Opened directly
- **WHEN** the sign-in URL is opened in a tab with no opener
- **THEN** no token is issued and the page explains how to sign in

#### Scenario: Opener severed by COOP
- **WHEN** the report window on a site with `Cross-Origin-Opener-Policy: same-origin` opens the sign-in window
- **THEN** no token is issued and the page names `Cross-Origin-Opener-Policy` as the likely cause and suggests `same-origin-allow-popups`

### Requirement: Upload token properties
Upload tokens SHALL be opaque random values, stored only as hashes, valid for 12 hours, and bound to one user and one project. They SHALL authorize only report upload and their own revocation. Every other API SHALL reject them.

#### Scenario: Expired token
- **WHEN** a report is uploaded with a token issued more than 12 hours ago
- **THEN** the upload is rejected with 401

#### Scenario: Token used on console API
- **WHEN** an upload token is sent as a bearer token to `GET /api/me`
- **THEN** the response is 401

### Requirement: Token revocation
The system SHALL let the holder of an upload token revoke it. Revocation SHALL be idempotent.

#### Scenario: Revoke
- **WHEN** the SDK calls `DELETE /api/sdk/token` with its bearer token
- **THEN** the response is 204 and later uploads with that token return 401

#### Scenario: Revoke twice
- **WHEN** an already revoked token is revoked again
- **THEN** the response is 204

# mcp-authorization Specification

## Purpose
Lets people grant MCP clients access to their change requests with their existing Nooted login, following the MCP authorization spec, and see and revoke those grants later.

## Requirements

### Requirement: Discovery
The system SHALL publish OAuth protected resource metadata for `/mcp` (RFC 9728) naming Nooted as its authorization server, and authorization server metadata (RFC 8414) listing the authorization, token, registration and revocation endpoints, the `authorization_code` and `refresh_token` grants, PKCE method `S256`, and the scopes `feedback.read` and `feedback.write`.

#### Scenario: Client discovers the server
- **WHEN** an MCP client receives a 401 from `/mcp` and follows the `resource_metadata` URL
- **THEN** it finds the authorization server and, from its metadata, all endpoints it needs

### Requirement: Client registration
The system SHALL accept dynamic client registration (RFC 7591) for public clients using the authorization code grant. Redirect URIs SHALL be `https` URLs or `http` loopback URLs (`localhost`, `127.0.0.1`, `[::1]`). Clients never used for a grant SHALL be removed after 30 days.

#### Scenario: Register Claude Code
- **WHEN** a client registers with redirect URI `http://localhost:54321/callback`
- **THEN** it receives a client id

#### Scenario: Unsafe redirect URI
- **WHEN** a client registers with redirect URI `http://example.com/callback`
- **THEN** registration is rejected

### Requirement: Authorization with consent
The authorization endpoint SHALL require PKCE with `S256`, a registered redirect URI matching exactly, and a `resource` that identifies `/mcp`. It SHALL send users without a console session through the normal sign-in first, then show a consent page in the console naming the client, the access requested and the signing-in user. Only approval on that page SHALL issue an authorization code; denial SHALL return `access_denied` to the client.

#### Scenario: Approve
- **WHEN** a signed-in user approves an agent on the consent page
- **THEN** the browser returns to the client's redirect URI with a single-use code and the original `state`

#### Scenario: Not signed in
- **WHEN** a user without a console session starts authorization
- **THEN** they sign in first and then see the consent page

#### Scenario: Deny
- **WHEN** the user denies
- **THEN** the client receives `error=access_denied` and no code

#### Scenario: Forged approval
- **WHEN** another site tries to submit an approval on the user's behalf
- **THEN** no code is issued

### Requirement: Tokens
The token endpoint SHALL exchange a code (valid for 1 minute, once, with the matching PKCE verifier and redirect URI) for an opaque access token valid for 1 hour and a refresh token valid for 30 days, both stored only as hashes and bound to the user, client, granted scopes and the `/mcp` resource. Each refresh SHALL return a new refresh token and invalidate the old one; reuse of an old refresh token SHALL revoke the whole grant.

#### Scenario: Exchange code
- **WHEN** a client exchanges a fresh code with the right verifier
- **THEN** it receives an access token and a refresh token

#### Scenario: Wrong verifier
- **WHEN** a client exchanges a code with a wrong PKCE verifier
- **THEN** the request fails with `invalid_grant`

#### Scenario: Refresh token reuse
- **WHEN** a refresh token that was already used is presented again
- **THEN** the request fails and the grant's other tokens stop working

### Requirement: Token boundaries
Access tokens SHALL be accepted only by `/mcp` and only when issued for that resource. The console API SHALL keep accepting only session cookies.

#### Scenario: Token on the console API
- **WHEN** a request to `/api/projects` carries an MCP access token as a bearer token
- **THEN** the response is 401

### Requirement: Revocation
The system SHALL support token revocation (RFC 7009) by clients. A revoked grant SHALL stop working immediately. Signing out of the console SHALL NOT revoke grants.

#### Scenario: Client revokes
- **WHEN** a client revokes its refresh token
- **THEN** that refresh token and the access tokens issued with it stop working

### Requirement: Connected agents page
The console SHALL show the signed-in user a list of the agents they granted access, with the client name, the access granted, when it was granted and when it was last used, and a Revoke action that immediately stops all of that grant's tokens.

#### Scenario: Revoke an agent
- **WHEN** the user revokes Claude Code on the Connected agents page
- **THEN** it disappears from the list and its next MCP call returns 401

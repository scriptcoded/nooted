# Design

## Context

- **The server** (`apps/server`, Hono, `node:sqlite` via Kysely, type stripping):
  - **Console auth:** session cookies only (`auth/middleware.ts` `requireUser`; the cookie is SameSite=Lax). Sign-in is OIDC through `/auth/login?returnTo=…`, which sanitizes `returnTo`.
  - **Visibility:** project visibility is `projects/repo.get(user, id)` and `list(user)`. Members see their projects, admins see all.
  - **Reports:** `feedback/report-store.ts` loads and caches parsed reports (v2 or legacy). `feedback/routes.ts` serves the console item and capture endpoints.
  - **Status:** `feedback_items.status` is free text defaulting to `'new'`.
- **Public URL:** `PUBLIC_URL` is what browsers see. In dev that's the Vite console at `http://localhost:4800`, which proxies `/api`, `/auth` and `/sdk` to the server on :4810.
- **The MCP SDK:** `@modelcontextprotocol/sdk` 1.32.2 ships `server/webStandardStreamableHttp` (Request → Response), which fits Hono, and `server/mcp` (`McpServer`, tool registration with zod schemas). Its auth helpers are Express-based and unused here.
- **Captures:** stored captures already contain element descriptions (`marks`), viewport, scroll and URLs. Recordings contain `nooted:error` custom events.

## Goals / Non-Goals

**Goals:**
- An MCP client following the current MCP authorization spec connects with no manual token handling: Claude Code with `claude mcp add --transport http`.
- Agents get a digest good enough to act on, and never raw rrweb.
- Grants are visible and revocable by the user who made them.

**Non-Goals:**
- Confidential clients and the client credentials grant.
- Per-project consent (a grant covers all projects the user can see).
- MCP resources and prompts (tools only).
- Images or screenshots of captures for agents.
- Admin-wide grant management.

## Decisions

### MCP transport
**The route:** `mcp/routes.ts` mounts `ALL /mcp`. For each request:
1. authenticate the bearer token (below);
2. build an `McpServer` with the tools bound to the token's user and scopes;
3. create `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, which is stateless;
4. `await server.connect(transport)`, then return `transport.handleRequest(c.req.raw)`.

**Why stateless:** we keep no sessions and no server-sent event streams beyond the single response. That's simple, and it fits the single replica and later k8s.

**Rejected:** the SDK's Express adapters.

**Tool schemas:** zod, as the SDK expects. Zod is already a server dependency, and the SDK version is pinned exactly.

### Tools
| Tool | Input | Output |
|---|---|---|
| `list_projects` | none | text: `- {name} (id {id})` per project |
| `list_feedback` | `projectId`, `status?` (enum), `limit?` (1–50, default 20), `cursor?` | text table plus `nextCursor` in `structuredContent` |
| `get_feedback` | `itemId` | Markdown digest (below) |
| `set_feedback_status` | `itemId`, `status` (enum) | text confirmation |

- **Not found:** the tools return `isError: true` with "Not found" for anything the user can't see. The same message is used for missing items, so existence doesn't leak.
- **Paging:** the cursor is base64url of `createdAt:id`, ordered `created_at DESC, id DESC`.
- **Read tools** need `feedback.read`; `set_feedback_status` needs `feedback.write`. Without it, the tool returns `isError` with "This connection only has read access".

### Digest (`mcp/digest.ts`, pure, unit-tested)
`buildDigest(item, report, consoleUrl)` returns Markdown:
```
# Change request {id}
Status: New · Reported by Name <email> · 2026-10-28 18:57 UTC
Page: https://… · Device: Chrome 156 on Linux, 1280×720 @1x · Release: 1.4.2
Console: {PUBLIC_URL}/projects/{pid}/feedback/{id}

## Note
If I click [1] I want a confirmation …

## Captures
### [1] Pointed at, on /checkout (viewport 390×844, scrolled to 0,612)
- "Add to cart" (button): text "Add to cart", selector `#fx-counter`
### [2] Recording, 0:12, from /cart to /checkout
Errors during the recording:
- TypeError: x is undefined
### [3] Pointed at the whole page, on /
```
- The note stays verbatim, so `[n]` lines up with the capture headings.
- The text excerpt is omitted when it equals the name.
- The user-agent summary reuses a small parser, moved to `@nooted/shared/ua` from `apps/web/src/format.ts` so the server and the console agree.
- **Error messages** come from `nooted:error` custom event payloads (`message` only, capped at 300 characters, at most 10). Stacks and source positions are omitted, because they belong to the host's bundle.
- Legacy reports give "This report was sent by an older SDK and has no captures."
- The digest never includes events, snapshots or `nodeId`.

### OAuth authorization server (`oauth/`)
**Issuer:** `PUBLIC_URL`. Resource: `${PUBLIC_URL}/mcp`.

**Endpoints:**
- `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/mcp` (RFC 9728 path form) return `{ resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ['header'] }`.
- `GET /.well-known/oauth-authorization-server` returns the RFC 8414 metadata: endpoints, `response_types_supported: ['code']`, grant types, `code_challenge_methods_supported: ['S256']`, `token_endpoint_auth_methods_supported: ['none']`, `scopes_supported`, and `revocation_endpoint`.
- `POST /oauth/register` (RFC 7591):
  - accepts `redirect_uris` (1–5 entries), `client_name` (≤ 100 characters), `grant_types`, `response_types` and `token_endpoint_auth_method: 'none'`;
  - validates the redirect URIs (https, or http loopback with any port; no fragments);
  - returns `client_id` (random, 32 bytes base64url) and `client_id_issued_at`;
  - is rate-limited per IP: 20 per hour, held in memory.
- `GET /oauth/authorize`:
  1. **Validate before redirecting:** `client_id` exists; `redirect_uri` exactly matches a registered one; then `response_type=code`, `code_challenge`, and `code_challenge_method=S256`. `resource`, when present, must equal the resource URL, and when absent defaults to it. `scope` must be a subset of the supported scopes; when absent, both scopes are requested.
  2. **Errors:** an invalid `client_id` or `redirect_uri` gets an error page, never a redirect. Other errors redirect to the client with `error` and `state`.
  3. **Without a session:** redirect to `/auth/login?returnTo=<this URL>`, adding `/oauth/authorize` to the `returnTo` allowlist.
  4. **With a session:** store an `oauth_requests` row (10 min, all parameters and the user id) and redirect to the console route `/connect/{requestId}`.
- **Console API:**
  - `GET /api/oauth/requests/:id` (session; the request must belong to the user) returns `{ clientName, redirectHost, scopes }`.
  - `POST /api/oauth/requests/:id/decision` `{ approve: boolean }`:
    - the session is required;
    - the request must be JSON with `Content-Type: application/json`, plus a check that `Origin` equals `PUBLIC_URL`, so a cross-site form can't submit it;
    - it is single-use and must not have expired;
    - **approve:** creates or updates the grant `(user, client)` with the scopes, issues a code (stored hashed, 60 s, single use, with the PKCE challenge, redirect URI, resource and scopes) and returns `{ redirectTo }`;
    - **deny:** returns `{ redirectTo }` with `error=access_denied`;
    - either way the console then sets `location.href = redirectTo`.
- `POST /oauth/token` (form-encoded, public client):
  - `authorization_code`: verify the code (hash, expiry, single use, same client and `redirect_uri`, PKCE S256 of the verifier), then issue an access token (32 bytes, 1 h) and a refresh token (32 bytes, 30 d).
  - `refresh_token`: rotate. Each refresh token belongs to a family per grant. Presenting a used refresh token revokes the grant.
  - Responses carry `Cache-Control: no-store`. Errors follow the RFC 6749 JSON format.
- `POST /oauth/revoke` (RFC 7009) takes a token and `client_id`, revokes it, and answers 200 even for unknown tokens.
- **Tokens:** stored as SHA-256 hashes, prefixed by kind (`nat_` for access, `nrt_` for refresh) so they are recognizable in logs and secret scanners.

**Bearer authentication for `/mcp`** (`oauth/bearer.ts`):
- It looks up the access token hash and checks: not expired, resource equal to the MCP resource, grant not revoked, client existing.
- It then loads the user and updates `grants.last_used_at`, throttled to once per minute.
- On failure, 401 with `WWW-Authenticate: Bearer resource_metadata="{issuer}/.well-known/oauth-protected-resource"` (plus `error="invalid_token"` when a token was given).
- Scope checks happen per tool: a tool needing `feedback.write` returns an `isError` result for a read-only token. At the HTTP level only 401 is used.
- The console's `requireUser` ignores `Authorization` headers, as it does today.

**Data model** (migration `003_oauth`):
- `oauth_clients(id, name, redirect_uris JSON, created_at, last_used_at)`
- `oauth_requests(id, client_id, user_id, redirect_uri, state, code_challenge, scopes, resource, expires_at, used_at)`
- `oauth_grants(id, user_id, client_id, scopes, created_at, last_used_at, revoked_at)`, unique on `(user_id, client_id)` while not revoked
- `oauth_codes(hash, grant_id, request_id, redirect_uri, code_challenge, resource, scopes, expires_at, used_at)`
- `oauth_tokens(hash, kind, grant_id, family, expires_at, used_at, revoked_at, created_at)`

A cleanup on startup and then hourly deletes expired requests, codes and tokens, and clients that are unused and older than 30 days.

### Feedback status
- `packages/shared/src/status.ts` (zod-free subpath `./status`) holds `FEEDBACK_STATUSES = ['new','in_progress','done','dismissed']` and labels.
- Migration `003` maps any unknown status to `new`. The schema can't add a CHECK constraint easily in SQLite with ALTER, so validation happens in code at every write.
- Console: `PATCH /api/projects/:id/feedback/:itemId` `{ status }`, for members only.
- MCP: `set_feedback_status` calls the same repo function.
- UI: on the item page the status chip in the metadata card becomes a select menu. The list shows coloured status chips: New in blue, In progress in amber, Done in green, Dismissed in grey.

### Console UI
- `/connect/$requestId`, a full-page consent card that doesn't use the project layout. It shows:
  - the title "Connect {clientName} to Nooted?";
  - "Signed in as {email}";
  - what it can do: "Read change requests in your projects", plus "Update their status" when write access is requested;
  - "It will be able to see every project you can see." and "You can disconnect it at any time under Connected agents.";
  - the redirect host in small text;
  - Deny and Allow buttons.
  - Expired or used requests show "This request has expired. Start again from your agent."
- **Connected agents page** (`/settings/agents`), opened from the user menu in the app bar. It is a table of client name, access, connected date (relative) and last used ("never" when unused), with a Revoke button behind a confirm dialog, and an empty state that explains how to connect, including the `claude mcp add` command with the MCP URL filled in and a copy button.
- Status select on the item page, and status chips in the list.

### Dev and deployment
- Vite proxies `/mcp`, `/oauth` and `/.well-known` to :4810, so the dev MCP URL is `http://localhost:4800/mcp`.
- In production the server serves everything on one origin.
- The README documents connecting Claude Code: `claude mcp add --transport http nooted https://nooted.example.com/mcp`, then `/mcp` in Claude Code to authenticate.

### Testing
- **Server unit tests:**
  - discovery documents;
  - registration validation and the rate limit;
  - authorize parameter validation: an error page for a bad client or redirect URI, redirects for other errors;
  - login redirect without a session;
  - the consent decision: CSRF checks, single use, expiry;
  - the token exchange: PKCE, redirect URI, expiry, single use;
  - refresh rotation and reuse detection;
  - revocation; bearer checks (expired, wrong resource, revoked grant); console API rejecting bearer tokens;
  - status update rules.
- **MCP tests** with the SDK's `Client` and `StreamableHTTPClientTransport`, using a `fetch` that calls `app.request`:
  - tool listing;
  - project scope (another project's item is not found; removed membership takes effect);
  - list paging and the filter;
  - the digest content and the absence of events, by stringifying and checking that no `"type":2` snapshot and no node ids appear;
  - status updates with read-only and write tokens.
- **Digest unit tests:** golden Markdown for point, whole-page, recording-with-errors and legacy reports.
- **E2E** (the existing harness, console served):
  - an end-to-end OAuth flow driven by a small script client: register, open the authorize URL in the browser as admin, approve on the consent page, catch the redirect on a local loopback listener, exchange the code, call `get_feedback` through `/mcp` for a report sent through the SDK, and check the digest;
  - deny;
  - the Connected agents page lists the grant and Revoke makes `/mcp` return 401;
  - changing the status on the item page shows up in the list and through MCP.

## Risks / Trade-offs

- [MCP auth spec revisions] → It follows the current spec's required parts: RFC 9728 discovery, RFC 8414 metadata, PKCE and resource indicators. DCR is supported because current clients rely on it. The pinned SDK version is tested against.
- [Open dynamic registration can be spammed] → It's rate-limited per IP, unused clients are cleaned up after 30 days, and a client can do nothing without a user's consent.
- [A grant covers all of the user's projects] → The consent text says so plainly. Per-project scoping can come later.
- [Tool output is shown to an LLM and may contain user-written text (notes, page text)] → It's labelled as reporter-provided content. That's the nature of feedback. No raw DOM is included.
- [Dev PUBLIC_URL is the Vite origin] → All OAuth and MCP paths are proxied, and the issuer and resource stay consistent with what clients see.

## Migration Plan

Migration `003` creates the OAuth tables and normalizes statuses. It is additive, needs no backfill and has no rollback concerns beyond dropping the tables. Deploy the server and console together.

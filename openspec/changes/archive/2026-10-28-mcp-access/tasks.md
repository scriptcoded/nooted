# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial). E2E needs ports 4820/4821 free, or the alternate-port setup in `packages/sdk/e2e/README.md`.

## 1. Feedback status [sonnet]

- [x] 1.1 Add `@nooted/shared/status` (statuses and labels) and `@nooted/shared/ua`, moving the user-agent summary out of `apps/web/src/format.ts`. Write migration `003` (the OAuth tables per design.md "Data model", and normalizing unknown statuses to `new`), a repo function `setStatus` with validation, and `PATCH /api/projects/:id/feedback/:itemId` (members only, 404 otherwise). Tests cover the migration, valid and invalid statuses, and a non-member getting 404. Verify with `pnpm -r test` and `pnpm typecheck`.
- [x] 1.2 Console: a status select on the item page, and coloured status chips in the list. Verify with the web typecheck and build.

## 2. OAuth authorization server [sonnet]

- [x] 2.1 Discovery documents, dynamic client registration (validation and rate limit) and the cleanup job. Tests cover the metadata shapes, accepted and rejected redirect URIs, and the rate limit.
- [x] 2.2 The authorize endpoint (validation order, error page vs redirect, the login redirect via the `returnTo` allowlist, the stored request), the console API for the request and the decision (same-origin and JSON checks, single use, expiry), codes, `/oauth/token` (code exchange with PKCE, refresh rotation, reuse detection) and `/oauth/revoke`. Tests cover each rule in the `mcp-authorization` spec, including a forged approval (cross-origin `Origin` header, or a form post) being rejected.
- [x] 2.3 Bearer authentication for `/mcp` (hash lookup, expiry, resource, revoked grant, last-used throttling) with the `WWW-Authenticate` challenge, plus a test that the console API rejects bearer tokens.

## 3. MCP server [sonnet]

- [x] 3.1 Add `@modelcontextprotocol/sdk` pinned to exactly 1.32.2, and the stateless `/mcp` route with `McpServer` and `WebStandardStreamableHTTPServerTransport`. Implement the four tools with project scope, the not-found rule, paging and scope checks.
- [x] 3.2 Implement `mcp/digest.ts` per design.md, with golden-Markdown unit tests (point, whole page, recording with errors, legacy). Add MCP integration tests using the SDK `Client` with a `fetch` that calls `app.request`: tool listing, scope (another project, removed membership), paging and the filter, digest content with no rrweb data, and status updates with read-only and write tokens. Verify with `pnpm --filter @nooted/server test`.

## 4. Console [sonnet]

- [x] 4.1 The consent page at `/connect/$requestId` per design.md (including the expired state), and the Connected agents page at `/settings/agents`, linked from the user menu (table, revoke with confirmation, an empty state with the `claude mcp add` command and a copy button). Add the Vite proxy entries for `/mcp`, `/oauth` and `/.well-known`. Verify with the web typecheck and build.

## 5. End-to-end, docs and review [sonnet]

- [x] 5.1 E2E in the existing harness:
  - the full OAuth flow with a script client (register, authorize in the browser as admin, approve, catch the code on a loopback listener, exchange it, call `get_feedback` over `/mcp` for an SDK-sent report, and check the digest);
  - deny;
  - Connected agents listing the grant, with Revoke making `/mcp` return 401;
  - a status change on the item page showing in the list and through MCP.
- [x] 5.2 README: an "Agents (MCP)" section covering how to connect Claude Code and other clients, what agents can see, the statuses, and how to revoke. Take Playwright screenshots of the consent page, Connected agents (empty and with a grant) and the item page status menu at 390 and 1280 px; look at them and fix what's off.
- [x] 5.3 Hand check (the user): connect Claude Code to the dev server (`claude mcp add --transport http nooted http://localhost:4800/mcp`), authenticate, ask it to list and read a change request, and mark it done.
- [x] 5.4 Run `pnpm typecheck`, `pnpm -r test` and the full e2e suite.

## Workflow follow-up

- Archive the change once it's reviewed (`/opsx:archive`).

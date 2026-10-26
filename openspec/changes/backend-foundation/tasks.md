# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial).

## 1. Setup and configuration [haiku]

- [x] 1.1 Add server deps (`kysely`, `openid-client`, `zod`, `@hono/zod-validator`) and switch scripts to `node --env-file-if-exists=.env`. Add `"test": "node --test"`. Verify `pnpm --filter @nooted/server dev` still serves `/api/health`.
- [x] 1.2 Create `packages/shared` (`@nooted/shared`, `exports` → `./src/index.ts`, typecheck script), with a placeholder export. Add it as a server dependency and verify that `node src/index.ts` imports it under type stripping without errors.
- [x] 1.3 Implement `config.ts`: parse and validate the env vars listed in design.md, failing fast with a readable error. Add `.env.example` and a `node:test` covering missing and invalid values. Verify with `pnpm --filter @nooted/server test`.
- [x] 1.4 Add `dev/dex.yaml` (issuer `http://localhost:5556/dex`, static client `nooted` with redirect `http://localhost:5173/auth/callback`, static users `admin@example.com` and `dev@example.com`) and `docker-compose.yml` with a `dex` service. Verify that `docker compose up dex` serves `/.well-known/openid-configuration`.

## 2. Persistence [sonnet]

- [x] 2.1 Implement `db/node-sqlite-adapter.ts`, which wraps `DatabaseSync` (WAL, foreign keys) for Kysely's `SqliteDialect`. Test insert/select/update round-trips, `numAffectedRows`, `insertId`, a rolled-back transaction and `stream()` against an in-memory database.
- [x] 2.2 Implement `db/schema.ts` (the `DB` interface), migration `001_init.ts` with all tables from design.md using Kysely's schema builder, and a `Migrator` with a static provider run at startup. Test that migrations apply once on an in-memory database, are skipped on a second run, and that the resulting tables match the `DB` interface (insert and select one row per table).
- [x] 2.3 Implement `blobs.ts` (`BlobStore` interface + `FsBlobStore` with temp-file + rename and `deletePrefix`). Test put/get round-trip byte equality, delete and prefix delete in a temp dir.
- [x] 2.4 Add a test helper that builds the app with an in-memory db, a temp blob store and a fake `OidcProvider`. Verify it with a smoke test hitting `/api/health`.

## 3. User auth [sonnet]

- [x] 3.1 Implement the `OidcProvider` interface and the `openid-client` implementation (discovery, PKCE, state, nonce).
- [x] 3.2 Implement `/auth/login` and `/auth/callback` with `login_attempts`, return-path sanitization, user provisioning keyed by issuer+subject, email/name refresh, admin evaluation from `NOOTED_ADMIN_EMAILS` (verified emails only) and linking pending memberships. Tests cover each `user-auth` scenario (success, state mismatch, unsafe returnTo, first sign-in, changed email, admin added/removed).
- [x] 3.3 Implement sessions (hashed ids, 7-day expiry, cookie flags), session middleware, `POST /auth/logout` and `GET /api/me`. Tests cover valid, expired and anonymous requests and logout.

## 4. Projects [sonnet]

- [x] 4.1 Implement the projects repo and routes: create (admin, generates `pk_` key), list (filtered by membership), get, rename, delete (cascades items and blob prefix, revokes tokens), with 403/404 rules. Tests cover the creation, visibility and deletion scenarios.
- [x] 4.2 Implement allowed-origin add/remove with normalization and validation. Tests cover the valid and invalid origin scenarios.
- [x] 4.3 Implement member add/remove by email (case-insensitive, pending until sign-in, removal revokes that user's tokens for the project) and the retention setting (default 90, nullable for unlimited, admin-only). Tests cover each membership and retention scenario.

## 5. SDK sign-in and tokens [sonnet]

- [x] 5.1 Implement upload tokens (`nt_` prefix, hashed, 12h, user+project bound) and bearer middleware that only `/api/sdk/*` uses. Test that expired, revoked and console-API uses are rejected.
- [x] 5.2 Implement the server-rendered `/sdk/sign-in` page: redirect without a session, origin allow-list check, membership check with a `nooted:sign-in-error` message, token issue, `postMessage` to the exact origin, close, no-opener message, strict CSP with a nonce. Tests check the redirect, the rejected origin, non-member, and that the success HTML contains the token message targeted at the given origin.
- [x] 5.3 Implement `DELETE /api/sdk/token` (idempotent 204) and SDK CORS (preflight checked against the union of origins, actual requests checked against the token's project, `Vary: Origin`). Tests cover the revoke scenarios and allowed/foreign origins.

## 6. Report ingestion [sonnet]

- [x] 6.1 Define the `ReportPayload` zod schema in `@nooted/shared` per the `report-ingestion` spec and export its TS type. Unit-test valid and invalid payloads.
- [x] 6.2 Implement `POST /api/sdk/reports`: 10 MB body limit, gunzip with a 100 MB `maxOutputLength` (→ 413), validation (→ 400), idempotency by client report id (→ 200), store the compressed bytes as the blob, then insert the item (deleting the blob if the insert fails), → 201. Tests cover every `report-ingestion` upload scenario, including a gzip-bomb fixture.
- [x] 6.3 Implement `GET /api/projects/:id/feedback` (members only, newest first, no raw data). Tests cover the member and non-member scenarios.

## 7. Web console [sonnet]

- [x] 7.1 Extend the Vite proxy to `/auth` and `/sdk`. Add an auth guard in the root route (`/api/me`; on 401 send the browser to `/auth/login?returnTo=…`), an app bar with the user's name and a sign-out button. Verify by hand that signing in through Dex lands back in the console.
- [x] 7.2 Add a projects list page and a create-project dialog (admins only). Verify that typecheck passes and a project can be created by hand.
- [x] 7.3 Add a project settings page: public key with a copy button and a ready-to-paste SDK snippet placeholder, allowed origins, members and retention (editable by admins, read-only otherwise). Verify by hand.
- [x] 7.4 Add a read-only feedback list page per project (MUI table: note, URL, reporter, status, created). Verify by hand that an uploaded test report appears.

## 8. Packaging and docs [haiku]

- [x] 8.1 Serve `apps/web/dist` from the server in production with SPA fallback that excludes `/api`, `/auth` and `/sdk`. Verify with `pnpm --filter @nooted/web build` and `pnpm --filter @nooted/server start` that `/projects` returns the SPA.
- [x] 8.2 Add a multi-stage `Dockerfile` (node:26 slim, pnpm, builds web, runs the server from `.ts`, `DATA_DIR=/data` volume) and a `server` service in compose. Verify that `docker compose up` serves the console and that sign-in works.
- [x] 8.3 Write `README.md` covering setup (`fnm use 26`, `pnpm i`, `docker compose up dex`, `pnpm dev`), the env vars and the SDK HTTP contract (sign-in window URL and messages, upload endpoint, revoke). Verify by following it from a clean checkout.

## 9. Integration check [sonnet]

- [x] 9.1 End-to-end by hand: sign in as admin, create a project, add origin `http://localhost:5174`, open the sign-in window from a test page on that origin, receive a token, upload a gzipped sample report with `curl`/`fetch`, see it in the feedback list, revoke the token and confirm the next upload gets 401. Then run `pnpm typecheck` and `pnpm -r test` and confirm both pass.

## Workflow follow-up

- Archive the change once it's reviewed (`/opsx:archive`).

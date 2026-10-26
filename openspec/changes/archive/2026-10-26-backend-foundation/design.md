# Design

## Context

The repo has a scaffold: `apps/server` is Hono on Node 26 running `.ts` directly (native type stripping, `erasableSyntaxOnly`), and `apps/web` is Vite + TanStack Router/Query + MUI, calling the server through Hono's typed client (`hc<AppType>`). There is no persistence, auth or domain code yet. See proposal.md for scope and specs/ for required behavior.

## Goals / Non-Goals

**Goals:**
- Server modules that later changes (digests, tracking, MCP) can extend without restructuring.
- Every security-relevant behavior in the specs covered by automated tests that need no live OIDC provider.
- A one-command local setup: `docker compose up dex` plus `pnpm dev`.

**Non-Goals:**
- Playwright/Chromium in the image (added with `report-digests`).
- Background job runner, retention cleanup, MCP OAuth endpoints.
- Horizontal scaling. Single replica by design.

## Decisions

### Server layout
```
apps/server/src/
  index.ts            # serve(); also serves apps/web/dist in production
  app.ts              # composes routers, exports AppType
  config.ts           # parse + validate env once at startup
  db/                 # open DatabaseSync, migrations/NNN-*.sql, runner
  blobs.ts            # BlobStore interface + FsBlobStore
  auth/               # oidc.ts, sessions.ts, middleware.ts, routes.ts
  projects/           # repo.ts, routes.ts
  sdk/                # tokens.ts, sign-in.ts (HTML page), reports.ts, cors.ts
  feedback/           # repo.ts, routes.ts (read-only list)
```
Each domain folder has a `repo.ts` of plain functions taking the `db` handle (no classes, which also keeps erasable syntax simple) and a `routes.ts` exporting a chained Hono router, so `AppType` stays fully typed.

### Data: Kysely on `node:sqlite`
Queries go through **Kysely**, a type-safe query builder: the schema is a TS `DB` interface in `db/schema.ts`, and every query result is typed. Kysely is plain TS with no codegen or decorators, so it works with type stripping. It also supports Postgres, which keeps a later move cheap.
- **Driver:** `node:sqlite` (`DatabaseSync`, WAL, `foreign_keys = ON`), because it's built into Node 26 and needs no native addon. Kysely's `SqliteDialect` expects a `better-sqlite3`-shaped database, so `db/node-sqlite-adapter.ts` wraps `DatabaseSync`: `prepare()` returns an object with `reader` (derived from `StatementSync.columns().length > 0`), `all`, `run` (mapping `changes`/`lastInsertRowid`) and `iterate`, plus `close()`. The first persistence task smoke-tests it.
- **Migrations:** Kysely's `Migrator` with migrations written as TS files using the schema builder, which stays portable to Postgres. They're registered in a static provider (an explicit import list) rather than read from the filesystem, so the order is explicit and bundling is never a concern.
- **Repos:** each `repo.ts` takes `db: Kysely<DB>`. Transactions use `db.transaction()`.
- **Alternatives considered:** raw SQL (results untyped, row types drift); Drizzle (no `node:sqlite` driver on stable 0.45, so it would need `sqlite-proxy`); Prisma (codegen, engine); TypeORM and MikroORM (decorators aren't erasable syntax).
Tables: `users(id, issuer, subject, email, email_verified, name)`, `sessions(id_hash, user_id, expires_at)`, `login_attempts(id, state, code_verifier, nonce, return_to, expires_at)`, `projects(id, name, public_key, retention_days NULL=unlimited)`, `project_origins(project_id, origin)`, `project_members(project_id, email_lower, user_id NULL)`, `upload_tokens(id, hash, user_id, project_id, expires_at, revoked_at)`, `feedback_items(id, project_id, client_report_id, reporter_id, note, url, captured_at, status, release, blob_key, created_at, UNIQUE(project_id, client_report_id))`.
IDs come from `crypto.randomUUID()`.

### Blobs: interface plus filesystem implementation
`BlobStore { put(key, bytes), get(key), delete(key), deletePrefix(prefix) }`. `FsBlobStore` writes under `DATA_DIR/blobs` with temp-file + rename for atomicity. An S3 implementation can be added later without changing callers.

### OIDC: `openid-client` (v6)
It's maintained, standards-complete, and handles discovery, PKCE and nonce. The `/auth/login` route creates a `login_attempts` row and sets a short-lived httpOnly cookie that references it. `/auth/callback` consumes the row, so a replayed callback fails. Using a DB row means we don't need a cookie-signing secret.
The OIDC client sits behind a small `OidcProvider` interface (`authorizationUrl`, `exchange`) so tests can inject a fake.
Admin status and pending memberships require `email_verified: true`. Dex's static users report it as verified.

### Sessions and tokens
Session cookie `nooted_session` holds 32 random bytes, and the DB stores only their SHA-256. Upload tokens use the same scheme with prefix `nt_`, so they're recognizable in logs. Project public keys use `pk_` plus 16 random bytes. Bearer auth is used only by `/api/sdk/*`, and console routes read only the cookie, which is how "upload tokens are rejected elsewhere" works.

### One origin for console and API
In production the server serves the built web app (with SPA fallback) next to `/api`, `/auth` and `/sdk`, so the session cookie is first-party and the console API needs no CORS.
This covers only Nooted's own console. The recorded apps stay on their own origins, and everything they do with Nooted is cross-origin and cookie-free. The sign-in popup is a top-level window on Nooted's origin, so the session cookie is first-party *inside the popup*. The token comes back with `postMessage`, and uploads and revocation use `fetch` with a bearer token under CORS (see "SDK CORS"). The recorded pages never need a Nooted cookie, so blocked third-party cookies don't affect the SDK. In dev, Vite proxies `/api`, `/auth` and `/sdk` to the server, and `PUBLIC_URL=http://localhost:5173`, so the OIDC redirect URI and cookies behave the same as in production.

### Sign-in window is server-rendered
`/sdk/sign-in` is a tiny HTML page rendered by Hono (no SPA bundle), with a strict CSP and an inline nonce'd script. It loads quickly in a popup, and it keeps the SDK contract independent of console UI changes. Without a session it redirects to `/auth/login?returnTo=<its own URL>`.
The server can't tell whether the page has an opener, so the token is minted in a second step:
1. The page checks the session, key, allowed origin and membership, then renders *without* a token.
2. Its script checks `window.opener`. Without an opener, it shows the "start from the report window" message and nothing is minted.
3. With an opener, it calls same-origin `POST /sdk/sign-in/token`. That endpoint re-runs every check, requires an `X-Nooted-Sign-In` header and rejects a foreign `Origin`, which defeats CSRF.
4. The script posts the token to `opener` with the exact target origin and calls `close()`.

### SDK CORS
A preflight (`OPTIONS`) carries no `Authorization` header, so it can't be checked per project. A preflight passes if its origin is in *any* project's allowed origins. The actual request then enforces the token's own project, which is where the security boundary is. `Access-Control-Allow-Origin` echoes the exact origin and adds `Vary: Origin`. No credentials are involved.

### Report payload schema lives in `packages/shared`
A zod schema (`ReportPayload`) in a new `@nooted/shared` workspace package is used by the server for validation and will be used by the SDK for typing. The package exports its `.ts` source directly. Node resolves workspace symlinks to their real path outside `node_modules`, so type stripping applies; a task verifies this.

### Upload handling
Hono `bodyLimit` caps the compressed body at 10 MB. Decompression uses `zlib.gunzip` with `maxOutputLength: 100 MB`, which aborts with a `RangeError`, mapped to 413. Validation runs on the parsed JSON. The *compressed bytes as received* are stored as the raw blob (`projects/<projectId>/reports/<itemId>.json.gz`, so project deletion is a single prefix delete), which is byte-for-byte raw and smaller. Order of operations: idempotency lookup → write blob → insert row. If the insert fails, the blob is deleted.

### Testing
`node --test` with Hono's `app.request()` against an in-memory database, a temp-dir blob store and a fake `OidcProvider`. There's no test framework dependency, and it runs under type stripping. The Dex flow is checked by hand with compose.

### Configuration
Env vars, loaded with `node --env-file-if-exists=.env`: `PUBLIC_URL`, `PORT`, `DATA_DIR`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `NOOTED_ADMIN_EMAILS`. Missing or invalid values fail fast at startup with a clear message.

## Risks / Trade-offs

- [Synchronous SQLite blocks the event loop] → Queries are small and indexed. Large blobs live on disk, not in SQLite. Revisit if ingestion gets heavy.
- [Single replica on k8s] → A StatefulSet with one PVC. Storage interfaces keep a Postgres/S3 move contained.
- [Preflight is checked against the union of all origins] → Only reveals that an origin is configured somewhere. The per-project check on the real request is authoritative.
- [Upload token readable by any script on the site (sessionStorage)] → It is scoped to uploads for one project, lasts 12 hours and is revocable. The worst case is spam feedback.
- [Popup blockers] → The SDK must open the window directly from the button tap. Documented as an SDK requirement.
- [`node:sqlite` API changes or adapter gaps] → The adapter is the only code that touches `node:sqlite`, and it's covered by its own tests. Node is pinned to 26 via `.node-version` and the Docker base image. If needed, swapping to `better-sqlite3` means deleting the adapter.

## Migration Plan

Greenfield: there's nothing to migrate. Migrations run automatically at startup. Rollback means redeploying the previous image. Migrations are add-only within this change.

# Nooted

Nooted collects in-app feedback from your users. A small SDK on your site captures a note, the page URL and a session replay of the last few moments, and uploads it to Nooted. Project members review the reports in a web console, where each one becomes a feedback item.

## Requirements

- **Node 26** via [fnm](https://github.com/Schniz/fnm): `fnm use 26` (the version is pinned in `.node-version`).
- **pnpm** via Corepack: `corepack enable`. The pnpm version is pinned by the `packageManager` field in `package.json`.
- **Docker** (Docker Desktop on Windows/macOS, or the Docker engine on Linux) for the local identity provider, and optionally for the full stack.

## Development setup

```sh
pnpm i
cp apps/server/.env.example apps/server/.env
docker compose up -d dex   # local OIDC provider on http://localhost:5556/dex
pnpm dev                   # server on :3000, console on http://localhost:5173
```

Open http://localhost:5173 and sign in with `admin@example.com` / `password`. The admin can create projects and sees every project. `dev@example.com` (same password) is a regular user, useful for testing membership and the "not a member" path.

Vite proxies `/api`, `/auth` and `/sdk` to the server, so the console and the API share one origin in both dev and production.

## Tests and typecheck

```sh
pnpm typecheck   # tsc in every workspace package
pnpm -r test     # node --test for the server and the shared package
```

## Running the full stack in Docker

```sh
docker compose --profile app up --build
```

This builds the image (the console is built into it) and serves everything on http://localhost:3000. Sign in with the same accounts. Stop it with `docker compose --profile app down` (add `-v` to delete the data volume).

Both Dex services publish port 5556, so stop the dev one first if it is running (`docker compose stop dex`). The compose setup works like this: the `server` container shares the network namespace of `dex-app`. The issuer is therefore `http://localhost:5556/dex` for the browser and for the server alike, and no `/etc/hosts` edits are needed. Dex's static client allows the redirect URI for both `http://localhost:5173` and `http://localhost:3000`.

Data lives in the named volume `nooted-data`, mounted at `/data`.

## Configuration

Set in `apps/server/.env` for `pnpm dev`, or in `docker-compose.yml` for the container. The server reads these at startup and exits with a message naming every invalid or missing variable.

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `PUBLIC_URL` | yes | none | Public origin of Nooted's console, for example `http://localhost:5173` in dev or `http://localhost:3000` in Docker. Used for the OIDC redirect URI and cookies. No trailing slash. |
| `PORT` | no | `3000` | Port the HTTP server listens on. |
| `DATA_DIR` | no | `./data` | Directory for the SQLite database (`nooted.db`) and uploaded report blobs. Relative to the working directory. In Docker: `/data`. |
| `WEB_DIST_DIR` | no | unset | Directory with the built console, served with an SPA fallback. When unset and `NODE_ENV=production`, it defaults to `apps/web/dist` next to the server. Set to `/app/apps/web/dist` in the Docker image. |
| `OIDC_ISSUER` | yes | none | Issuer URL of the OpenID Connect provider. Dev: `http://localhost:5556/dex`. |
| `OIDC_CLIENT_ID` | yes | none | Client ID registered with the provider. Dev: `nooted`. |
| `OIDC_CLIENT_SECRET` | yes | none | Client secret for that client. Dev: `nooted-dev-secret`. |
| `NOOTED_ADMIN_EMAILS` | no | empty | Comma-separated email addresses of instance admins. Matched case-insensitively. |

`NODE_ENV` is not a Nooted setting, but the server reads it for the `WEB_DIST_DIR` default above.

## SDK HTTP contract

This is what the Nooted SDK does, and what you need to know to integrate with it or call the API yourself. Nooted's own console is not part of the SDK contract.

### Sign-in window

Open the window with `window.open` from a user gesture (a click handler), or the browser's popup blocker will stop it:

```
GET /sdk/sign-in?key=<pk_…>&origin=<page origin>
```

- `key` is the project's public key (`pk_…`), shown on the project settings page in the console.
- `origin` is the origin of the page that opens the window, for example `https://shop.example.com`. It must be a plain origin (scheme, host and port, no path, query or fragment) and must be in the project's allowed origins.
- If the user has no Nooted session, the window redirects through the identity provider and returns to the same URL.
- If the key is unknown or the origin is not allowed, the window shows an explanation and sends nothing. If the user is not a member, it shows an explanation and posts `nooted:sign-in-error` (below). In every failure case no token is sent.

The window delivers its result to `window.opener`, and only to the origin in the `origin` parameter:

```ts
// On success, then the window closes itself
{ type: 'nooted:token', token: 'nt_…', expiresAt: 1767225600000, user: { name, email } }

// When the signed-in user is not a member of the project
{ type: 'nooted:sign-in-error', reason: 'not_member' }
```

`expiresAt` is a Unix timestamp in milliseconds. If the window is opened without an opener (for example, in a new tab), it shows a message and sends nothing.

### Upload token

- The token is an opaque string beginning with `nt_`.
- It lasts **12 hours**.
- It is bound to **one user and one project**.
- It authorizes **only** `POST /api/sdk/reports` and `DELETE /api/sdk/token`. Every other API rejects it.
- The server stores only a hash of it, and the holder can revoke it at any time.

### Upload a report

```
POST /api/sdk/reports
Authorization: Bearer nt_…
Content-Type: application/json
Content-Encoding: gzip

<gzip-compressed JSON body: ReportPayload from @nooted/shared>
```

`ReportPayload` (defined in `packages/shared/src/report.ts`):

- `clientReportId`: UUID generated by the client (used for retries)
- `note`: 1 to 10,000 characters
- `url`: the page URL, `http` or `https`
- `capturedAt`: positive integer, Unix timestamp in milliseconds
- `release`: optional string, up to 200 characters
- `device`: `{ userAgent, viewport: { width, height, devicePixelRatio } }`
- `events`: a non-empty array of rrweb events (each has a numeric `type`, a numeric `timestamp` and `data`)

Unknown top-level or `device` fields are rejected. Extra fields inside events are kept.

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 201 | `{ id }` | Stored. A new feedback item with status New was created. |
| 200 | `{ id }` | A report with the same `clientReportId` was already accepted for this project. Nothing new was stored, so retries are safe. |
| 400 | `{ error: 'invalid_gzip' \| 'invalid_json' \| 'invalid_report' }` | The body is not valid gzip, not valid JSON, or fails validation. `invalid_report` includes `issues: [{ path, message }]`. |
| 401 | `{ error: 'unauthorized' }` | Missing, malformed, unknown, expired or revoked token. |
| 403 | `{ error: 'origin_not_allowed' }` | The request has an `Origin` header that is not an allowed origin for the token's project. |
| 413 | `{ error: 'payload_too_large' }` | The compressed body is over 10 MB, or it decompresses to over 100 MB. |
| 415 | `{ error: 'unsupported_encoding' }` | `Content-Encoding` is not `gzip`. |

The checks run in this order: token (401), origin (403), encoding (415), size (413), then the body (400, 201 or 200). The `Content-Type` header is not checked, but send `application/json` anyway.

### Revoke a token

```
DELETE /api/sdk/token
Authorization: Bearer nt_…
```

- `204` when the token was revoked. Revoking an already revoked, expired or unknown token also returns `204`, so the call is idempotent.
- `401` when there is no valid `Bearer nt_…` header.
- `403` when the token is known and the request has an `Origin` header that is not allowed for the token's project.

After revocation, uploads with that token get `401`.

### CORS

- Allowed origins are set per project in the console. Only the scheme, host and port are compared, so use the exact origin.
- Preflight (`OPTIONS`) requests carry no token. They succeed for any origin that is allowed on at least one project. The real request then checks the token's own project, and that check is the one that matters.
- Responses echo the exact origin in `Access-Control-Allow-Origin` and send `Vary: Origin`. Credentials are not allowed, so send requests without cookies (`fetch` with `credentials: 'omit'`, the default for cross-origin requests).
- Requests with no `Origin` header (curl, server-side code) are not subject to the origin check.

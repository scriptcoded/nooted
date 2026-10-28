# Nooted

Nooted collects in-app feedback from your users. A small SDK on your site lets users write a change request, point at the elements on the page they mean (optionally with a short demo clip), and uploads it to Nooted. Project members review the reports in a web console, where each one becomes a feedback item.

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
| `SDK_DIST_DIR` | no | `packages/sdk/dist` | Directory with the built SDK bundle, served at `/sdk/v1/nooted.js`. Build it with `pnpm --filter @nooted/sdk build`. |

`NODE_ENV` is not a Nooted setting, but the server reads it for the `WEB_DIST_DIR` default above.

## SDK

The `@nooted/sdk` package adds the feedback button to your site. It is not published to npm yet, so depend on it through the workspace (`"@nooted/sdk": "workspace:*"`).

### Setup

Either paste the loader snippet from the project's settings page in the console into your `<head>`, before other scripts:

```html
<script>…</script>
```

or use the Vite plugin:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import nooted from '@nooted/sdk/vite'

export default defineConfig({
  plugins: [nooted({ projectKey: 'pk_…', nootedUrl: 'https://nooted.example.com' })],
})
```

- `projectKey` (required): the project's public key (`pk_…`), shown on the settings page.
- `nootedUrl` (required): the Nooted server's origin.
- `release` (optional): a version string attached to every report, for example `1.4.2`.
- `inline` (optional, default `false`): inline the loader into `index.html` instead of emitting a separate file. See [Sites with a CSP](#sites-with-a-csp).

The project's allowed origins (settings page) must include the origin of your site, or uploads are refused with `403`.

### API

```ts
import { nooted } from '@nooted/sdk'

nooted.init({ release: '1.4.2', button: true }) // enable on this device and load the SDK
nooted.open()     // open the report window
nooted.signOut()  // revoke the upload token and forget it on this device
nooted.disable()  // turn Nooted off on this device
```

- `init({ release, button })` enables Nooted on this device, loads the SDK and shows the floating button (`button: false` hides it). Call it from the app, for example only for admins. Calls before the SDK has loaded are queued.
- `open()` opens the report window, the same as the other triggers.
- `signOut()` belongs in your app's logout. The next report asks the user to sign in again.
- `disable()` clears the local flag, stops any capture in progress and removes Nooted's UI from the page.

### Enabling on a device

Nooted only runs on devices where it is enabled. Only your app enables it: call `nooted.init()` (for example for signed-in staff, or behind a feature flag) and Nooted stays on for that device across reloads. Call `nooted.disable()` to turn it off again. Nothing in the URL or the report window changes this.

Enabling only shows the floating button and turns on the triggers. Nooted records nothing in the background: nothing is recorded until a user starts a capture, and nothing is uploaded until a user writes a note and sends a report.

### Triggers

- **Shake** a phone. On iOS, the first tap of the floating button asks for motion permission. If it is denied, the button still works.
- **Ctrl+Shift+.** (Cmd+Shift+. on macOS).
- **Floating button**. Drag it anywhere on the screen; it remembers its place on the device.
- **`nooted.open()`** from your own menu item or help link.

### Report window

The floating button is named **Request a change**. It opens a window with a note field, "What should change?". Describe the change in your own words, and add captures to show what you mean:

- **Point** hides the window and shows a bar. Tap or click the parts of the page you mean; tap a selected part again to deselect it. The bar counts them ("2 selected"). While pointing, taps and clicks don't reach the app, so buttons and links don't react. Scrolling still works. Choose **Done** to add the capture, or **Cancel** (or press Escape) to discard it. Choosing Done with nothing selected captures the whole page.
- **Record** starts recording at once and hides the window. Use the page normally, for example to open a menu. Choose **Stop** to add the recording (it stops by itself after 60 seconds; the timer turns amber in the last 10). **Cancel** or Escape discards it.

Each capture puts a token such as `[1]` at your cursor in the note, so you can say "make [1] bigger". You can also type tokens by hand, but a note that mentions a capture that doesn't exist can't be sent.

Captures appear as rows with a thumbnail, "Pointed at" plus the selected elements' names (or "Whole page"), or "Recording" with its length and the page it ends on. Select a row to see the capture large: point captures zoom in on what you selected (**Show whole page** toggles), and recordings can be played back. The **×** on a row removes the capture and its tokens. A report holds up to 10 captures. Errors are recorded only while a recording runs.

**Known limitation:** some apps react to `pointerdown` or `touchstart` before Nooted can intercept them, so pointing at one of their elements may still trigger it. Use **Record** for those, or point at a nearby element instead.

### Privacy

Captures mask every input, textarea and select value by default. Password fields are always masked. Add a `data-nooted` attribute to change this per element:

- `data-nooted="show"` records the values inside the element (passwords stay masked).
- `data-nooted="block"` records an empty placeholder of the same size instead of the element's contents.
- `data-nooted="mask"` replaces the text of the element with `*`.

These rules apply to captures and demo clips alike. The description of a marked element never includes masked or blocked text, or input values.

### Sites with a CSP

Nooted loads its SDK from the Nooted server, and uploads reports to it. Allow the Nooted origin in your Content Security Policy. Use the directives for the way you load the loader:

- **Vite plugin, default (external loader file):**
  ```
  script-src 'self' <nooted-origin>; connect-src <nooted-origin>
  ```
- **Inline snippet:** allow the snippet by its hash. The console shows the hash, or call `loaderCspHash(options)` with the same options you passed to `loaderSnippet(options)`. Changing `release` changes the hash.
  ```
  script-src '<sha256-hash>' <nooted-origin>; connect-src <nooted-origin>
  ```
- **Nonce-based:** render the snippet with your nonce on the `<script>` tag, for example `loaderSnippet(options).replace('<script>', '<script nonce="…">')`. The loader passes the nonce on to the SDK script, so the Nooted origin is not needed in `script-src` (`'strict-dynamic'` also works). `connect-src` still needs the origin.
  ```
  script-src 'nonce-<nonce>'; connect-src <nooted-origin>
  ```

Add these to the directives your site already has. The SDK's own styles are constructed stylesheets, which a CSP does not restrict. Very old browsers without `adoptedStyleSheets` fall back to a `<style>` element, which needs `style-src 'unsafe-inline'`.

The replay player (`/sdk/v1/replay.js`) loads from the Nooted origin the first time a capture is added, not on page load. It uses the same nonce and `script-src` entries as the SDK, so nothing extra is needed there. It replays the recorded styles inline, so under a `style-src` without `'unsafe-inline'` capture previews may look unstyled. The window says so, and sending still works.

If the SDK is blocked, the console shows one `[nooted] Could not load …` warning with the bundle URL. The app keeps working.

The sign-in window needs to reach your page. `Cross-Origin-Opener-Policy: same-origin` cuts that link, so use `same-origin-allow-popups` instead. Sign-in also opens a popup, so allow popups for your site if the browser blocks it.

### Developing the SDK

```sh
pnpm dev   # server, console, the SDK runtime in watch mode, and the playground on http://localhost:5174
```

The playground needs a project key. Create `packages/sdk/.env.local`:

```sh
NOOTED_PROJECT_KEY=pk_…   # public key from the console
# NOOTED_URL=http://localhost:5173   # optional, the default
```

Add `http://localhost:5174` to the project's allowed origins, then open http://localhost:5174/ and press Enable Nooted. The playground takes `?csp=strict|nonce|missing` and `?coop=same-origin` to try the CSP and COOP cases above.

```sh
pnpm --filter @nooted/sdk test    # unit tests
pnpm --filter @nooted/sdk build   # the bundle at packages/sdk/dist, which the server serves
pnpm --filter @nooted/sdk e2e     # browser tests; see packages/sdk/e2e/README.md for prerequisites
```

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
- `url`: the page URL when the report window opened, `http` or `https`
- `capturedAt`: positive integer, Unix timestamp in milliseconds when the report window opened
- `release`: optional string, up to 200 characters
- `device`: `{ userAgent, viewport: { width, height, devicePixelRatio } }`
- `captures`: 0 to 10 captures, each with:
  - `n`: integer from 1 to 10, unique within the report. Every `[n]` token in `note` must refer to a capture in the report, or the report is rejected
  - `url`: the page URL at capture time, and `capturedAt`: Unix timestamp in milliseconds
  - `viewport`: `{ width, height }`, and `scroll`: `{ x, y }`
  - `demo`: boolean, `true` when a demo clip was recorded
  - `events`: rrweb events, at least a Meta and a FullSnapshot. The last event is the final frame. Demo clips may also contain `nooted:error` custom events
  - `marks`: 0 to 20 marked elements, each `{ nodeId, tag, role?, name?, text, selector, rect }`. `text` is at most 200 characters, and `rect` (`{ x, y, width, height }`) is in page coordinates

Unknown top-level or `device` fields are rejected, so payloads with `events`, `focus` or `recording` from before captures get `400`. Extra fields inside events are kept.

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

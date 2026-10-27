# SDK end-to-end tests

Playwright (Chromium) tests that run the real loader and runtime against a real Nooted server.

## Prerequisites

- Dex running: `docker compose up -d dex` (from the repo root).
- `pnpm dev` stopped. The tests start their own server on `:3000` and playground on `:5174` and
  fail fast with a message if either port is taken. (Dex only allows `:3000` and `:5173` as console redirect URIs.)
- Chromium installed: `pnpm --filter @nooted/sdk exec playwright install chromium`

## Running

```
pnpm --filter @nooted/sdk e2e
pnpm --filter @nooted/sdk e2e -- csp.spec.ts     # one file
E2E_VERBOSE=1 pnpm --filter @nooted/sdk e2e      # also print server and playground output
```

## What happens

`global-setup.ts` builds the runtime (`dist/nooted.js`), starts `apps/server` on a temp `DATA_DIR`, signs
in as `admin@example.com` through Dex, creates a project allowing `http://localhost:5174`, then starts the
playground with that project's key in `NOOTED_PROJECT_KEY`. Both processes and the temp directory are
removed afterwards. The admin session (`.auth/admin.json`) and the project id and key (`.auth/project.json`)
are written for the tests and are gitignored. Your `.env.local` is never touched.

The playground picks a policy per request from the page URL: `?csp=strict|nonce|missing` and
`?coop=same-origin` (see `playground/vite.config.ts`).

To run beside a `pnpm dev` that holds the default ports, point the harness at another Dex that allows the
redirect URI, e.g. `E2E_SERVER_PORT`, `E2E_PLAYGROUND_PORT` and `E2E_OIDC_ISSUER` (see `env.ts`).

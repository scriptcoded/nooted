# SDK end-to-end tests

Playwright (Chromium) tests that run the real loader and runtime against a real Nooted server.

## Prerequisites

- Dex running: `docker compose up -d dex` (from the repo root).
- The tests start their own server on `:4820` and playground on `:4821`, so they can run next to `pnpm dev`,
  and fail fast with a message if either port is taken. (Dex allows `:4820` as the e2e console redirect URI.)
- Chromium installed: `pnpm --filter @nooted/sdk exec playwright install chromium`

## Running

```
pnpm --filter @nooted/sdk e2e
pnpm --filter @nooted/sdk e2e -- csp.spec.ts     # one file
E2E_VERBOSE=1 pnpm --filter @nooted/sdk e2e      # also print server and playground output
```

## What happens

`global-setup.ts` builds the runtime (`dist/nooted.js`) and the console (`apps/web/dist`), starts `apps/server` on a temp `DATA_DIR` that also serves the console on the server origin, signs
in as `admin@example.com` through Dex, creates a project allowing `http://localhost:4821`, then starts the
playground with that project's key in `NOOTED_PROJECT_KEY`. Both processes and the temp directory are
removed afterwards. The admin session (`.auth/admin.json`) and the project id and key (`.auth/project.json`, which also holds the temp `dataDir`)
are written for the tests and are gitignored. Your `.env.local` is never touched.

The playground picks a policy per request from the page URL: `?csp=strict|nonce|missing` and
`?coop=same-origin` (see `playground/vite.config.ts`).

To use other ports, set `E2E_SERVER_PORT` and `E2E_PLAYGROUND_PORT`; a different server port also needs
`E2E_OIDC_ISSUER` pointing at a Dex that allows its redirect URI (see `env.ts`).

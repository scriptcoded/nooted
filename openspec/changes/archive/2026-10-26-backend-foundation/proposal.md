# Proposal

## Why

Nooted needs a backend before the SDK can do anything useful: a place to sign in, projects that define which sites may send feedback, a way for the in-page report window to get an upload token, and an endpoint that accepts reports. Everything else (digests, screenshots, tracking, MCP) builds on these.

## What Changes

- Persistent storage: SQLite (`node:sqlite`, queried through Kysely) for metadata, plus a blob store on local disk for report payloads. Both sit behind interfaces so Postgres/S3 can replace them later.
- Sign-in to the Nooted console through a generic OIDC provider (Dex in local dev). Users are provisioned on first login. Instance admins come from configuration.
- Projects with a public project key, allowed origins, members and a retention setting. Admins manage them.
- The SDK sign-in window: a Nooted-hosted page that a site opens in a popup. It authenticates the user (skipping the provider when the Nooted session is still valid), checks project membership and the opener's origin, mints a 12-hour upload-only token and sends it back with `postMessage`.
- Upload tokens can be revoked (backing `nooted.signOut()`).
- A report upload endpoint: it accepts a gzipped report (note, frozen rrweb buffer, metadata) authorized by an upload token, stores the raw payload and creates a feedback item with status **New**.
- A minimal web console: sign in, list and manage projects (admins), and see a read-only list of a project's feedback items.
- A shared `ReportPayload` schema in a new `packages/shared` package, so the SDK prototype can code against the same contract.
- A Docker image (Node 26, server serving the built console) and a dev `docker-compose` with Dex. Chromium is added with `report-digests`.

Out of scope, planned as follow-up changes:
1. `report-digests`: ingestion pipeline with timeline filtering, DOM pruning and Playwright screenshots.
2. `feedback-tracking`: statuses, claims with leases, comments and the tracking UI.
3. `mcp-server`: MCP tools plus the MCP OAuth authorization server, delegating login to OIDC.
4. `sdk`: loader, recorder, report window, triggers and offline queue (the user is prototyping this separately).
5. Retention cleanup job, source maps, voice notes.

## Capabilities

### New Capabilities
- `user-auth`: signing in to Nooted through OIDC, sessions, user provisioning and instance admins.
- `projects`: projects, their public keys, allowed origins, members and retention settings.
- `sdk-sign-in`: the popup sign-in window, upload token issuance, origin-checked delivery and revocation.
- `report-ingestion`: accepting and storing reports from the SDK and creating feedback items.

### Modified Capabilities
None. No specs exist yet.

## Impact

- `apps/server`: new modules for config, database, blob storage, auth, projects, the SDK sign-in window and the report API. New dependencies: an OIDC client library and a cookie/session helper.
- `apps/web`: new routes for login, projects, project settings and the feedback list. The web app keeps calling the server through Hono's typed client.
- New files: `Dockerfile`, `docker-compose.yml` (server + Dex), `dev/dex.yaml`, `.env.example`.
- Public HTTP API that the SDK will depend on: `/sdk/sign-in`, `POST /api/sdk/reports`, `DELETE /api/sdk/token`.

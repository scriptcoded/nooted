# Proposal

## Why

Nooted is ready for a real-site trial, and it will run on the user's Kubernetes cluster. The Docker image builds, but it isn't ready to run there:
- When stopped, the server ignores SIGTERM, so the kubelet kills it after the grace period. That can cut SQLite writes and requests off midway.
- Nothing builds or publishes the image.
- There is no guide for writing manifests around the image.

## What Changes

- **Graceful shutdown:** on SIGTERM or SIGINT the server stops accepting connections and lets in-flight requests finish within a time limit. It then closes the capture renderer's browser and the database, and exits.
- **Image hardening:**
  - a `HEALTHCHECK` against `/api/health`;
  - the image runs with a read-only root filesystem as long as `/tmp` and `/data` are writable;
  - OCI labels: source, revision and version.
- **Published image:** a GitHub Actions workflow runs typecheck and unit tests, then builds the image and pushes it to `ghcr.io/<owner>/nooted`. It runs on pushes to `main` and on `v*` tags. Tags: commit SHA, `main`, `latest` (on version tags) and semver.
- **Deployment guide** (`docs/deploy.md`) for people who write their own Kubernetes manifests:
  - environment variables, and which ones are secrets;
  - the port;
  - the `/data` volume: ReadWriteOnce, one replica, `Recreate` strategy;
  - probes;
  - running behind an ingress with TLS (`PUBLIC_URL`, `TRUST_PROXY_HOPS`);
  - the OIDC redirect URI;
  - resource guidance for Chromium, and `CAPTURE_IMAGES=off`.
- **Out of scope:**
  - Kubernetes manifests and Helm charts (the user writes their own);
  - a slim image without Chromium;
  - multiple replicas;
  - backups.

## Capabilities

### New Capabilities
- `deployment`: how Nooted runs as a container in production:
  - shutting down on termination signals;
  - the health endpoint;
  - the published image and its runtime filesystem needs.

### Modified Capabilities
(none)

## Impact

- `apps/server/src/index.ts`: signal handling and orderly shutdown. The database handle needs to be closable.
- `Dockerfile`: `HEALTHCHECK`, labels, and build args for the revision and version.
- New: `.github/workflows/image.yml`, `docs/deploy.md`, and a link to the guide in `README.md`.
- **Images:** they go to GitHub Container Registry, which needs a GitHub remote with `packages: write` permission for the workflow. The repo has no remote yet.

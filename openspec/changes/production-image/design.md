# Design

## Context

Current state:
- The `Dockerfile` is multi-stage. It runs `node src/index.ts` as `node`, directly as PID 1, with no init, and has a `/data` volume and Chromium in `/ms-playwright`.
- `/api/health` already exists (`apps/server/src/app.ts`).
- `index.ts` handles no signals. Node as PID 1 without a handler doesn't stop on SIGTERM, so Kubernetes waits out the grace period and then sends SIGKILL.
- The capture renderer launches Chromium through playwright-core, which by default installs its own signal handlers once a browser is running:
  - **SIGTERM, SIGHUP:** it closes browsers but doesn't exit.
  - **SIGINT:** it closes browsers and then calls `process.exit(130)`, which would cut off any draining.
- The database is `node:sqlite` in WAL mode, and the adapter exposes `close()`.
- The repo has no git remote and no CI.

## Goals / Non-Goals

**Goals:**
- **Shutdown:** stops in an orderly way well inside Kubernetes' default 30-second grace period.
- **The image:** runs unchanged under a restrictive pod security context: non-root, read-only root filesystem, all capabilities dropped.
- **Publishing:** every commit on `main` and every version tag produces an image in GHCR, without manual steps.

**Non-Goals:**
- A readiness gate that reports not-ready during shutdown. With one replica there is nowhere else to route traffic, so it adds nothing.
- Database health in `/api/health`. A broken database makes requests fail; a restart loop would not fix it.
- Multi-arch images. linux/amd64 only, unless the cluster needs arm64 (see Open Questions).

## Decisions

**Shutdown sequence in `index.ts`:**
1. On the first SIGTERM or SIGINT, call `server.close()`. `serve()` from `@hono/node-server` returns the `http.Server`. This stops accepting connections and waits for open requests.
2. Then call `server.closeIdleConnections()`, so idle keep-alive sockets don't hold the close open.
3. Start a 10-second timer, unref'd. When it fires: `server.closeAllConnections()`, then exit with code 1.
4. Once the server has closed:
   - `await renderer.close()`, so the browser exits;
   - `await db.destroy()`, which closes SQLite (the last connection checkpoints the WAL);
   - `process.exit(0)`.
5. A second signal during shutdown exits immediately with code 1.

The hourly OAuth cleanup interval is already unref'd. The deadline is 10 seconds rather than closer to 30 so that the browser and database closing still fit inside the grace period. The shutdown logic goes in a small `shutdown.ts`: it takes the server, the closers and an exit function, so it can be tested with `node:test` without real signals.

*Alternative:* `tini` or `dumb-init` as PID 1. Rejected, because Node handles signals fine once a handler is registered, and the drain logic is needed anyway.

**Turning Playwright's signal handlers off.** Launch with `handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false` in `render/browser.ts`, so the server's shutdown owns the order. The `process.on('exit')` hook that closes the renderer stays as a backstop. If the Node process dies, Chromium is sent SIGKILL when the container stops anyway, since it's in the same PID namespace.

**Read-only root filesystem.** Chromium writes its profile and crash data under `os.tmpdir()` (`/tmp`). Fontconfig writes its cache under `$HOME/.cache`, and `/home/node` is read-only. The Dockerfile sets `XDG_CACHE_HOME=/tmp/.cache`, so the font cache also lands in `/tmp`; it is rebuilt at first render (sub-second with the fonts installed). Node and the server write nothing outside `/data` and `/tmp`. To verify: `docker run --read-only --tmpfs /tmp -v …:/data`, then request a capture image through the API.

**`HEALTHCHECK`.**

```
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
```

- It uses Node's built-in `fetch`, because the slim base image has no curl or wget.
- Settings: interval 30s, timeout 5s, start period 10s.
- Kubernetes ignores `HEALTHCHECK`. The guide therefore documents httpGet probes on `/api/health`; the `HEALTHCHECK` serves `docker run` and compose.

**OCI labels.** The build args `REVISION`, `VERSION` and `SOURCE` become `org.opencontainers.image.{revision,version,source}` labels in the runtime stage. In CI, `docker/metadata-action` generates both the tags and the labels. The `source` label links the GHCR package to the repository.

**CI workflow `.github/workflows/image.yml`.** Two jobs.

1. **`check`:**
   - setup: Node from `.node-version`, pnpm via corepack;
   - `pnpm install --frozen-lockfile`;
   - `pnpm typecheck`;
   - `pnpm -r test`.
2. **`image`** (needs `check`, `permissions: packages: write, contents: read`):
   - setup: `docker/setup-buildx-action`, `docker/login-action` to ghcr.io with `GITHUB_TOKEN`;
   - tags and labels: `docker/metadata-action` with these tags:
     - `type=sha`
     - `type=ref,event=branch`
     - `type=semver,pattern={{version}}`
     - `type=semver,pattern={{major}}.{{minor}}`
     - `latest` on semver tags only;
   - build: `docker/build-push-action` with the GitHub Actions cache (`cache-from/to: type=gha`).

Triggers: pushes to `main`, tags `v*`, and `pull_request`. On pull requests the image is built but not pushed, which catches Dockerfile breakage. The image name is `ghcr.io/${{ github.repository_owner }}/nooted`, lowercased by the metadata action.

The e2e suite is not in CI. It needs Dex and Playwright browsers; it can be added later.

**The guide in `docs/deploy.md`**, linked from the README. It is prose plus tables, with no manifests:
- **Image and tags.**
- **Port:** 3000.
- **Environment variables.** Required: `PUBLIC_URL`, `OIDC_*`. The secret: `OIDC_CLIENT_SECRET`.
- **Volume:**
  - `/data` on a ReadWriteOnce PVC (no NFS, because of SQLite locking);
  - `replicas: 1` with `strategy: Recreate`, since two pods on one SQLite file must not overlap.
- **Probes:** httpGet `/api/health` for liveness and readiness.
- **Security context:**
  - `runAsNonRoot`, `readOnlyRootFilesystem`, `/tmp` as an `emptyDir`;
  - `fsGroup: 1000`, so the volume is writable by the `node` user.
- **Ingress:**
  - TLS terminated at the ingress;
  - `PUBLIC_URL` is the https origin, which also makes cookies `Secure`;
  - `TRUST_PROXY_HOPS=1` (or more) for real client IPs in rate limiting;
  - the request body size limit, for report uploads.
- **OIDC:** register the redirect URI `${PUBLIC_URL}/auth/callback`.
- **Resources:**
  - requests: about 200 MB of memory;
  - limit: at least 1 GB with capture images on (Chromium about 150 MB per render, 2 renders at once);
  - Chromium needs a `/dev/shm` of 64 MB or more, so use an `emptyDir` with `medium: Memory`, or rely on headless-shell's defaults;
  - `CAPTURE_IMAGES=off` to skip Chromium.
- **`terminationGracePeriodSeconds`:** the default 30 is enough.
- **Backups:** copy `/data` (taking care with SQLite's WAL).

Before the guide states the shared-memory note and the upload size limit, check them against the code: whether headless-shell uses `/dev/shm`, and the body limit for report ingestion.

## Risks / Trade-offs

- **[The repo has no GitHub remote yet]:** the workflow can't be verified end to end until it's pushed. → Lint it locally (`actionlint` if available) and build the image locally with the same build args. The first push to GitHub validates the rest. Note that GHCR packages start private: either make the package public or give the cluster an `imagePullSecret`. The guide says so.
- **[Image size, 969 MB]:** slow first pulls. → The user accepted this. Layer order keeps Chromium in its own layer, so a code-only change doesn't re-pull it.
- **[A WAL checkpoint failing at close, e.g. a full disk]:** → Log it and exit 1. SQLite recovers from the WAL at the next open.
- **[Chromium under dropped capabilities]:** Playwright launches Chromium without its sandbox by default (`chromiumSandbox: false`), so it should need no extra privileges. The page isolation comes from the network allowlist instead. → Check rendering under `--cap-drop=ALL --security-opt no-new-privileges` in the read-only test, and document anything it needs.

## Open Questions

- **Cluster architecture:** if the cluster runs arm64 nodes, add `platforms: linux/amd64,linux/arm64` to the build. Chromium's headless shell supports both, and the change is one line.

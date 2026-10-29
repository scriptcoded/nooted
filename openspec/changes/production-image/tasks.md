# Tasks

## 1. Graceful shutdown

- [x] 1.1 Add `apps/server/src/shutdown.ts`. It takes the HTTP server, async closers (renderer, database), a deadline (10 s) and an exit function, and returns a signal handler that follows design.md: close the server and idle connections, then the closers, then exit 0. On the deadline it closes all connections and exits 1; a second signal exits 1 at once. Verify with `node:test` cases for an idle stop, an in-flight request that finishes, a request that outlasts the deadline, a second signal, and a closer that throws (exits 1).
- [x] 1.2 Wire it into `apps/server/src/index.ts` for SIGTERM and SIGINT, closing the renderer and then `db.destroy()`. Log one line at the start of shutdown and one at the end. Verify: `pnpm --filter @nooted/server typecheck`. Then start the server on a spare port (not the user's dev server), send it SIGTERM, and check that it exits 0 within a second.
- [x] 1.3 Launch Chromium with `handleSIGINT/handleSIGTERM/handleSIGHUP: false` in `apps/server/src/render/browser.ts`. Verify: the existing render tests pass, and a test asserts the launch options include the three flags.

## 2. Image

- [x] 2.1 Update the `Dockerfile`:
  - build args `REVISION`, `VERSION`, `SOURCE` mapped to OCI labels;
  - `XDG_CACHE_HOME=/tmp/.cache`;
  - the `HEALTHCHECK` from design.md.

  Verify: `docker build --build-arg REVISION=$(git rev-parse HEAD) --build-arg VERSION=dev -t nooted:prod-check .` succeeds, and `docker inspect` shows the labels and the health check.
- [x] 2.2 Run the image locally on a spare port with `--read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges` and a `/data` volume, using the compose setup's Dex.
  - Check that the container becomes `healthy`.
  - Check that the console loads.
  - Check that a report can be stored and its capture image renders (e.g. via the e2e playground pointed at it, or by posting a fixture report and calling the image endpoint).
  - Send `docker stop` and check that it exits within a few seconds with code 0.

  Fix whatever the read-only filesystem breaks.
- [x] 2.3 Update the "Running the full stack in Docker" section of `README.md` if anything there changes (e.g. the health status). Verify: the documented compose command still works.

## 3. Publishing

- [x] 3.1 Add `.github/workflows/image.yml` as in design.md:
  - a `check` job: install, typecheck, `pnpm -r test`;
  - an `image` job that needs it and runs buildx with the gha cache;
  - tags and labels from `docker/metadata-action`;
  - pushes only for `main` and `v*` tags; pull requests build but don't push.

  Verify: `actionlint` passes if it's available (otherwise check the YAML parses), and the `check` steps run cleanly locally in the same order.

## 4. Deployment guide

- [x] 4.1 Check the facts the guide needs against the code:
  - the report upload body size limit;
  - whether the headless shell needs a larger `/dev/shm`, by rendering in the container from 2.2 with Docker's default 64 MB shm;
  - the uid/gid of `node` in the image (`docker run --rm --entrypoint id nooted:prod-check`).

  Record the results in the guide.
- [x] 4.2 Write `docs/deploy.md` covering every item listed under "The guide" in design.md, and link it from `README.md`. Verify: every environment variable it names matches `apps/server/src/config.ts`, and the probe path, port, volume path and redirect URI match the code.

## 5. Integration check

- [x] 5.1 Run `pnpm typecheck`, `pnpm -r test` and the e2e suite (`cd packages/sdk && npx playwright test`). Confirm that nothing regressed.

## Workflow follow-up

- Add a GitHub remote and push. Then check that the workflow publishes `ghcr.io/<owner>/nooted`, and make the package public or set up an `imagePullSecret`.
- Archive the change after the user has deployed it to their cluster.

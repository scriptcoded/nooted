# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial). E2E needs ports 4820/4821 free and Dex on :4856.

## 1. Recording timeline [sonnet]

- [x] 1.1 Add `apps/server/src/capture/timeline.ts` per design.md decision 1: the node map (full snapshot, then mutation adds, removes, attributes and texts), `describeNode` (interactive ancestor, role, name, selector, truncation), and `buildTimeline(capture)`.
  - Entry kinds: navigation, click, tap, typing burst, checked/unchecked, resize, error.
  - At most 30 entries, with "(and N more)" past that.

  Unit tests use hand-built rrweb events and cover:
  - each entry kind;
  - a typing burst collapsing into one entry, with no values in the output;
  - a click on a span inside a button naming the button;
  - an element added by a mutation and then clicked;
  - the 30-entry cap.

  Verify with `pnpm --filter @nooted/server test`.
- [x] 1.2 Add the timeline to recordings in `mcp/digest.ts`, under the recording heading, as `m:ss  <entry>` lines with element text quoted the way marks are. Extend the golden digest tests: a recording with a click, typing and a navigation, and a test that a typed value never appears. Verify with the server tests.

## 2. Renderer [sonnet]

- [x] 2.1 Config and browser:
  - Add `CAPTURE_IMAGES` (`auto`|`off`, default `auto`) and `CHROMIUM_PATH` to `config.ts` with tests.
  - Add `playwright-core` pinned to exactly 1.64.1 to `apps/server`.
  - Implement `render/browser.ts` per design.md decision 2: lazy launch, executable resolution, 5-minute idle close, 10-minute back-off after a failed launch with a single log line, and a semaphore of 2.

  Tests cover `off` never launching and a bad `CHROMIUM_PATH` reporting unavailable. They also check that a launch works when the e2e headless shell is installed; skip that test with a message when it isn't.
- [x] 2.2 Add `nodeRect(id)` to the replay handle (`packages/sdk/src/replay/types.ts` and `main.ts`), using the rrweb mirror. Verify with the SDK typecheck and build.
- [x] 2.3 Implement `render/page.ts` and `render/network.ts` per design.md decisions 3 and 4:
  - the context options and the shell page with `replay.js` from `SDK_DIST_DIR`;
  - seek and settle, outlines, and a JPEG screenshot within 1568 px;
  - the origin allowlist through `route.fetch({ maxRedirects: 0 })`, with all else, WebSockets and service workers blocked;
  - the 20-second timeout.

  Integration tests, skipped without Chromium, build reports from fixtures using a local HTTP server as the allowed origin. They cover:
  - a still has the capture's dimensions, or is scaled within 1568 px;
  - an outline is present at the mark's position (sample pixel colour);
  - masked input text never appears;
  - an image from the allowed origin loads;
  - a request to a second local server, not allowed, never arrives;
  - a redirect from the allowed origin to the second server isn't followed;
  - a page that never settles times out cleanly.
- [x] 2.4 Implement storyboard selection and the render cache per design.md decisions 3 and 5:
  - moments from the timeline, the 400 ms offset, dedup by clean-screenshot hash, the cap of 6 by priority, and captions;
  - blob keys under `projects/<pid>/renders/<itemId>/v<RENDER_VERSION>/`, the in-flight `Map`, and failures not stored.

  Unit tests cover selection on synthetic moment lists, without a browser. Integration tests cover a storyboard for a click-then-navigate recording, the second call served from the cache without a render, and deleting the project removing the renders.

## 3. MCP tools [sonnet]

- [x] 3.1 Implement design.md decision 6:
  - `get_feedback` returns images for the first 4 captures, with `[n]` labels, the overflow hint, the 25-second wait, and the one-line "not available", "could not be drawn" and "still being drawn" notes;
  - the new `get_capture_frames(itemId, capture)` tool, with the same scope rules and not-found for unknown capture numbers;
  - updated tool descriptions.

  Extend `mcp.test.ts` with a fake renderer injected through `AppDeps`, covering:
  - images present, with labels and order;
  - the images-off text;
  - more than 4 captures;
  - a render failure;
  - the frames tool for a recording and for a point capture;
  - an unknown capture;
  - another project;
  - no rrweb data in any response.

  Verify with the server tests and `pnpm typecheck`.

## 4. Packaging, e2e and docs [sonnet]

- [x] 4.1 Dockerfile: install the Chromium headless shell with its system dependencies in the runtime stage (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, readable by `node`). README:
  - the config rows for `CAPTURE_IMAGES` and `CHROMIUM_PATH`;
  - what agents see (timeline, images, `get_capture_frames`);
  - the image size and memory note;
  - how to enable images in dev.

  Verify that `docker build .` succeeds and that a container renders an image: run the compose app profile and call `get_capture_frames` once through the e2e MCP helper or a script.
- [x] 4.2 E2E in the existing harness (extend `mcp.spec.ts`):
  - send a real report with a point capture and a recording through the SDK;
  - `get_feedback` returns the digest with a timeline and two images: decode the JPEGs, check their dimensions, and save them to `test-results`;
  - `get_capture_frames` on the recording returns captioned stills in time order.

  Look at the saved images, and fix what's off before ticking. Run the full suite.
- [x] 4.3 Hand check (the user): in Claude Code against `pnpm dev` (http://localhost:4800/mcp), ask it to look at a change request with a point capture and one with a recording. Confirm it describes what the images show.
- [x] 4.4 Run `pnpm typecheck`, `pnpm -r test` and the full e2e suite.

## Workflow follow-up

- Archive the change once it's reviewed (`/opsx:archive`).

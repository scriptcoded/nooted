# Design

## Context

- **Stored reports:** reports are gzipped `ReportPayload` v2 blobs (`projects/<pid>/reports/<id>.json.gz`). Each capture holds rrweb 2.2.0 events: at least one full snapshot, plus incremental events for recordings, recorded with `maskAllInputs` and `inlineStylesheet: true`.
  - Images and fonts are still referenced by URL.
  - `ReportStore.loadReport` already caches parsed reports.
- **Element descriptions:** marks (name, role, text, selector) are computed in the browser by `packages/sdk/src/runtime/capture/describe.ts` against the live DOM. Nothing on the server understands the event stream except `mcp/digest.ts`, which reads Meta hrefs and Nooted error events.
- **Replay bundle:** the server already serves the replay bundle (`SDK_DIST_DIR/replay.js`, an IIFE exposing `createReplayer` on `window.nooted.p`). The console draws captures with the same bundle.
- **Isolation:** rrweb's replayer renders into an iframe sandboxed with `allow-same-origin` and no scripts.
- **E2E:** the suite already has Playwright 1.64.1 and its Chromium headless shell installed.
- **Clients:** MCP tool results may mix `text` and `image` (base64 + mimeType) content blocks, and Claude Code shows images to the model. Images cost context (roughly width × height / 750 tokens), and Claude downscales anything over 1568 px on the long side.

## Goals / Non-Goals

**Goals:**
- One code path draws images, for both MCP tools and any later console use. It runs in the server process, has no external service, and can be turned off.
- The timeline needs no browser, so text-only servers get it too.
- Rendering a hostile recording can't reach the server's network, beyond the origins a project admin already trusts.

**Non-Goals:**
- Showing rendered images in the console, which already replays live.
- Pre-rendering when a report arrives.
- Video or GIF output.
- Pixel-perfect fonts or images from origins other than the project's.
- Rendering legacy reports, which have no captures.

## Decisions

### 1. Timeline: a serialized-node map, not a DOM

`apps/server/src/capture/timeline.ts` (pure, no I/O):
- **Node map:** walk the events, keeping a map `id → {tag, attributes, parentId, childIds, text}`.
  - It is seeded from each full snapshot (type 2), which replaces the map.
  - It is updated from mutations (type 3, source 0): adds, removes, attributes and texts.
- **Entries:** produced while walking.

| Event | Timeline entry |
|---|---|
| Meta (type 4) | navigation, when the href changes |
| MouseInteraction (source 2), `Click`/`DblClick` | click |
| MouseInteraction, `TouchEnd` with no click on the same id within 500 ms | tap |
| Input (source 5) | typing; a burst is consecutive inputs on one id with gaps under 1 s, and the entry's time is its last input |
| Input with `isChecked` on a checkbox or radio | "checked" or "unchecked" |
| ViewportResize (source 4) | resize |
| Custom `nooted:error` | error |

- **Scrolls:** dropped; stills show their result.
- **Size:** at most 30 entries. Past that, the last line reads "(and N more)".

**Element description:** `describeNode(map, id)` returns `{tag, role?, name?, text, selector}`, with fields truncated like marks.
- **Target:** climbs from the event target to the nearest interactive ancestor: `a`, `button`, `input`, `select`, `textarea`, `label`, `[role]` or `[onclick]`.
- **Role:** explicit, or implicit for common tags.
- **Name:** `aria-label`, then the associated `<label>` text for inputs, then `alt`, `title` or `placeholder`, then text content.
- **Selector:** `#id`, a `data-testid` attribute, or a path of at most 3 levels of `tag.class:nth-of-type`. Uniqueness is checked against the map.

**Why not reuse `describe.ts`?** It needs a live `Element` with `querySelectorAll`. Rebuilding a DOM on the server (linkedom, happy-dom) for each mutation step costs a dependency and a lot of work, all to get what is only a hint for the agent. The map version is about 200 lines and fully unit-testable.

**Alternative rejected:** computing the timeline in the renderer from rrweb's mirror. That would tie it to Chromium.

### 2. Renderer: playwright-core with one shared browser

`apps/server/src/render/`:
- **`browser.ts`:**
  - `getBrowser()` lazily launches `chromium.launch({ executablePath })` from `playwright-core`.
  - The executable is `CHROMIUM_PATH`, otherwise playwright-core's own resolved headless shell if it exists on disk.
  - The browser closes after 5 minutes idle and relaunches on the next request.
  - A failed launch marks rendering unavailable for 10 minutes, then it tries again; the log says why once.
  - `CAPTURE_IMAGES=off` skips all of this.
- **Concurrency:** a semaphore allows at most 2 renders at a time, and each render gets a fresh `BrowserContext` that is closed afterwards.
- **Version:** `playwright-core` is pinned to 1.64.1, the e2e version, so dev machines reuse the browser the e2e suite already installed.

**Alternatives rejected:**
- **A sidecar render service:** more to deploy, for a single-replica app.
- **Puppeteer:** a second browser-automation stack next to Playwright.
- **Screenshots in the reporter's browser:** rejected in the proposal; DOM-to-image is unreliable and grows every report.

### 3. Render page: the existing replay bundle

`render/page.ts` builds the page for each render:
1. **Context:** viewport = the capture's viewport, `deviceScaleFactor = min(1, 1568 / max(w, h))`, `serviceWorkers: 'block'`, `javaScriptEnabled: true`. Scripts are enabled only for the shell page; rrweb's sandboxed iframe still runs none.
2. **Shell:** `page.setContent` with a blank shell, then `addScriptTag({ content: replay.js })` and `createReplayer(root, events)`. The wrapper is placed at 0,0, scale 1.
3. **Seek:** `pause(t)`, then wait for the iframe document's images and fonts to settle (`document.fonts.ready` and image `complete`, at most 3 s), then two animation frames.
4. **Outlines:** drawn as absolutely positioned divs over the iframe in the shell: a 3 px solid outline with a 2 px white halo, so it shows on any background.
   - **Point captures:** rects come from `mark.rect − capture.scroll`, the same maths as the console.
   - **Clicked elements:** the replay handle gains `nodeRect(id): DOMRect | null`, from the rrweb mirror's node, so the outline follows the frame actually shown.
5. **Screenshot:** `page.screenshot({ type: 'jpeg', quality: 80 })` of the viewport.

**Storyboard dedup:** for each moment the page first takes a clean screenshot (no outlines) and hashes it. A frame whose clean hash equals the previous kept frame's is dropped; deterministic rendering makes identical DOM states identical bytes. Then the outlined screenshot is taken. This costs two screenshots per candidate, with at most about 12 candidates before choosing.

**Moments and selection:** the moments are those listed in the spec. Each frame is taken 400 ms after its event, or just before the next event if that comes sooner, so that click effects are visible. Selection then works in three steps:
1. collect the moments;
2. drop identical frames;
3. if more than 6 remain, keep the first and last, then fill by priority: navigation > click > error > typing, and by time within each priority.

**Why reuse `replay.js`?** The console and the images then draw identically, and nothing is bundled twice.

### 4. Network allowlist

`context.route('**/*', handler)`:
- **`data:` and `blob:`:** continue.
- **http(s) to an allowed origin:** exact scheme, host and port from the project's `project_origins`. The handler fetches with `route.fetch({ maxRedirects: 0 })` and fulfils with the response.
- **Everything else:** `route.abort('blockedbyclient')`, including other origins and a 3xx from an allowed origin. WebSockets are blocked with `context.routeWebSocket` closing them.

Allowed origins were configured by project admins, so they are as trusted as the project. Reporters can't add any.

**Alternatives rejected:**
- **Blocking everything:** stills of real sites would lose all images, which hurts the core use case.
- **Allowing all public hosts:** this needs DNS-rebinding-safe IP checks inside Chromium's network stack, which isn't possible from Playwright routes.

### 5. Cache

- **Location:** renders are stored in the existing blob store, so project deletion's `deletePrefix('projects/<id>/')` removes them too.
  - Stills: `projects/<pid>/renders/<itemId>/v<RENDER_VERSION>/<n>-still.jpg`.
  - Storyboards: `…/<n>-frames.json`, a manifest of `{t, caption}`, plus `<n>-frame-<i>.jpg`.
- **Versioning:** `RENDER_VERSION` is a constant bumped when drawing changes. Old versions are ignored and left until the project is deleted, which is acceptable at this scale.
- **Concurrent requests:** an in-process `Map<key, Promise>` collapses concurrent renders of the same key.
- **Failures:** errors and timeouts are not stored.

### 6. Tools

- **`get_feedback`:**
  - **Images:** after the text it adds, for the first 4 captures in order, a text block `[n] <one-line caption>` followed by the image.
  - **More captures:** the digest names the captures it left out, for example "Images for [5]–[7]: call get_capture_frames."
  - **Waiting:** it waits for renders up to 25 s in total. Past that, the missing images are reported as "still being drawn, try again shortly", and the renders continue so they are cached for the next call.
- **`get_capture_frames(itemId, capture)`:**
  - **Recordings:** the timeline, then pairs of caption and image.
  - **Point captures:** its description and its still.
  - **Errors:** the same not-found rules as `get_feedback`.
- **Descriptions:** the tool descriptions are updated so agents know about images and when to use the frames tool.

### 7. Configuration and packaging

**Config:**
- `CAPTURE_IMAGES`: `auto` (the default) or `off`.
- `CHROMIUM_PATH`: optional.

Both go in the README config table.

**Dockerfile:**
- In the runtime stage, `pnpm exec playwright-core install --with-deps chromium-headless-shell` runs as root into `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`). The `--with-deps` flag installs the system libraries and fonts.
- `EXPOSE`/`PORT` stay as they are.

**Dev:** nothing to do if the e2e browser is installed. Otherwise the server logs that images are off and how to enable them (`pnpm --filter @nooted/server exec playwright-core install chromium-headless-shell`).

## Risks / Trade-offs

- **Image size:** Chromium makes the image about 600 MB larger (measured: 318 MB → 969 MB), and a render can use about 150 MB of RAM. → `CAPTURE_IMAGES=off`, the 2-render cap, and idle shutdown.
- **Missing images and fonts:** images from origins other than the project's are missing, and web fonts may fall back. → This is acceptable for an agent; captions and selectors carry the precise information.
- **Chromium vulnerabilities through hostile snapshots:** no scripts run in the replayed page, the network is restricted, and the browser runs sandboxed as the `node` user. → Keep `playwright-core` updated with the e2e version.
- **Heuristic element names:** the map-based description can differ from the SDK's live one. → Timeline entries are hints; marks remain the authoritative element descriptions.
- **Context cost:** 4 images is about 5k tokens at 1280×720. → The cap of 4, the 1568 px limit, and storyboards only on request.
- **First calls are slow:** the browser launches and each capture renders in about 1–3 s. → Images are cached; concurrent requests are collapsed; the 25 s wait.

## Migration Plan

- No database migration.
- Deploys as a new image: existing reports render on first request.
- Rollback: run the previous image. The stored renders are ignored.

## Open Questions

- Should the console later show the storyboard for recordings? It can reuse the cached frames through a session-authenticated route, without changing this design.

# Design

## Context

The backend-foundation change established the contract this SDK talks to: the `/sdk/sign-in` popup posting `nooted:token` or `nooted:sign-in-error` to the opener, `POST /api/sdk/reports` (gzipped `ReportPayload` from `@nooted/shared`, bearer token, idempotent on `clientReportId`), and `DELETE /api/sdk/token`. Everything server-side is built and specified in `openspec/specs/`. See proposal.md for scope.

Constraints: the SDK runs on sites we own but don't control at runtime (any framework, any CSS, possibly broken). It must cost nothing when disabled, and must never throw into the app. The repo's server code runs through Node type stripping. The SDK is browser code built by Vite, but its pure modules should still run under `node --test`.

## Goals / Non-Goals

**Goals:**
- One SDK bundle served by the Nooted server, so fixing the SDK never means rebuilding apps.
- Pure logic (buffer, shake detection, payload, response classification, backoff, snippet) unit-tested without a browser. Every spec scenario covered by a browser end-to-end test where a browser is needed.
- Keep the recording path open for the deferred heartbeat worker.

**Non-Goals:**
- Publishing `@nooted/sdk` to npm (workspace-only for now; the build emits `dist/` + `.d.ts` so publishing later is a config change).
- Framework-specific wrappers (React hooks etc.).

## Decisions

### Package layout
```
packages/sdk/
  src/
    loader/loader.ts         # loader source: self-contained, no imports
    loader/code.generated.ts # minified loader as a string (built, gitignored)
    index.ts                 # npm entry: nooted API, loaderSnippet()
    vite.ts                  # npm entry: Vite plugin
    runtime/                 # becomes dist/nooted.js
      main.ts                # boot: drain queue, start recorder, mount UI, triggers
      safe.ts                # guard() wrapper + [nooted] logger
      buffer.ts              # the single buffer module
      recorder.ts            # rrweb config, masking
      errors.ts              # error/rejection → timeline
      triggers/{shake,keyboard,motion-permission}.ts
      auth/token.ts          # sessionStorage token per project
      upload/{payload,gzip,client,classify,queue,retry}.ts
      ui/                    # Preact components + styles.css (inlined)
  playground/                # dev page using the Vite plugin (replaces dev/sdk-test)
  e2e/                       # Playwright tests
```
Relative imports use `.ts` extensions and the code sticks to erasable syntax, so pure modules run under `node --test` just as the server's do. JSX lives only in `ui/`, which is covered by end-to-end tests.

### Loader ↔ runtime contract via one global
The loader always defines `window.nooted` as a stub `{ v: 1, k: projectKey, u: nootedUrl, r: release, q: [], e: [], l() }`. Defining it adds no listeners and makes no requests.
- The stub's API methods (`init`, `open`, `signOut`, `disable`) push their calls into `q`.
- `l()` injects `<script async src="<u>/sdk/v1/nooted.js">`.
- Only when enabled does the loader call `l()` and listen for `error` and `unhandledrejection`, pushing those into `e`.
- The runtime replaces the stub's methods with real ones and then drains `q` and `e`.
- The npm `nooted` object forwards each call to `window.nooted[method]`. If there's no global (no loader on the page), it logs a single `[nooted]` warning.
- `init()` on a disabled device sets the flag and calls `l()`.
The alternative, the npm package importing the runtime directly, was rejected because the runtime is served by Nooted (user decision).

### Loader build and snippet
`build:loader` minifies `loader.ts` into `code.generated.ts` with esbuild, which ships with Vite.
- `loaderSnippet()` wraps the code as `<script>(function(c){…})(CONFIG)</script>`.
- CONFIG is JSON with `<`, `>`, `&`, U+2028 and U+2029 escaped, so a project key or URL can't break out of the script.
- `loaderCspHash()` returns `'sha256-<base64>'` of the exact text between the script tags, using the same CONFIG serialization, so the two can't drift.
- A unit test asserts the gzipped size is ≤ 1 KB.

### Content Security Policy
The loader is the only inline code Nooted adds. How each delivery method gets past a strict CSP:
- **Vite plugin (default):** in `generateBundle`, the plugin emits `nooted-loader-[hash].js`, containing the loader plus its config. It injects `<script src="/…/nooted-loader-[hash].js"></script>` (classic, not async) as the first `<head>` child, using Vite's `base`. `'self'` covers it, and it still runs before Vite's module scripts, which are deferred. In dev (`vite serve`) it serves the same file from middleware. `inline: true` switches to the inline snippet.
- **Copy-paste snippet:** inline. The console shows `loaderCspHash()` next to it.
- **Server-rendered apps with nonces:** the loader reads `document.currentScript?.nonce` and sets it on the injected `nooted.js` script. Sites using `'strict-dynamic'` work without it.
- **Load failures:** the injected script's `onerror` logs one `[nooted]` warning naming the URL and the likely causes (CSP `script-src`, Nooted server unreachable). There's no detection of `securitypolicyviolation` events, which would cost bytes for little gain.
- **Runtime:** it uses `fetch` to the Nooted origin, which needs `connect-src`, and constructed stylesheets, which CSP doesn't restrict. The `<style>` fallback for old browsers needs `style-src 'unsafe-inline'`, and that's documented.
- **COOP:** `Cross-Origin-Opener-Policy: same-origin` on the host page cuts the popup's `window.opener`. The sign-in page's no-opener message explains this (a server text change in `sdk/sign-in.ts`).
- Root `dev`, `build` and `typecheck` run `build:loader` first, because `apps/web` imports `loaderSnippet` for the settings page.

### Runtime bundle
Vite library mode, IIFE format, everything bundled into `dist/nooted.js` plus a source map. The size budget is ≤ 100 KB gzipped, enforced by a test on the build output.
- **UI:** Preact (about 4 KB) rather than React or MUI, which are too heavy for code injected into other people's pages. Styles are a CSS string applied via `adoptedStyleSheets`, falling back to a `<style>` in the shadow root.
- **rrweb:** rrweb 2.x record-only (`@rrweb/record`), pinned to an exact version. We need v2 because its `maskInputFn(text, element)` receives the element, which the `data-nooted="show"` rule depends on. The first recorder task verifies this behavior in a browser before anything builds on it.

### Recorder configuration
```
record({
  emit: buffer.push,
  checkoutEveryNms: 30_000,
  maskAllInputs: true,
  maskInputFn: (text, el) => isPassword(el) || !el.closest('[data-nooted="show"]') ? '*'.repeat(text.length) : text,
  blockSelector: '[data-nooted="block"], #nooted-host',
  maskTextSelector: '[data-nooted="mask"]',
  inlineStylesheet: true, recordCanvas: false, collectFonts: false,
  sampling: { mousemove: 50, scroll: 150, input: 'last' },
})
```
Nooted's host element is blocked, so it shows up only as a placeholder box, and the shadow content is never serialized. Recording starts as soon as `document.body` exists, either immediately or on `DOMContentLoaded`.

### Buffer
`buffer.ts` keeps `segments: Event[][]`. A checkout starts a new segment and drops all but the last two. rrweb flags both the checkout's Meta and its FullSnapshot with `isCheckout`, so the Meta starts the segment and the FullSnapshot joins it. `freeze()` returns a shallow copy of the concatenated segments; rrweb never mutates an event after emitting it. This module is the only subscriber to rrweb. That's where the deferred heartbeat worker will tap in.

### Errors
`errors.ts` turns `ErrorEvent` and `PromiseRejectionEvent` into `record.addCustomEvent('nooted:error', { message, stack?, source?, line?, column?, time })`. Errors the loader queued before the recorder started are added once recording begins, with their original `time` in the payload.

### Triggers
- **Shake:** a pure detector function `(sample, state) → { fired, state }`, fed from `devicemotion` `accelerationIncludingGravity`. A peak is a rising edge where the acceleration vector's distance from a slow baseline (a per-axis moving average with a ~1 s time constant, which tracks gravity) exceeds the threshold (default 15 m/s², overridable through the undocumented `init({ shakeThreshold })` for tuning). It re-arms below half the threshold. A per-sample delta can't reach the threshold at 60 Hz, which is why it compares against a baseline. Peaks must be at least 100 ms apart, 3 peaks within 1 s fire, then a 2 s cooldown. It's unit-tested with synthetic sample streams (shakes, walking, a phone set down).
- **Keyboard:** `keydown` with `code === 'Period'` plus Shift plus Ctrl or Meta. Using `code` makes it independent of keyboard layout.
- **iOS permission:** requested inside the floating button's tap handler, which is required as a user gesture. The result is cached in `sessionStorage`. The `devicemotion` listener is attached at boot regardless (unless denied this session), because desktop Chromium also exposes `requestPermission` without needing a prompt; on iOS no events arrive until permission is granted.
- **Freezing:** all triggers go through a single `trigger()`. If no report window is open, it freezes the buffer and records `capturedAt` and `location.href`, then opens the window.

### Report window and sign-in
- **Mounting:** a host `<div id="nooted-host">` is appended to `<body>`, with a closed shadow root. A `MutationObserver` on `<body>` (childList only) re-appends the host if it's removed.
- **Sign-in popup:** the button handler calls `window.open(signInUrl, 'nooted-sign-in', 'popup,width=420,height=640')` synchronously. A `null` result means the popup was blocked.
- **Messages:** the `message` listener accepts only `event.origin === nootedOrigin && event.source === popup`.
- **Token storage:** tokens are stored as `sessionStorage['nooted:token:<projectKey>'] = { token, expiresAt, user }`. They're valid while `expiresAt > now + 60 s`, a margin so an upload doesn't start with a token about to expire.
- **Sign-out:** `signOut()` sends `DELETE /api/sdk/token`, best effort, and always clears local state.

### Upload pipeline
- **Payload:** `payload.ts` builds a `ReportPayload` (types from `@nooted/shared`; no zod at runtime, to save bytes). The shared schema validates the builder's output in unit tests.
- **Compression:** `gzip.ts` uses `CompressionStream('gzip')` where available, falling back to `fflate`'s `gzipSync` (about 3 KB) for older Safari.
- **Response handling:** `classify.ts` maps a response or network error to `delivered | unauthorized | permanent | temporary`. This is the spec table as a pure function.
- **Queue:** `queue.ts` is a minimal IndexedDB wrapper (database `nooted`, store `queue`, keyed by `clientReportId`, no dependency), with an in-memory fallback when opening fails.
- **Retries:** `retry.ts` holds the backoff schedule (30 s doubling to 30 min) and a single in-flight flag per page. Several tabs may retry the same report; the server's idempotency makes that harmless, so there's no cross-tab lock.

### Serving the bundle
The server gets an `SDK_DIST_DIR` config, defaulting to `packages/sdk/dist` resolved from the server package in every environment.
- **Bundle routes:** `GET /sdk/v1/nooted.js` and `/sdk/v1/nooted.js.map` read the file and cache it in memory keyed by mtime.
- **Headers:** the ETag is a SHA-256 of the content; `Cache-Control: no-cache`; 304 on a matching `If-None-Match`; and `Cross-Origin-Resource-Policy: cross-origin` so host pages with COEP can load it.
- **Missing build:** if the file doesn't exist, the route returns 404 and logs a hint to run the SDK build.
- **Versioning:** the `/v1/` prefix leaves room for a breaking runtime contract change while old loaders still point at v1.

### Dev workflow
- `pnpm dev` also runs `vite build --watch` for the runtime, and `packages/sdk/playground` on port 5174.
- The playground is a small page wired with the Vite plugin. It reads `NOOTED_PROJECT_KEY` from `packages/sdk/.env.local` and uses `http://localhost:5173` as the Nooted URL.
- The console's settings page shows the real snippet and a Vite plugin example for the project.

### Testing
- **Unit:** `node --test` covers the loader's logic (run against a fake window), snippet escaping and size, buffer, shake detector, payload, classify, backoff and token validity.
- **End-to-end:** Playwright (`@playwright/test`, Chromium) in `packages/sdk/e2e`. Global setup:
  - starts the Nooted server on a temp `DATA_DIR`, plus the playground (both with Dex running via compose);
  - signs in as admin through Dex;
  - creates a project with origin `http://localhost:5174` and writes its key for the playground.
- **Request inspection:** tests that check the uploaded body intercept it with `page.route`, decompress it and inspect it, then let it continue. Raw data is never exposed by the API, so this is the only way to check masking end to end.
- **Synthetic input:** shake is driven by dispatching synthetic `DeviceMotionEvent`s; voice by installing a fake `SpeechRecognition` class before the SDK loads.

## Risks / Trade-offs

- [rrweb 2 is published as alpha] → Pin an exact version. The first recorder task verifies `maskInputFn` gets the element and that blocked elements become placeholders. If not, fall back to rrweb 1.x with a `maskInputFn` that marks show-fields differently, and update this design.
- [Strict CSP on host pages] → The external loader file is the plugin default, the hash is exported for inline use, and nonces are passed on. Sites still need the Nooted origin in `script-src` and `connect-src`, which the README documents along with the load-failure warning.
- [External loader adds a request] → It's tiny, content-hashed and cacheable. Sites that would rather avoid it use `inline: true`.
- [Popup blockers] → The popup opens synchronously in the tap handler, with a clear message when it's blocked.
- [False-positive or missed shakes] → Conservative defaults and a tuning knob. Proper tuning on real devices stays an open question from the decisions doc.
- [Large or slow recordings on heavy pages] → Mousemove and scroll sampling, no canvas or fonts, and the 30 s checkout. Size problems show up as 413s in the logs, which tells us to tune.
- [A closed shadow root makes debugging harder] → `localStorage['nooted:debug'] = '1'` switches it to an open shadow root.
- [Playwright needs Chromium and system libraries in WSL] → The e2e setup task installs them and documents the command. If system libraries can't be installed without sudo, e2e runs in the Playwright Docker image instead.

## Open Questions

- Shake threshold defaults need tuning on real phones. Only the default value changes, so it doesn't affect the specs or tasks.

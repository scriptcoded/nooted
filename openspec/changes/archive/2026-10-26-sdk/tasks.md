# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial).

## 1. Package scaffolding [haiku]

- [x] 1.1 Create `packages/sdk` (`@nooted/sdk`, type module) with the layout from design.md, a tsconfig (bundler resolution, `allowImportingTsExtensions`, `erasableSyntaxOnly`, DOM libs, `jsx: react-jsx` with `jsxImportSource: preact`), and scripts `build:loader`, `build`, `dev`, `test` (`node --test "src/**/*.test.ts"`), `typecheck`, `e2e`. Add the dependencies `@rrweb/record` (exact pinned version), `preact`, `fflate` and `@nooted/shared` (types), and the devDependencies `vite`, `@preact/preset-vite`, `esbuild` and `@playwright/test`. Verify that `pnpm install` succeeds and `pnpm --filter @nooted/sdk typecheck` passes on placeholder entries.
- [x] 1.2 Add Vite configs: runtime IIFE `dist/nooted.js` with a source map, and npm entries `dist/index.js` and `dist/vite.js` with `.d.ts` files. Gitignore `code.generated.ts`. Update the root scripts so `dev`, `build` and `typecheck` run `build:loader` first and `dev` also runs the SDK runtime watch and playground. Verify that `pnpm --filter @nooted/sdk build` produces the three files.

## 2. Loader and public API [sonnet]

- [x] 2.1 Implement `loader/loader.ts` per the design's global contract: the stub, the `#nooted` / `#nooted-off` hashes removed with `history.replaceState`, `l()` injection, and error/rejection queueing only when enabled. Implement `build:loader` (esbuild minify → `code.generated.ts`). Unit tests run the loader against a fake `window`/`document`/`localStorage` and cover every `sdk-loader` scenario that doesn't need a real browser (disabled makes no request and adds no listeners, enabled injects the script, hash enable/disable with the URL cleaned, early error and early call queueing), plus a gzipped size of ≤ 1 KB. The loader also passes its `nonce` to the injected script and logs one `[nooted]` warning from the script's `onerror`. Tests cover both.
- [x] 2.2 Implement `loaderSnippet()` with safe JSON escaping, `loaderCspHash()` sharing the same serialization, and the `nooted` API object (`init`, `open`, `signOut`, `disable` forwarding to the global, a single warning when the loader is missing, `init` setting the flag and calling `l()`). Tests cover escaping of `</script>` and U+2028, that the hash equals the SHA-256 of the snippet's script text, and the forwarding behavior.
- [x] 2.3 Implement the Vite plugin in `vite.ts`. By default it emits `nooted-loader-[hash].js` (respecting `base`, served by middleware in dev) and injects a classic `<script src>` as the first child of `<head>`. `inline: true` injects the snippet instead. Tests run Vite builds of a fixture HTML file in both modes and assert the loader comes before any other script and that the emitted file exists.

## 3. Bundle serving, console snippet, playground [haiku]

- [x] 3.1 Server: add `SDK_DIST_DIR` to the config (with a test), and `GET /sdk/v1/nooted.js` and `.map` per design.md: in-memory cache keyed by mtime, SHA-256 ETag, `no-cache`, 304, CORP `cross-origin`, and 404 with a logged hint when the file is missing. Server tests cover 200 headers, 304 on `If-None-Match`, and 404 when missing (using a temp dir).
- [x] 3.2 Console settings page: replace the placeholder with `loaderSnippet({ projectKey, nootedUrl: location.origin })` in a copyable code block, its `loaderCspHash()` with a one-line "if your site has a CSP" hint, and a copyable Vite plugin example. Verify with the web typecheck and build, and check by hand in the console.
- [x] 3.4 Server: extend the sign-in page's no-opener message to name `Cross-Origin-Opener-Policy: same-origin` as a likely cause and suggest `same-origin-allow-popups`. Update the existing "opened directly" server test to assert the text.
- [x] 3.3 Add `packages/sdk/playground` (a Vite app on port 5174 using the plugin from source, reading `NOOTED_PROJECT_KEY` from `.env.local`). It has a form with normal, password, `data-nooted="show"`, `"block"` and `"mask"` elements, a "throw error" button, an SPA-style route switch and aggressive global CSS. Delete `dev/sdk-test`. Verify that `pnpm dev` serves the playground and the page loads.

## 4. End-to-end harness [sonnet]

- [x] 4.1 Install Playwright Chromium (document the command; use the Playwright Docker image if system libraries can't be installed). Write the global setup per design.md: a temp `DATA_DIR` server, the playground, a Dex login as admin, a project with origin `http://localhost:5174`, and the key written for the playground. Add helpers to decode intercepted gzipped report bodies. Verify with a smoke test: the playground with the flag unset makes no requests to the Nooted origin.
- [x] 4.2 Add a minimal `runtime/main.ts` that installs the real API onto the stub and drains `q`/`e`, plus `safe.ts` (`guard()`, `[nooted]` logger). E2E tests cover enable by `#nooted` (the bundle is fetched and the URL cleaned), `#nooted-off`, an early `nooted.open()` call reaching the runtime, and the app working with the bundle URL returning 500.
- [x] 4.3 CSP e2e: give the playground modes that send a strict CSP header (`script-src 'self' <nooted>; connect-src 'self' <nooted>`), a nonce-based CSP (an HTML-rewriting middleware with a fresh nonce per request), and a CSP missing the Nooted origin. Tests: the default external loader works under the strict CSP, the nonce is propagated and the SDK runs, and the missing-origin case logs exactly one `[nooted]` warning mentioning `script-src` while the page keeps working. Add a COOP `same-origin` mode, and once group 7 lands, assert that the popup shows the COOP explanation.

## 5. Recording [sonnet]

- [x] 5.1 Implement `buffer.ts` (segments, keep the last two, `freeze()`) with unit tests for the long session, short session and immutable frozen copy.
- [x] 5.2 Implement `recorder.ts` with the design's rrweb config, and first verify in an e2e test that rrweb's `maskInputFn` receives the element. If it doesn't, stop and report before going further. E2E tests (intercepted bodies, triggered via `nooted.open()` once group 7 lands; until then via a test hook that freezes and exposes events) cover default masking, `show` opt-out, password inside `show`, `block` placeholder, `mask` text, and no Nooted markup in events.
- [x] 5.3 Implement `errors.ts` (with loader-queued errors replayed). E2E tests cover an uncaught error and a rejection with a plain value appearing as `nooted:error` events.

## 6. Triggers [sonnet]

- [x] 6.1 Implement the pure shake detector with unit tests: synthetic shake (fires), walking and scrolling (doesn't fire), cooldown, threshold override.
- [x] 6.2 Wire `devicemotion`, the keyboard shortcut, the iOS permission request and the single `trigger()` path (freeze + `capturedAt` + URL, ignored while the window is open). E2E tests: synthetic DeviceMotionEvents open the window, Ctrl+Shift+. opens it, a second trigger while open keeps the first freeze, and a stubbed `DeviceMotionEvent.requestPermission` is called on the first button tap.
- [x] 6.3 Implement the floating button (draggable, clamped to the viewport, position persisted, `button: false`, pending badge hook). E2E tests cover tap, drag + reload, and hidden.

## 7. Report window [sonnet]

- [x] 7.1 Implement the shadow-root mount with re-attach and the debug open-shadow switch. E2E tests: hostile global CSS doesn't hide the controls, and replacing body contents re-attaches the host.
- [x] 7.2 Implement token storage and the sign-in flow (synchronous popup, origin and source checked messages, blocked-popup message, `not_member` message, `signOut()` revoking). E2E tests: sign in through the real popup and Dex, the frozen buffer is preserved across sign-in, a foreign `postMessage` is ignored, a blocked popup (stubbed `window.open` → null) shows the message, `signOut()` revokes and the next window shows sign-in.
- [x] 7.3 Implement the note form (required, max length, Cancel discards, Escape, focus handling), voice input (shown only with `SpeechRecognition`; appends the transcript), "Turn off Nooted on this device", and the 320 px layout. E2E tests cover each `sdk-report-window` form, voice, turn-off and viewport scenario, using a fake SpeechRecognition.

## 8. Upload and queue [sonnet]

- [x] 8.1 Implement `payload.ts`, `gzip.ts` and `classify.ts` with unit tests: payload output passes the shared `ReportPayload` schema, the URL comes from trigger time, and the classification table matches the spec.
- [x] 8.2 Implement `client.ts`, `queue.ts` (IndexedDB plus memory fallback, 20-item and 7-day limits) and `retry.ts` (start, `online`, backoff, single in-flight). Wire the send outcomes into the report window and the pending badge. E2E tests: successful upload creates an item visible in the console API; offline send → queued → `context.setOffline(false)` → delivered; reload keeps the queue; a lost response retried returns 200 with no duplicate (intercept and abort after the server responds); 503 backoff (fake timers); expired token keeps the report queued and switches the window to sign-in; 413 is not retried; full-queue drop; badge count.

## 9. Docs and packaging [haiku]

- [x] 9.1 Update the README: SDK setup (copy-paste snippet or Vite plugin, `nooted.init` / `open` / `signOut` / `disable`, enabling with `#nooted`, privacy markers, a "Sites with a CSP" section with the exact directives for each loader option and the COOP note, the popup note, the playground). Verify that the commands in it work.
- [x] 9.2 Make the Dockerfile build the SDK and point the server's `SDK_DIST_DIR` at it. Verify that `docker compose --profile app up --build` serves `/sdk/v1/nooted.js` with the expected headers.

## 10. Integration [sonnet]

- [x] 10.1 Run the full suite: `pnpm typecheck`, `pnpm -r test` and `pnpm --filter @nooted/sdk e2e`. Confirm the size budgets (loader ≤ 1 KB gzipped, runtime ≤ 100 KB gzipped) and report the actual sizes.
- [x] 10.2 Hand check in desktop Chrome with phone emulation on the playground: enable with `#nooted`, open the window (floating button and synthetic shake), sign in through the popup, dictate a note, send and see it in the console, then send while DevTools is offline and confirm it arrives once back online. Shake tuning on a real phone stays open (design.md Open Questions).

## Workflow follow-up

- Archive the change once it's reviewed (`/opsx:archive`).

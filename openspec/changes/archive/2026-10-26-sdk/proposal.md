# Proposal

## Why

The backend can accept reports, but nothing produces them yet. The SDK is the part that runs inside your own apps: it records a rolling rrweb buffer, opens a report window when you shake the phone, and uploads the note with the frozen buffer. Building it now means real reports from real sites start piling up, and later changes (digests, tracking, MCP) can be built and tuned against them. The raw data is kept so digests can be rebuilt.

## What Changes

- **New package `packages/sdk` (`@nooted/sdk`)**, which builds three things:
  - **Inline loader** (under 1 KB gzipped): if `nooted:enabled` is set in `localStorage`, it injects the full SDK script from the Nooted server. Otherwise it does nothing. It also queues early errors and API calls until the SDK arrives.
  - **Full SDK bundle**, `nooted.js`: the rrweb recorder, triggers, report window and upload queue.
  - **npm entry point**: `loaderSnippet()` and `loaderCspHash()`, a typed `nooted` API (`init`, `open`, `signOut`, `disable`) that forwards to the global, and a Vite plugin `@nooted/sdk/vite`. By default the plugin emits the loader as a small external file, so it works under a strict Content Security Policy. Inlining is optional.
- **CSP support**: the loader passes its `nonce` on to the SDK script, and logs a clear `[nooted]` warning when the SDK is blocked. The console shows the inline snippet's CSP hash. The sign-in popup explains when a site's `Cross-Origin-Opener-Policy` cuts it off from the page.
- **Enabling**: `nooted.init()` (called by the app, e.g. for admins) or visiting a page with `#nooted` sets the flag. `#nooted-off`, `nooted.disable()` or "Turn off" in the report window clear it. The flag only enables local recording, never uploads.
- **Recording**: rolling buffer of the last ~30–60 s via `checkoutEveryNms`, keeping two segments. All inputs are masked, and `data-nooted="block" | "mask" | "show"` markers are honored (passwords are always masked). Global errors and unhandled rejections go into the timeline as custom events. Nooted's own UI is never recorded.
- **Triggers**: shake (with the iOS motion-permission prompt on the floating button's first tap), a keyboard shortcut, a draggable floating button, and `nooted.open()`. Every trigger freezes the buffer and records the timestamp.
- **Report window**: rendered in a shadow root on `<body>`. It shows "Sign in to Nooted" when there's no token (opening the existing sign-in popup), otherwise a note form with an optional voice input (Web Speech API, only where supported) and Send.
- **Upload**: the payload is gzipped with `CompressionStream` and POSTed with the upload token. Failed uploads go into an IndexedDB queue and are retried on load, when the browser comes back online, and with backoff. Retries use the same client report id, so the server's idempotency prevents duplicates.
- **Isolation**: every entry point is wrapped, so Nooted never throws into the app. All rrweb events pass through one internal buffer module, so the deferred heartbeat worker can be added later.
- **Server**: serves the SDK bundle at `/sdk/v1/nooted.js`.
- **Console**: the project settings page shows a real loader snippet in place of the placeholder.

Deferred (unchanged from the decisions): heartbeat Web Worker, "alive" marker and crash recovery, publishing to npm, shake-threshold tuning beyond sensible defaults.

## Capabilities

### New Capabilities
- `sdk-loader`: loader snippet, enable/disable flag, loading the SDK bundle from the server, early error and call queueing, the public JS API and Vite plugin, and the guarantee that Nooted never breaks the host app.
- `sdk-recording`: the rolling rrweb buffer, privacy masking, error capture into the timeline, and freezing the buffer on a trigger.
- `sdk-triggers`: shake, keyboard shortcut, floating button and the programmatic trigger, plus the iOS motion permission.
- `sdk-report-window`: the isolated report UI, signing in from it, the note form, voice input and turning Nooted off.
- `sdk-upload-queue`: compressing and uploading reports, the persistent retry queue and token handling for queued reports.

### Modified Capabilities
- `sdk-sign-in`: the no-opener message also explains the `Cross-Origin-Opener-Policy` cause. Everything else in the sign-in and upload contracts (`sdk-sign-in`, `report-ingestion`) is used as it is.

## Impact

- New `packages/sdk` with dependencies `rrweb` and `preact`. It's built with Vite library mode and tested with node:test (pure modules) and Playwright (browser end-to-end).
- `apps/server`: a route serving the SDK bundle, and a config option for the SDK build directory, defaulting to `packages/sdk/dist`.
- `apps/web`: the settings page renders `loaderSnippet()` and its CSP hash for the project.
- `apps/server`: the sign-in page's no-opener message mentions COOP.
- Root: `pnpm dev` also runs the SDK build in watch mode, and the Dockerfile builds the SDK.
- `dev/sdk-test`: the hand-written test page is replaced by a page that uses the real loader.

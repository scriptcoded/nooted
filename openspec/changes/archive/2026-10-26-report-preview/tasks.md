# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial). Start only after the `sdk` change is archived.

## 1. Payload schema and ingestion [sonnet]

- [x] 1.1 Extend `ReportPayload` in `packages/shared/src/report.ts` per design.md "Payload and schema": add optional `focus { start, end }` and `recording: false`, plus the cross-field rules (events required unless omitted; omitted means only `nooted:error` custom events and no focus; focus `start < end` and within the event span with 1 s end slack). Add shared unit tests for each rule; verify with `pnpm --filter @nooted/shared test`.
- [x] 1.2 Add server ingestion tests for every `report-ingestion` scenario: omitted recording with no events accepted; omitted with screen data, invalid focus and focus without recording each rejected with 400; valid focus kept byte for byte in the raw blob. Verify with `pnpm --filter @nooted/server test`.
- [x] 1.3 Extend `buildPayload` with `focus` and `includeRecording` (filter to error events and set `recording: false` when off; drop focus when off). Unit tests check the output passes the updated schema in all combinations. Verify with `pnpm --filter @nooted/sdk test`.

## 2. Replay bundle and serving [sonnet]

- [x] 2.1 Add `@rrweb/replay` pinned to the same exact version as `@rrweb/record`, and a `src/replay/main.ts` entry built into `dist/replay.js` with a source map, registering `window.nooted.p`. `pnpm --filter @nooted/sdk build` must produce `dist/replay.js`. Extend the e2e size test: runtime ≤ 100 KB gzipped, replay ≤ 150 KB gzipped. Verify with `pnpm --filter @nooted/sdk e2e -- size`.
- [x] 2.2 Serve `/sdk/v1/replay.js` and `.map` from the server's SDK bundle route with the same headers. Extend `bundle.test.ts` (200 headers, 304, 404 when missing); verify with the server tests.
- [x] 2.3 In the runtime, capture `document.currentScript.nonce` at boot and add the on-demand loader (script injection with nonce, a promise resolved on registration, rejected on error or a 15 s timeout, idempotent). E2E: opening the window without tapping Preview makes no `replay.js` request; under the playground's nonce CSP mode the player loads and registers.

## 3. Timeline and choices [sonnet]

- [x] 3.1 Implement the pure timeline model (`ui/timeline.ts`): span, fraction conversion, clamping with a 500 ms minimum gap, keyboard steps, error marker times, and end-snap to "no focus". Unit tests cover each; verify with `pnpm --filter @nooted/sdk test`.
- [x] 3.2 Add `focus` and `includeRecording` to app state (reset on `trigger()`), the timeline component (two `role="slider"` handles: pointer and keyboard, error markers) and the "Include recording" switch, whose label says errors are still included. Wire them into the payload, and widen the `send.ts` re-send cache so it rebuilds bytes on any changed choice while keeping the id. E2E covers:
  - the focus range is sent with the chosen timestamps, and no focus is sent when the handles are untouched;
  - keyboard movement with aria values;
  - an error marker appears at a thrown error;
  - toggle off: the window hides the timeline, and the uploaded report has `recording: false`, only error events, and no focus; with nothing captured, an empty list;
  - the toggle is back on for the next trigger;
  - a 401 re-send after changing the choice reuses the same client report id and reflects the new choice.

## 4. Preview [sonnet]

- [x] 4.1 Implement the Preview panel: the "Preview" button loads the player, then mounts `Replayer` in the shadow root with scaling to the window width, play/pause, seeking from the timeline handles, and playback looping within the focus range. E2E covers:
  - the preview plays and ends at the trigger time;
  - a masked email shows as `*` inside the replay iframe;
  - at 320 px, no horizontal scrolling in the panel or document;
  - the replay iframe has no `allow-scripts` in its sandbox.
- [x] 4.2 Failure handling. E2E covers:
  - `replay.js` answering 500 (via `page.route`) shows "preview unavailable", while the timeline and Send still work;
  - under the playground's strict CSP mode without `'unsafe-inline'` styles, the style-violation notice appears and Send still works.

  Add a playground CSP variant if the existing strict mode allows inline styles.

## 5. Docs and integration [haiku]

- [x] 5.1 Update the README SDK section: preview, focus range (metadata only, full recording still sent), the "Include recording" toggle (errors still sent), and in "Sites with a CSP" the preview's need for inline styles, with the fallback notice. Verify the documented commands still run.
- [x] 5.2 Run `pnpm typecheck`, `pnpm -r test` and `pnpm --filter @nooted/sdk e2e`, and report the actual runtime and replay bundle sizes against their budgets.
- [x] 5.3 Hand check in desktop Chrome with phone emulation on the playground: open "Review recording", preview, set a focus range around a thrown error, send, then send one with "Include recording" off. Confirm both arrive in the console.

## 6. Review view [sonnet]

- [x] 6.1 Move the preview and timeline out of the note form into a separate review view in the report window, per design.md "Layout" and the spec's "Review view" requirement. The form gets a "Review recording" button and a selection summary. The view has a title, the preview, the timeline, Reset and Done, and Escape returns to the form. Update the e2e specs (preview, preview-load, focus) for the new flow and add tests for open and return with the note intact, the summary text, Reset, Escape staying in the window, the toggle hiding the button, and the 320 px layout of both views. Verify with `pnpm --filter @nooted/sdk e2e`.
- [x] 6.2 Update the README "Report window" text for the review view, then rerun `pnpm typecheck`, `pnpm -r test` and `pnpm --filter @nooted/sdk e2e`, and report bundle sizes.

## Workflow follow-up

- Archive the `sdk` change before applying this one.
- Archive this change once it's reviewed (`/opsx:archive`).

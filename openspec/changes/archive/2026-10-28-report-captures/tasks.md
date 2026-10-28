# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial). E2E needs ports 3000/5174 free, or the alternate-port setup from `packages/sdk/e2e/README.md`.

## 1. Payload v2 [sonnet]

- [x] 1.1 Replace `ReportPayload` in `packages/shared/src/report.ts` with the v2 shape from design.md "Payload v2": `Capture` and `Mark` schemas, the unique-`n` rule, the FullSnapshot rule, the rule that every `[n]` token refers to a capture, and the limits (10 captures, 20 marks). Remove `focus`, `recording` and `events`. Rewrite the shared unit tests for every rule. Verify with `pnpm --filter @nooted/shared test`.
- [x] 1.2 Update the server ingestion tests for every `report-ingestion` scenario: no captures accepted, 11 captures rejected, old `events` format rejected, an unmatched token rejected, a duplicate number rejected, a capture without a snapshot rejected, an unreferenced capture accepted, and the raw blob stored byte for byte. Update the test helpers' sample payloads. Verify with `pnpm --filter @nooted/server test`.
- [x] 1.3 Rewrite `buildPayload` in the SDK for v2 (note, captures, window-open time and URL, device, release) with type-only shared imports, and widen the `send.ts` re-send cache to the draft (note plus captures). Unit tests check that the output passes `ReportPayload.parse`. Verify with `pnpm --filter @nooted/sdk test`.

## 2. Remove background recording [sonnet]

- [x] 2.1 Delete the boot-time recorder start, `buffer.ts` and its tests, the freeze in `trigger.ts`, early-error replay, `Preview.tsx`, `Timeline.tsx`, `ui/timeline.ts`, the focus and includeRecording state, and the review view in `ReportWindow.tsx`. Keep the recorder's rrweb config (masking, block and mask selectors) in a module the capture session can use. Remove error queueing from the loader (`e` and its listeners) and from `NootedStub`, and check the loader stays ≤ 1 KB gzipped.
- [x] 2.2 Delete or rewrite the e2e specs that covered removed behaviour (focus, preview, preview-load, and the buffer-dependent parts of recording and runtime). Keep and adjust the specs for loader, CSP, triggers, mount, sign-in, report window and upload, which now send text-only reports. Add a test that no rrweb events are emitted on an enabled page with the window open, and none for `error` listeners from the loader. Verify typecheck, unit tests and the full e2e suite.

## 3. Capture mode [sonnet]

- [x] 3.1 Implement the capture session (`capture/session.ts`): start and stop `record()`, `takeFullSnapshot` on Done and on demo start, a demo clip with a 60 s auto-stop, errors recorded as `nooted:error` custom events only during demos, and node ids from the mirror. Unit-test whatever logic is pure (event slicing, mark resolution), and verify with `pnpm --filter @nooted/sdk test`.
- [x] 3.2 Implement marking: the capture-phase interception per design.md, toggling marks, the desktop hover outline, highlight boxes that follow scroll and resize, and the capture bar (Done, Cancel, Record demo / Stop, mark count). The window and floating button are hidden during capture, and triggers are ignored. E2E covers:
  - marking a button doesn't run its handler;
  - unmarking;
  - scrolling while marking keeps highlights aligned;
  - Cancel adds nothing;
  - the host placeholder in captured events is 0×0;
  - Ctrl+Shift+. is ignored during capture.
- [x] 3.3 Implement element descriptions (`capture/describe.ts`) per design.md. Extend the playground with fixtures: a labelled input, an aria-labelled icon button, a link, a heading, an element with a generated-looking id, and a mask/block case. E2E asserts each description: tag, role, name, text, a selector that matches exactly one element, the rect, and no masked text leaking.
- [x] 3.4 E2E for demos: record a demo that opens a playground menu, stop, mark the open menu, Done. The capture has `demo: true`, starts with a FullSnapshot and ends with one, and the menu is marked. Also cover an error thrown during the demo (captured) and outside a demo (not captured), and the 60 s auto-stop (Playwright clock).

## 4. Editor and capture cards [sonnet]

- [x] 4.1 Turn the note form into the editor: "Add capture" stores the caret and inserts `[n]` on Done with spacing; numbers are never reused; Remove deletes the capture and its tokens; the 10-capture limit disables "Add capture" with a message; dictation still appends. E2E covers:
  - the inline sentence "If I click [1] I want a confirmation";
  - removing capture 1 keeps capture 2's number and tokens;
  - the note is unchanged after Cancel;
  - the limit.
- [x] 4.2 Capture cards with previews: load the replay player when the first capture exists; a thumbnail paused at the last frame with the mark rects drawn; tap to enlarge (and play demos); the existing CSP-violation notice; and a text-summary fallback when the player fails. E2E covers:
  - a text-only report never requests `replay.js`;
  - a capture loads it, and the thumbnail iframe shows masked `*` in an email field;
  - `replay.js` answering 500 gives the text summary, and sending still works;
  - at 320 px, no horizontal scrolling with two cards.
- [x] 4.3 End-to-end upload of a report with two captures (one with a demo) through the real server: 201, and the stored payload's note tokens and captures match. A 401 re-send after sign-in keeps the same `clientReportId`. Offline queueing works with captures. Verify with the full e2e suite.

## 5. Docs and integration [haiku]

- [x] 5.1 Update the README: report window (editor, Add capture, marking, Record demo, cards), the removal of background recording, the marking limitation for apps that act on pointerdown, and the "SDK HTTP contract" payload v2 (captures, marks, tokens). Verify the documented commands still run.
- [x] 5.2 Run `pnpm typecheck`, `pnpm -r test` and `pnpm --filter @nooted/sdk e2e`. Report the runtime, replay and loader gzipped sizes against their budgets.
- [x] 5.3 Hand check in desktop Chrome with phone emulation on the playground: write a note with a Point capture (a selected button) and a Record capture (opening the menu) inline, remove and re-add one, open the large views, send, and confirm the report arrives in the console.

## 6. Separate Point and Record, and redesign the window [sonnet]

- [x] 6.1 Split capture into two actions per design.md "Interaction design" and the `sdk-captures` spec. **Point** marks elements, with a bar showing the count, Cancel and Done. **Record** starts recording immediately, with a bar showing the timer, Cancel and Stop, a 60 s auto-stop that adds the capture, and no marking. Escape cancels both. Recordings have no marks and `demo: true`. Errors are recorded during Record only. Update the capture e2e specs: Point flow, Record flow (opening the menu while recording, Stop), Escape and Cancel in both, auto-stop adding the capture, errors only while recording, and triggers ignored during both.
- [x] 6.2 Redesign the report window per design.md:
  - the title "Request a change", the label "What should change?" and the new placeholder;
  - a toolbar with Point, Record and the mic, plus the hint line and the limit message;
  - one message area;
  - the footer with "Signed in as" and "Turn off Nooted on this device";
  - the floating button's accessible name becomes "Request a change", and the sign-in state uses the same header.

  Update every e2e spec that relies on the old labels.
- [x] 6.3 Capture rows and the large view per design.md:
  - 96×64 thumbnails framed around the selected elements for Point, and whole-viewport with a play glyph and duration for Record;
  - placeholder tiles without the player;
  - the large view with Back and Escape, and Play/Pause for recordings.

  E2E covers:
  - the thumbnail framing (the selected element is visible and roughly centred in the tile);
  - the recording duration label;
  - fallback tiles;
  - the large view;
  - 320 px with three rows and no horizontal scroll.
- [x] 6.4 Visual review: Playwright screenshots of the window (empty, with two captures, sign-in state), the Point bar with selections and hover, and the Record bar, at 320, 390 and 1280 px widths. Check spacing, alignment, wrapping, contrast and that nothing overlaps or clips, and fix what's off. Update the README "Report window" text to the new flow, then run `pnpm typecheck`, `pnpm -r test` and the full e2e suite.

## 7. Enabling only from the app [sonnet]

- [x] 7.1 Remove the "Turn off Nooted on this device" link (and `ui/turn-off.ts` if unused), keeping `nooted.disable()` with its full teardown. Remove the `#nooted` / `#nooted-off` hash handling from the loader and confirm `build:loader` shrinks and stays ≤ 1 KB gzipped. Give the playground "Enable Nooted" and "Disable Nooted" buttons that call `nooted.init()` and `nooted.disable()`, plus explanatory text. Update the loader unit tests, e2e helpers and specs (enabling via `init()`, a test that `#nooted` has no effect, the `disable()` teardown), the README ("Enabling on a device", API), the console settings page hint if it mentions the hash, and design.md. Verify with `pnpm typecheck`, `pnpm -r test` and the full e2e suite.

## Workflow follow-up

- After archiving, update the `sdk-recording` main spec Purpose to describe capture recording, and remove the now-empty `sdk-report-preview` main spec if the archive leaves it behind.
- Archive the change once it's reviewed (`/opsx:archive`).

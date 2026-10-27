# Design

## Context

What exists today, from the archived `sdk` and `report-preview` changes:
- **Runtime:** `packages/sdk/src/runtime/`, one IIFE served at `/sdk/v1/nooted.js`.
  - `recorder.ts` starts rrweb `record()` at boot and feeds `buffer.ts`, the rolling two-segment buffer.
  - `errors.ts` listens for errors all the time and replays the loader's early errors.
  - `trigger.ts` freezes the buffer when the window opens.
  - `ui/ReportWindow.tsx` holds the note form, a "Review recording" view (`Preview.tsx` and `Timeline.tsx`), the focus state and the include-recording state.
  - `upload/payload.ts` builds the report, and `upload/send.ts` caches built bytes per frozen report so a re-send keeps its `clientReportId`.
- **Replay bundle:** `src/replay/main.ts` builds into `dist/replay.js`, loaded on demand by `preview/load-replay.ts` with the page's nonce. It registers `window.nooted.p.createReplayer()`.
- **Loader:** `src/loader/loader.ts` queues API calls in `q` and, once enabled, errors in `e`.
- **UI:** the shadow-root host `#nooted-host` is `position: fixed` with 0×0 size and `pointer-events: none`. Its children opt back in. rrweb's `blockSelector` includes `#nooted-host`.
- **Server:** `ReportPayload` in `packages/shared/src/report.ts` (zod) is validated by `ingestReport` via `safeParse`. Raw payloads are stored gzipped as received.

See proposal.md for why.

## Goals / Non-Goals

**Goals:**
- Zero recording cost when no capture is being taken.
- Captures that a coding agent can act on, through element descriptions, without replaying anything.
- Marking that works with touch on a 320 px phone and with a mouse on desktop.
- The main runtime shrinks or stays the same size, despite the new capture UI. Removing `buffer.ts`, `Preview`, `Timeline` and error replay offsets it.

**Non-Goals:**
- Console rendering of captures, an MCP digest format, freehand drawing, multi-page clips (a demo stops on a full page navigation), and capturing cross-origin iframes' contents (rrweb limits).

## Decisions

### Recording only during a capture
- **Session lifecycle:** a capture session (`capture/session.ts`) starts rrweb `record()` when capture mode is entered, with the existing masking config. It stops it on Done or Cancel. The emitted events go into the session's own array; there is no global buffer.
- **Marking without a demo:** the page is effectively frozen, because clicks are intercepted. On Done the session calls `record.takeFullSnapshot()` and keeps only that Meta+FullSnapshot pair, plus the events after it.
- **With a demo:** "Record demo" calls `takeFullSnapshot()` and marks the start index. Done keeps everything from the start index, and a final `takeFullSnapshot()` is appended. That way the last frame is always a complete state for the preview and for node-id lookup.
- **Node ids:** marks are resolved to node ids through `record.mirror.getId(el)` at Done. They are valid because the snapshot comes from the same `record()` session.
- **Why one session:** starting and stopping `record()` per capture is cheap. Keeping one session per capture avoids any always-on listener (the reason for the change) and keeps node ids consistent within a capture.
- **Rejected:** rrweb-snapshot's standalone `snapshot()` without `record()`. It would duplicate the masking config path, and demos need `record()` anyway.

### Intercepting the page while marking
- **Listeners:** capture-phase listeners on `window`, added first thing on entering marking, for `click`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `touchend`, `submit`, `keydown` (Enter/Space on focused elements) and `contextmenu`.
- **Inside our UI:** for targets inside `#nooted-host` the listeners do nothing, so our bar works.
- **On the page:** they call `stopImmediatePropagation()`. They call `preventDefault()` on `click`, `mousedown`, `submit` and `contextmenu`, but not on touch or pointer events, so native scrolling keeps working.
- **What marks:** a `click` toggles the mark on `event.target`, after redirecting text nodes to their parent element. Desktop hover uses `pointermove` with `pointerType === 'mouse'`, throttled with rAF, to draw an outline.
- **Rejected:** a full-viewport overlay with `elementFromPoint`. It blocks touch scrolling on phones.
- **Known limitation:** apps that register their own window capture-phase listeners before ours, or that act on `pointerdown`/`touchstart`, may still react. Marking a link or button in those apps can trigger it. This is documented, and tests use the playground's ordinary handlers.

### Highlights and the capture bar
- **Highlights:** marked elements get highlight boxes drawn inside the shadow root at `getBoundingClientRect()`. Positions are recomputed on `scroll` (capture, passive), `resize`, and a `ResizeObserver` on marked elements.
- **The bar:** pinned to the bottom, 320 px safe. It shows "Tap things to mark them · N marked · Record demo · Cancel · Done". During a demo it shows "Recording demo 0:12 · Stop", with a 60 s auto-stop.
- **Host sizing:** in capture mode the host stays 0×0 with `pointer-events: none`. The bar and highlight layer opt in individually: the bar takes events, highlights don't. That keeps rrweb's blocked placeholder for `#nooted-host` at 0×0, so captures don't contain a box over the page. A test asserts this.

### Element descriptions
`capture/describe.ts` is DOM code. The repo has no DOM test library, so it's covered by e2e tests against playground fixtures. Fields:
- `tag`
- `role`: the explicit `role` attribute, or a small implicit-role table for button, a[href], input types, select, textarea, img, headings, nav, main, dialog, li.
- `name`: `aria-label`, `aria-labelledby` text, `alt`, `title`, the `<label for>` text, or the text content for buttons and links.
- `text`: the first 200 characters of normalized `textContent`. It is empty when the element, or any ancestor, matches `[data-nooted="mask"]` or `[data-nooted="block"]`, or when the element is an input, select or textarea.
- `selector`: `#id` when the id is unique and doesn't look generated. Otherwise a short `tag.class:nth-of-type` chain up to the nearest id or `body`, verified with `querySelectorAll(...).length === 1`.
- `rect`: page coordinates (client rect plus scroll).
- `nodeId`: from the rrweb mirror.

Elements inside Nooted's host can't be marked.

### Editor and tokens
- **The editor:** a `<textarea>`.
- **Inserting a token:** "Add capture" stores `selectionStart`/`selectionEnd` before entering capture mode. On Done it inserts `[n]` there, with a space before or after if one is needed, and restores the caret after the token.
- **Numbering:** `n` is `max(existing numbers) + 1`, so numbers are never reused within a report. Removing capture `n` removes every `[n]` token, regex `\[n\]` with whitespace tidy-up.
- **Dictation:** keeps appending, as today.
- **Rejected:** contenteditable with chips, because of IME and caret problems on Android.

### Capture cards and preview
- **Cards:** below the textarea. Each shows the number, the marked-element names (`name || text || tag`), "demo" if it has a clip, and Remove.
- **Thumbnails:**
  - When the first capture is added, the runtime calls `loadReplay()`, the existing loader with its nonce.
  - Each card mounts a `Replayer` with the capture's events, paused at the last event, scaled into a thumbnail box. It draws the marks' rects, scaled, over it.
  - Tapping the thumbnail opens a larger view in the window, which plays the clip if there is one.
  - If the player fails to load, cards fall back to the text summary.
- **Reuse:** the existing scaling and CSP-violation code from `Preview.tsx` moves into `ui/CapturePreview.tsx`. `Timeline` and the focus code are deleted.

### Payload v2
In `packages/shared/src/report.ts`:
```
ReportPayload = strictObject({
  clientReportId: uuid, note: 1..10000, url, capturedAt (window open time, ms), release?, device,
  captures: array(Capture).max(10),
})
Capture = strictObject({
  n: int 1..10, url, capturedAt, viewport { width, height }, scroll { x, y },
  demo: boolean, events: array(RrwebEvent).min(2), marks: array(Mark).max(20),
})
Mark = strictObject({ nodeId: int, tag, role?, name? (≤200), text (≤200), selector (≤500), rect { x, y, width, height } })
```
`superRefine` checks:
- `n` is unique;
- each capture's events contain a FullSnapshot (type 2);
- every `\[(\d+)\]` match in the note refers to an existing `n`.

`[text]` that isn't a number is ignored. The old `events`, `focus` and `recording` fields are rejected because the object is strict. `ingestReport` is unchanged, and the `feedback_items.captured_at` column takes `capturedAt`. Mark node ids aren't checked against the snapshot on the server, because that would need snapshot traversal; the SDK guarantees it, and digests can tolerate stale ids.

### Removal
Deleted:
- `buffer.ts` and its tests;
- the boot-time `startRecorder` and early-error replay;
- `Preview.tsx`, `Timeline.tsx`, `ui/timeline.ts` and the focus and `includeRecording` state;
- the focus and recording code paths in `send.ts`;
- the error-queueing code in the loader (the `e` array and listeners; the `NootedStub.e` field goes).

`errors.ts` becomes `capture/errors.ts`, attached only during demos and adding custom events through the session's `record.addCustomEvent`. The e2e specs for the removed features (focus, preview, preview-load, the recording parts that depend on the buffer) are rewritten for captures. The specs for loader, CSP, triggers, sign-in and upload are kept and adjusted.

### Re-send cache
The cache key becomes the report draft object (note plus captures). Bytes are rebuilt when the note or captures change, and the `clientReportId` is kept. This is the same rule as today, with captures instead of focus.

## Risks / Trade-offs

- [Some apps react to pointerdown/touchstart before our capture listener] → We register at window capture as early as possible and stop propagation. The README documents the limitation. Demos are unaffected.
- [Large snapshots: a few hundred KB each, and up to 10 per report] → The existing 10 MB compressed limit applies. The window shows a size estimate warning above about 8 MB, and the upload error path covers 413.
- [Dynamic pages change between marking and Done] → Node ids are resolved at Done from the same `record()` session, so they match the final snapshot. A mark whose element left the DOM is dropped, with a notice on the card.
- [Selectors generated from classes can be unstable (CSS modules, Tailwind)] → They are best effort. Node id, text, name and rect give agents other handles.
- [The replay bundle loads as soon as a capture exists] → That's still on demand: users who send text-only reports never load it.
- [Breaking payload] → Server and SDK ship together from one image. Old queued reports get 400 and are dropped as permanent failures, which is acceptable for dev data.

## Migration Plan

Deploy the server and SDK together. There is no database migration; old raw payloads stay readable as stored blobs. After archiving, update the `sdk-recording` Purpose in the main spec to describe capture recording instead of a rolling buffer.

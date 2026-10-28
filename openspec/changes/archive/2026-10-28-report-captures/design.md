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
- **Session lifecycle:** a capture session (`capture/session.ts`) starts rrweb `record()` when Point or Record starts, with the existing masking config. It stops it on Done, Stop or Cancel. The emitted events go into the session's own array; there is no global buffer.
- **Point:** the page is effectively frozen, because clicks are intercepted. On Done the session calls `record.takeFullSnapshot()` and keeps only that Meta+FullSnapshot pair, plus the events after it.
- **Record:** `record()` starting emits the initial Meta+FullSnapshot, so the clip begins there. Stop appends a final `takeFullSnapshot()` and keeps everything. That way the last frame is always a complete state for the preview. Recordings have no marks, and the capture's `demo` flag is `true`.
- **Node ids:** marks are resolved to node ids through `record.mirror.getId(el)` at Done. They are valid because the snapshot comes from the same `record()` session.
- **Why one session:** starting and stopping `record()` per capture is cheap. Keeping one session per capture avoids any always-on listener (the reason for the change) and keeps node ids consistent within a capture.
- **Rejected:** rrweb-snapshot's standalone `snapshot()` without `record()`. It would duplicate the masking config path, and recordings need `record()` anyway.

### Intercepting the page while marking
- **Listeners:** capture-phase listeners on `window`, added first thing on entering marking, for `click`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `touchend`, `submit`, `keydown` (Enter/Space on focused elements) and `contextmenu`.
- **Inside our UI:** for targets inside `#nooted-host` the listeners do nothing, so our bar works.
- **On the page:** they call `stopImmediatePropagation()`. They call `preventDefault()` on `click`, `mousedown`, `submit` and `contextmenu`, but not on touch or pointer events, so native scrolling keeps working.
- **What marks:** a `click` toggles the mark on `event.target`, after redirecting text nodes to their parent element. Desktop hover uses `pointermove` with `pointerType === 'mouse'`, throttled with rAF, to draw an outline.
- **Rejected:** a full-viewport overlay with `elementFromPoint`. It blocks touch scrolling on phones.
- **Known limitation:** apps that register their own window capture-phase listeners before ours, or that act on `pointerdown`/`touchstart`, may still react. Marking a link or button in those apps can trigger it. This is documented, and tests use the playground's ordinary handlers.

### Interaction design (revised after the first hand check)
The first version mixed marking and demo recording in one bar and looked like a bug reporter. The revised flow makes each capture one clear action:

**Report window** (max width 440 px, full width minus 16 px at ≤ 480 px; fits 320 px):
- **Header:** the title "Request a change".
- **Note:** a field with the visible label "What should change?" and the placeholder "Describe the change. Point at things or record a demo to show what you mean."
- **Toolbar,** directly under the textarea, one row: **Point** (crosshair icon + "Point", aria-label "Point at something"), **Record** (filled-circle icon + "Record", aria-label "Record a demo"), and the microphone (icon only) when supported, pushed to the right. These are secondary buttons, compact (36 px high), with icons inline.
- **Hint:** while there are no captures, one muted line under the toolbar: "Point: tap the parts of the page you mean. Record: show it in action."
- **Limit:** at 10 captures, Point and Record are disabled and the hint reads "Up to 10 captures per report".
- **Captures list:** compact rows, see below.
- **Messages:** errors and notices (send error, unknown token, style notice, dictation) sit in one message area above the actions.
- **Actions:** Cancel (secondary) and Send (primary), right-aligned.
- **Footer:** a hairline, then one muted small line: "Signed in as {email}". Shown only when signed in. There is no turn-off action in the UI; the app enables Nooted with `nooted.init()` and disables it with `nooted.disable()`. The URL hashes are removed too.
- **Sign-in state:** the same header, then the intro text and the sign-in button.

**Point mode:**
- The window and floating button are hidden. A bottom bar, dark and full-width, shows the label "Tap what you mean", and "{n} selected" under it once n > 0. Its buttons are Cancel (ghost) and Done (primary).
- **Hover** (mouse only): a 2 px dashed outline in the accent colour.
- **Selected:** a 2 px solid accent outline, a 12 % accent tint, and a small filled check badge at the top-right corner, kept inside the viewport.
- Escape = Cancel. Selections follow scroll and resize.

**Record mode:**
- Starts immediately: recording begins, and the window and floating button are hidden.
- The bottom bar shows a pulsing red dot, "Recording 0:07" with a tabular-number timer, and the sub-label "Use the page". Its buttons are Cancel (ghost) and Stop (primary, red-tinted, square stop icon).
- Stop adds the capture. Auto-stop at 60 s adds it too, and the timer turns amber in the last 10 s.
- There is no marking and no interception, and the page is fully interactive. Escape = Cancel.

**Capture rows:**
- **Layout:** a 96×64 thumbnail at left, with rounded corners and a hairline border. To the right, exactly two single-line texts, each ellipsized (nothing wraps, down to 320 px):
  - line 1: `[n]` in bold mono, then the kind in muted text, "Pointed at" or "Recording";
  - line 2: the selected elements' names comma-joined, or "Whole page" for points; "m:ss · Ends on {page path}" for recordings.
  - At far right, an icon-only × button, aria-label "Remove capture n".
- **Point thumbnails** frame the union of the selected rects (viewport coordinates at the final frame) with 24 px padding, expanded to the thumbnail aspect ratio and clamped to the viewport. They are never upscaled beyond 1:1. Selected rects are drawn with the same selected styling, scaled.
- **Whole-page and recording thumbnails** use cover, anchored to the top: the viewport's width fills the 96 px tile and the top of the page shows (tall phone captures no longer become a narrow strip). Recordings get a centred play glyph and the duration badge.
- **Without the player** the row shows a neutral placeholder tile with an icon (crosshair or record) and the same text.
- Tapping the thumbnail or the row text opens the large view.

**Large view:**
- It replaces the form, and the panel widens to `min(960px, 100vw − 32px)` while it is shown (and returns to 440 px on Back). A header has a back arrow ("Back") and the title: "[n] Pointed at {names}" (ellipsized, full text in the tooltip), "[n] Pointed at the whole page", or "[n] Recording · m:ss".
- **Point captures with selections** are framed around the union of the selected rects with 160 px of context, at the aspect ratio of the available box, never upscaled above 1:1 (a small selection fills the box at 1:1), clamped to the viewport, with the selections drawn. A small button below toggles "Show whole page" and "Zoom to selection"; whole page fits the viewport in the box (max height about 70 vh, never more than the window height minus 260 px so the panel doesn't scroll). Point captures without selections show the whole viewport and have no toggle.
- **Recordings** fit the whole viewport in the widened panel (same height cap). Play/Pause sits below, replays from the start, and "Ends on {path}" is at the right of that row.
- Escape and Back return to the form, with the note and caret kept.

**Visual language:** one accent colour (the existing blue), consistent 8 px radius, a 4 px spacing grid, system font stack at 14–15 px, and buttons at 36 px (toolbar) and 40 px (actions/bars) for touch. All text and controls are styled explicitly inside the shadow root, so hostile host CSS can't reach them.

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

### Capture previews (mechanics)
- **Player loading:** `loadReplay()` runs once a capture exists. Each row mounts a `Replayer` paused at the last event, inside a fixed-size box.
- **Framing:** the crop described in "Interaction design" is applied with a transform on the replayer wrapper. The selected rects are drawn in the same transformed space.
- **CSP:** violations watched via `ui/style-violations.ts` show one notice.
- **Player failure:** rows fall back to placeholder tiles.
- **Cleanup:** replayers are destroyed on unmount.

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

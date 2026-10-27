# Design

## Context

This change builds on the `sdk` change (see its design.md). Relevant pieces of that change:
- The runtime is one IIFE served at `/sdk/v1/nooted.js` by `apps/server/src/sdk/bundle.ts`. That route serves a fixed map of file names, with ETag, `no-cache` and CORP headers.
- The report window (`ui/ReportWindow.tsx`) is Preact inside a closed shadow root. App state lives in `state.ts`: `frozen { events, capturedAt, url }`, `note` and `token`.
- `upload/payload.ts` builds the `ReportPayload`.
- `upload/send.ts` caches `{ note, clientReportId, bytes }` per frozen report, so a re-send after a 401 keeps its id.
- Captured errors are rrweb custom events (`type 5`, `data.tag === 'nooted:error'`).
- The shared `ReportPayload` currently requires `events.min(1)`.
- No digest or console replay exists yet. The raw payload is stored unchanged, so focus only needs to survive in it.

## Goals / Non-Goals

**Goals:**
- A preview, timeline and toggle that work on a 320 px phone and inside hostile host pages.
- The main runtime grows only by the timeline UI and a small loader, nowhere near the size of a replay player.
- One source of truth for what the user chose (focus, recording) that the payload builder reads at send time.

**Non-Goals:**
- Trimming or removing data before the focus start (decided: focus is metadata).
- Console-side replay or using focus in digests; that comes with the digest change.
- Promoting focus or recording into database columns or the feedback list.
- Editing or redacting the recording in the preview.

## Decisions

### Separate replay bundle, loaded on demand
`src/replay/main.ts` builds into `dist/replay.js` as its own IIFE, using a second Vite config or a second runtime entry with the same preact preset. It imports `Replayer` from `@rrweb/replay`, pinned to the same exact version as `@rrweb/record`, so the event formats can't drift.

The runtime loads it the way the loader loads the runtime:
- It injects `<script async src="<u>/sdk/v1/replay.js">`.
- It sets the nonce on that script. The runtime records `document.currentScript.nonce` synchronously when its IIFE starts. The loader already set that nonce on the runtime's own script tag.
- The bundle registers itself on the stub global as `window.nooted.p = { createReplayer(root, events, options) }`. A promise in the runtime resolves when it is registered, and rejects on `onerror` or after a 15 s timeout.
- Bundling rrweb's replayer into the main runtime was rejected: it would roughly double the 41 KB bundle for every page view, while only report senders who open the preview need it.

The server's bundle route serves `replay.js` and `replay.js.map` from the same `SDK_DIST_DIR` map, with the same headers. Budgets: the main runtime stays ≤ 100 KB gzipped and `replay.js` ≤ 150 KB gzipped, each enforced by the e2e size test.

### Preview rendering
- **Mounting:** `Replayer` mounts into a container inside the shadow root and creates its sandboxed iframe there. The sandbox has no `allow-scripts` (rrweb's default), so recorded markup can't run scripts. rrweb also doesn't record script contents.
- **Network:** `UNSAFE_replayCanvas` stays off and `mouseTail` is off. Images in the recording load from their original URLs, as they do on the live page. That isn't a request "on behalf of" the recorded page beyond what the page itself already made, so it's accepted.
- **Sizing:** the recording's viewport comes from the Meta event's `width`/`height`. The iframe is scaled with a CSS transform to fit the window width, keeping the aspect ratio and capping the height (about 45 vh), so it never causes horizontal scrolling.
- **Controls:** our own play/pause button and the shared timeline (below). rrweb-player was rejected: it ships a Svelte UI, adds size, and would duplicate the timeline.
- **Detecting blocked styles:** the replayer writes `<style>` elements into the iframe document. Under a host CSP without `'unsafe-inline'` in `style-src`, the inherited policy blocks them. We listen for `securitypolicyviolation` on the iframe document and on the host document, filtered to `effectiveDirective` starting with `style-src`, for the first second of playback. If one fires, the preview stays visible with a notice that it may look unstyled. A heuristic (comparing stylesheet counts) was rejected as less reliable.

### Timeline and focus
- **Model:** `ui/timeline.ts` holds the pure model for the timeline.
  - The span is `[firstEvent.timestamp, frozen.capturedAt]`.
  - Positions are converted to and from fractions.
  - Handles are clamped so `start < end` with a minimum gap of 500 ms.
  - Keyboard steps are 1% of the span, or 10% with Shift.
  - Error marker times come from the custom events.
  - Positions within 250 ms of both ends normalize to "no focus".

  Unit tests cover it with node:test.
- **UI:** a Preact component with two `role="slider"` handles carrying `aria-valuemin/max/now` and `aria-valuetext` in seconds. Pointer events cover touch and mouse, with `setPointerCapture`; arrow keys move the handles.
- **Without the player:** the timeline is independent of the replayer, so it works even when the preview failed. When the replayer is present, dragging a handle seeks the preview, and play loops within the focus range.
- **State:** `state.ts` gains `focus?: { start, end }` (absolute timestamps) and `includeRecording: boolean`. `trigger()` resets both, to no focus and `true`. Turning the toggle off keeps `focus` in state, so turning it back on restores it. The payload simply ignores focus while recording is off.

### Payload and schema
In `packages/shared/src/report.ts`:
- **New fields:** `focus: z.strictObject({ start: z.number(), end: z.number() }).optional()` and `recording: z.literal(false).optional()`. "Omitted" is explicit; absence means included, which keeps every existing client valid.
- **Cross-field rules,** in a `superRefine`:
  - if `recording` is not `false`, `events.length ≥ 1`;
  - if `recording === false`, every event is a custom event tagged `nooted:error`, and `focus` must be absent;
  - if `focus` is present, `start < end`, and both lie within `[min, max]` of the events' timestamps, with 1 s of slack at the end for the trigger time.

The server keeps calling `ReportPayload.safeParse`, so ingestion picks the rules up with no logic of its own. Server tests are added for each scenario.

`buildPayload` gains `focus?` and `includeRecording`. When recording is off it filters the frozen events to the `nooted:error` custom events and sets `recording: false`.

### Re-send cache
The `send.ts` cache key stays the frozen report. The cached entry now records the inputs that shape the bytes: note, the focus, and includeRecording. Bytes are rebuilt when any of them changed, and the `clientReportId` is kept. This generalizes the existing note check.

### Layout
The note form stays compact: a "Review recording" button with a one-line selection summary ("Whole recording" / "Highlighted 0:12–0:20"), then the "Include recording" switch, the note and the actions. The button opens a review view inside the same panel, which replaces the form while it is shown and is titled "Highlight what matters". It holds the preview, the timeline, Reset and Done. State lives in the app store, so switching views never loses the note or the selection, and the replayer is destroyed when leaving the view. Escape in the review view goes back to the form. "Trim" and "snippet" were rejected as labels, because the full recording is still sent. Nothing is fetched until the review view is opened, and that is what makes the "loaded on demand" requirement observable.

## Risks / Trade-offs

- [rrweb replay of the host page's CSS can be heavy on big pages] → The preview is opt-in, behind a tap, and the window stays usable while it loads.
- [Inline styles blocked by the host CSP] → Detected through `securitypolicyviolation`, with a notice. Sending isn't affected. The README documents it.
- [Replay bundle size] → It has its own budget test. Loading on demand keeps the cost off ordinary page views.
- [Focus timestamps vs. event clock] → Both come from the same `Date.now()` clock in the page, and the server validates against the event span with 1 s slack.
- [Omitted recording still sends error messages and stacks, which can contain data] → This is intentional, and the toggle's label says errors are still included. Stacks are already collected under the existing recording spec.
- [`sdk` not archived yet] → This change's apply waits until `sdk` is archived, so the `report-ingestion` delta and the window code build on the final state.

## Migration Plan

No data migration. The new payload fields are optional, so older SDK runtimes keep working. Deploying the server first is not required. A new runtime against an old server would see 400s only for omitted-recording reports with empty events, and server and SDK bundle ship together from the same image anyway.

# Design

## Context

What exists today:
- **Server:** `apps/server` (Hono, typed RPC client in `apps/web/src/api.ts`).
  - `GET /api/projects/:id/feedback` lists items from `feedback_items` (`feedback/repo.ts`), checking membership through `projects/repo.get(user, id)`.
  - Each item has a `blob_key`. The blob is the gzipped JSON payload exactly as uploaded (`BlobStore.get`).
  - Payloads are v2 (`ReportPayload` in `packages/shared/src/report.ts`, with `captures`). Dev databases also hold pre-capture reports with `events`, `focus` and `recording`, which no longer parse.
- **SDK:** `packages/sdk/src/runtime/ui/thumb-frame.ts` holds the pure framing functions (`fitLayout`, `coverTopLayout`, `frameLayout`; tested). `capture/tokens.ts` holds the `[n]` token helpers (`unknownTokens` and others).
- **Console:** `apps/web` uses React 19, MUI, TanStack Router and TanStack Query. The project layout has Feedback and Settings tabs, and the feedback list is a table.

See proposal.md for why.

## Goals / Non-Goals

**Goals:**
- A member can understand a change request without leaving the console: what was said, what was pointed at, and what was shown.
- The server API returns readable structures (summaries, element descriptions) that the MCP change can reuse.
- The list page stays cheap: it reads no blobs and loads no player.

**Non-Goals:**
- Changing status or triage actions, comments and editing.
- Digests or MCP.
- Rendering pre-capture recordings.
- Search and filtering.

## Decisions

### Shared, zod-free helpers
- `packages/shared` gains subpath exports:
  - `./frame` (`src/frame.ts`): the framing functions moved from the SDK, with their tests;
  - `./note` (`src/note.ts`): `splitNote(note)` → `[{ text } | { ref: n }]`, plus `unknownTokens`, also moved.
- Neither module imports `src/index.ts` or zod.
- The SDK switches its imports to `@nooted/shared/frame` and `@nooted/shared/note`, and deletes its copies. The size test guards against zod creeping in.
- **Rejected:** copying the code into `apps/web`, because the framing has to match what the reporter saw.

### Server API
Both routes live in `feedback/routes.ts`, mounted under the projects router so they reuse the membership check.

**`GET /api/projects/:id/feedback/:itemId`** returns:
```
{ id, note, url, status, createdAt, capturedAt, release, reporter {id,name,email},
  device { userAgent, viewport {width,height,devicePixelRatio} } | null,
  legacy: boolean,
  captures: [{ n, url, capturedAt, viewport, scroll, demo, durationMs, marks: Mark[] }] }
```
- `durationMs` is the last event timestamp minus the first.
- It answers 404 when the user isn't a member, or the item isn't in that project.
- Headers: `Cache-Control: private, no-cache`, plus an ETag over the JSON, since the status can change later.

**`GET /api/projects/:id/feedback/:itemId/captures/:n/events`** returns:
- the capture's `events` array, with `Cache-Control: private, max-age=31536000, immutable`, because a capture's events never change;
- 404 for an unknown item or capture number.

**Loading reports** (`feedback/report-store.ts`):
- `blobs.get` → gunzip → `JSON.parse` → `ReportPayload.safeParse`.
- **On failure:** a legacy result. It takes `note`, `url`, `capturedAt` and `device` from the loose object if they're present and well-typed, sets `captures: []` and `legacy: true`.
- **Cache:** parsed reports are kept in a small LRU, bounded by total decompressed size (64 MB), keyed by item id. Reports are immutable, so entries never need invalidating.
- **Missing blob:** a 500 with a logged error, since that means data loss.

### Capture count
- **Storage:** migration `002_capture_count` adds `feedback_items.capture_count INTEGER NOT NULL DEFAULT 0`. `ingestReport` sets it to `captures.length`.
- **List:** returns `captureCount`.
- **Existing rows:** they stay at 0. That's correct for pre-capture reports. Captured reports from before the migration are dev data, and the detail page shows their real captures anyway.

### Console UI
**Route:** `routes/_authed/projects/$projectId/feedback/$itemId.tsx`. The layout's Feedback tab stays selected, because anything that isn't Settings counts as Feedback. A "← All feedback" link goes back.

**Layout:** two columns at ≥ 900 px, one column below that.
- **Main column:**
  - the note, rendered by `NoteText` with `splitNote`: text segments plus small MUI `Chip`s labelled `[n]`, each a button;
  - below it, the capture list.
- **Side column:** a metadata card with:
  - the status chip;
  - reporter (name and email);
  - page (a link, opening in a new tab, rel `noopener noreferrer`, http(s) only);
  - reported at (absolute time with the relative time as a tooltip);
  - captured (time of window open);
  - device (user agent summarized to browser and OS, plus viewport `W×H @DPR`);
  - release.

**Capture card** (`CaptureCard`, `id="capture-n"`):
- A 240×160 thumbnail on the left (full width on narrow screens).
- Next to it, the header `[n]` plus "Pointed at" or "Recording · m:ss", the capture URL path and the capture time.
- For point captures, a list of the selected elements:
  - the name in bold, falling back to the text and then the tag;
  - the role, shown as a small chip;
  - a text excerpt, when it differs from the name;
  - the selector, in mono with a copy button.
- With no selected elements, the card says "Whole page".
- Clicking the thumbnail opens the large view.

**Clicking a reference:** `scrollIntoView({ block: 'center', behavior: 'smooth' })`, then a 1.2 s highlight ring on the card through a CSS class.

**Large view:** an MUI `Dialog`, `maxWidth="lg"` and `fullWidth`, that shows the final frame fitted to the dialog.
- **Point captures with selections:** framed around the selection with 160 px of context and a "Show whole page" toggle, the same rules as the SDK.
- **Recordings:** Play/Pause, which replays from the start.

**Player** (`ui/replay.ts`, lazy):
- `import('@rrweb/replay')` and its CSS are loaded only when a card mounts. A `useCaptureEvents(projectId, itemId, n)` query (with `staleTime: Infinity`) fetches the events.
- A `CapturePlayer` component mounts a `Replayer` into a fixed box, paused at the final event. It applies the `@nooted/shared/frame` layout through a transform on the wrapper and draws the mark rects as absolutely positioned boxes in the same transformed space, styled like the SDK's selections.
- The sandboxed iframe is rrweb's default (`allow-same-origin`, no scripts).
- **On error:** a neutral placeholder tile with an icon.

**List page:**
- Rows link to the detail page: the whole row is clickable, with a real link on the note cell for accessibility.
- The note cell uses `NoteText`, with chips that are inert in the list.
- A "Captures" column shows the count, or an em dash for none.

### Testing
- **Server unit tests:**
  - the detail shape;
  - membership: 404 for a non-member, for an item from another project, and for an unknown capture number;
  - the events endpoint returns exactly that capture's events, and its cache headers;
  - legacy-blob handling;
  - the capture count stored at ingest and returned by the list;
  - the LRU bound.
- **Shared unit tests:** the moved framing tests, and `splitNote`.
- **Console e2e:** in the existing Playwright harness in `packages/sdk/e2e`, which already runs the server, Dex and admin login.
  - Global setup builds `apps/web` once and starts the server with `WEB_DIST_DIR`.
  - Tests send a report with two captures through the SDK, then open the console as admin and cover:
    - the list (capture count, note chips);
    - the detail page (references, metadata, element descriptions);
    - the thumbnail framing (the selected element inside the tile);
    - the large view and recording playback;
    - the non-member 404 page;
    - the list loading neither `@rrweb/replay` nor any events request.

## Risks / Trade-offs

- [Big reports: up to 10 MB compressed, 100 MB decompressed] → The detail endpoint returns summaries only, and events are fetched per capture. The LRU is size-bounded.
- [Replayed host CSS inside the console] → It stays inside rrweb's sandboxed iframe, so it can't style the console.
- [Pre-capture dev reports] → They get the legacy path with a notice, not a crash.
- [Console e2e needs a web build, about 10–20 s] → It's built once per e2e run in global setup.
- [Moving helpers into `@nooted/shared` could pull zod into the SDK] → The subpath modules don't import the index, and the existing size test fails if the runtime grows unexpectedly.

## Migration Plan

Migration `002` runs automatically on server start, as `001` does. No data backfill is needed. Deploy the server and console together, from one image.

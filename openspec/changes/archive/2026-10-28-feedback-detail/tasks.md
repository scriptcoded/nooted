# Tasks

Model hints for apply: each group is tagged `[haiku]` (mechanical) or `[sonnet]` (non-trivial). E2E needs ports 3000/5174 free, or the alternate-port setup in `packages/sdk/e2e/README.md`.

## 1. Shared helpers [haiku]

- [x] 1.1 Move the SDK's framing functions into `packages/shared/src/frame.ts` and the token helpers into `packages/shared/src/note.ts`, adding `splitNote`. Export them as the `./frame` and `./note` subpaths, without importing the index or zod. Move their unit tests, add `splitNote` tests, and switch the SDK to the new imports. Verify with `pnpm -r test`, `pnpm typecheck` and the e2e size test, and confirm the runtime gzipped size is unchanged within 1 KB.

## 2. Server [sonnet]

- [x] 2.1 Add migration `002_capture_count`, set `capture_count` at ingest, and return `captureCount` from the feedback list. Tests cover the migration on an existing database, the count after ingesting a report with two captures, and the list field.
- [x] 2.2 Implement `feedback/report-store.ts` (blob → gunzip → parse → v2 or legacy result, with a size-bounded LRU), the item detail route and the capture events route per design.md, including the 404 rules and cache headers. Tests cover:
  - the detail shape, with no events present;
  - `durationMs` and the marks;
  - legacy blobs;
  - a non-member, another project's item and an unknown capture all getting 404;
  - the events route returning exactly that capture's events, with the immutable cache header;
  - the LRU staying within its bound.

  Verify with `pnpm --filter @nooted/server test`.

## 3. Console [sonnet]

- [x] 3.1 Feedback list: rows link to the detail page, notes render through `NoteText` with chips, and a Captures column shows the count. Verify with `pnpm --filter @nooted/web typecheck` and `build`.
- [x] 3.2 Detail page per design.md:
  - the route, the back link and the two-column layout;
  - `NoteText` with clickable references that scroll to and highlight their capture;
  - the metadata card;
  - capture cards with element lists and selector copy;
  - the legacy notice;
  - a not-found state for 404.
- [x] 3.3 The lazy player (`@rrweb/replay`, pinned to the SDK's version): `useCaptureEvents`, and `CapturePlayer` with framing and mark overlays. Add the thumbnails, the large-view dialog with the "Show whole page" toggle, and recording playback. A placeholder shows on error.

## 4. Console e2e and docs [sonnet]

- [x] 4.1 Extend the e2e global setup to build `apps/web` and serve it via `WEB_DIST_DIR`. Add console specs:
  - the list (capture count, chips, and no replay or events requests);
  - the detail page (references jump and highlight, metadata, element descriptions);
  - thumbnail framing (the selected element inside the tile);
  - the large view and recording playback;
  - not-found for a non-member;
  - the legacy notice, by inserting a pre-capture blob through a test helper.

  Verify with the full e2e suite.
- [x] 4.2 Visual review: take Playwright screenshots of the list and detail pages (with point and recording captures, the large view, and a legacy item) at 390, 900 and 1440 px widths. Look at them and fix what's off: spacing, alignment, wrapping, clipping, framing. Update the README console section.
- [x] 4.3 Run `pnpm typecheck`, `pnpm -r test` and the full e2e suite.

## Workflow follow-up

- Hand check in the console with real reports from the playground.
- Archive the change once it's reviewed (`/opsx:archive`).

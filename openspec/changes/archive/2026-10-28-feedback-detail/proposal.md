# Proposal

## Why

Reports now carry captures (selected elements and short recordings), but the console only lists notes with raw `[1]` tokens, and nothing behind them can be opened. Project members can't see what a change request points at, so the most useful part of every report is invisible. Building the item view first also produces the server-side "readable report" (note, references, element descriptions) that the planned MCP access for coding agents can reuse.

## What Changes

- **Feedback item detail page** in the console, at `/projects/:projectId/feedback/:itemId`.
  - The note shows `[n]` tokens as chips that jump to the matching capture.
  - Each capture has a thumbnail framed around its selected elements and a description of each element: name, role, text and selector.
  - Recordings play inline, and any capture opens in a large view.
  - The page also shows the item's reporter, page URL, report time, device and viewport, release and status.
- **Feedback list:** rows open the detail page, show a capture count, and render notes with chips instead of raw tokens.
- **Server:** two new endpoints, both for project members only.
  - **Item detail:** the note, the metadata, and capture summaries without events (number, URL, time, viewport, scroll, recording flag, duration, selected elements).
  - **Capture events:** one capture's rrweb events, for the player.

  Both read the stored report blob. Reports never change, so the responses can be cached.
- **Capture count:** stored per feedback item when a report is ingested, so the list doesn't have to read blobs. Existing items get 0.
- **Old reports:** reports stored in the format from before captures still open. Their note and metadata show, together with a notice that they have no viewable captures.
- **Shared code:** the thumbnail framing functions and the `[n]` token parsing move out of the SDK into `@nooted/shared`, under subpaths that don't pull in zod. The SDK and the console both use them.
- **Player:** `@rrweb/replay`, pinned to the SDK's version, is loaded lazily in the console.

## Capabilities

### New Capabilities
- `feedback-detail`: the console's view of a single feedback item and its captures, and the item and capture APIs behind it.

### Modified Capabilities
- `report-ingestion`:
  - "Raw report storage" now allows serving captures to project members, while the raw payload as a whole stays unexposed.
  - "Feedback list" now includes each item's capture count.

## Impact

- **`apps/server`:**
  - A migration adding `feedback_items.capture_count`.
  - Ingestion stores the count.
  - New routes under `/api/projects/:id/feedback/:itemId`.
  - A small parsed-report cache.
  - Tests.
- **`apps/web`:**
  - A new route and components: the note with chips, capture rows, the player with mark overlays, and the metadata panel.
  - The list updates.
  - The `@rrweb/replay` dependency.
- **`packages/shared`:** new zod-free subpath modules for framing and tokens. `packages/sdk` imports them instead of its local copies, so the runtime size is unchanged.
- **README:** the console section.
- **Security:** captures are served only to project members. They were masked in the browser before upload, and nothing here sends rrweb data to an LLM.

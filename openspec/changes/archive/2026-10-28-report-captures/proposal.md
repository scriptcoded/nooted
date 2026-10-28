# Proposal

## Why

Nooted is for change requests: someone on a live page points at things and says what they want different. The current report flow was built for bugs. It keeps a rolling recording of the last minute and freezes it when the window opens, and it has a "Review recording" view to highlight part of that recording. For change requests, that history is mostly noise. It also has a cost: it records continuously on every page view where Nooted is on, carries the most private data, and bloats uploads. It also can't capture what the user wants to show, because the thing they point at comes after the window is opened.

## What Changes

- **BREAKING: no background recording.** The rolling buffer, freeze-on-trigger, "Review recording" view, focus range, timeline and "Include recording" toggle are removed. Nooted records nothing until the user starts a capture.
- **Report window becomes a simple editor.** It's a free-text note in which **Add capture** inserts an inline token such as `[1]` at the cursor. Captures appear as cards under the text, with a preview of the captured frame (when the player can load) and a summary of the marked elements. A card can be removed, which also removes its tokens. Voice dictation keeps working. It's a plain text field with tokens, not a rich-text editor.
- **Capture mode.**
  - The window and floating button get out of the way, and a bar appears.
  - The user taps or clicks elements on the live page to mark them; tapping again unmarks. Desktop gets a hover highlight. While marking, page clicks are intercepted so the app doesn't react, and scrolling still works.
  - **Record demo** optionally records a short clip while the user uses the page normally. The clip has a maximum length and stops automatically.
  - **Done** returns to the editor; **Cancel** discards the capture.
- **A capture contains:**
  - an rrweb snapshot of the page at Done, or the demo clip ending there, with today's masking and privacy markers;
  - the marked elements described for agents: tag, role, accessible name, a text excerpt, a CSS selector, the bounding box, and the snapshot node id;
  - the URL, viewport, scroll position and capture time.

  Errors are recorded only inside demo clips, if they occur.
- **The loader stops queueing errors.** It only queues API calls before the SDK loads.
- **BREAKING report payload:**
  - `events`, `focus` and `recording` are replaced by `captures` (at most 10).
  - The note may reference captures as `[n]`.
  - The server rejects tokens that point at a capture that doesn't exist, duplicate capture numbers, and captures without a full snapshot.
- **README:** the SDK section and the HTTP contract are updated.

Out of scope: showing captures in the console (a follow-up), freehand drawing, and multi-page clips.

## Capabilities

### New Capabilities
- `sdk-captures`: capture mode on the live page, marking elements, demo clips, what a capture contains, and capture previews in the editor.

### Modified Capabilities
- `sdk-recording`:
  - Removes the rolling buffer, single buffer module, freeze-on-trigger and the always-on error timeline.
  - Masking, privacy markers and excluding Nooted's UI now apply to captures.
- `sdk-triggers`: triggers open the report window without freezing anything.
- `sdk-report-window`: the note form becomes the editor with capture tokens, and Cancel, Send outcome and Turn off refer to captures, not a frozen buffer.
- `sdk-upload-queue`: report upload sends the note and captures. The report URL is the page URL when the window opened.
- `sdk-loader`: early queueing covers API calls only.
- `sdk-report-preview`: retired. Every requirement is removed, and its preview behaviour moves to `sdk-captures`.
- `report-ingestion`: the report payload carries captures instead of a single event list.

## Impact

- **`packages/sdk`:**
  - Removed: `buffer.ts`, the always-on recorder start, early-error replay, `Preview.tsx` and `Timeline.tsx`, the focus and recording state, and their tests.
  - New: capture mode (UI bar, marking overlay, element descriptors, a per-capture rrweb session), the editor with tokens and capture cards, and payload v2.
  - The loader shrinks, since it no longer listens for errors.
  - The replay bundle stays, now used for capture previews.
- **`packages/shared`:** new `ReportPayload` (breaking).
- **`apps/server`:** ingestion validation follows the schema. Stored raw payloads keep the new shape, and the feedback list is unchanged.
- **Data:** reports from before this change aren't migrated (dev data only). A report queued on a device in the old format gets a 400 and is dropped, as a permanent failure.
- **README:** setup, report window and payload contract sections.

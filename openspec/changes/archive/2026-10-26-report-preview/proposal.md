# Proposal

## Why

When people send a report today, they can't see what it contains. They can't point at the moment that matters, and they can't send a note without the screen recording. Being able to watch the capture before sending builds trust, since it shows exactly what's masked. A focus range tells whoever reads the report, and later the digests, where to look. An opt-out lets people report from screens they don't want recorded at all.

## What Changes

- **Preview in the report window:** a replay of the frozen recording, exactly as it will be sent: masked inputs show as `*` and blocked elements as empty boxes.
  - The replay player is a separate bundle, `/sdk/v1/replay.js`, served by the Nooted server and loaded only when the preview is shown. The main runtime bundle doesn't grow by the size of the player.
  - If the player can't load, or the site's Content Security Policy blocks the preview's styles, the window says so and the report can still be sent.
- **Focus range:** a timeline under the preview with two handles. It also marks where captured errors happened.
  - The chosen range is sent as optional `focus: { start, end }` metadata.
  - The full frozen recording is always uploaded. Focus only says which part matters.
  - Leaving the handles at the ends sends no focus.
- **Include recording toggle:** on by default. When it's off:
  - the preview and timeline are hidden;
  - the report carries no screen recording, only the captured error events;
  - the URL, device information and note are sent as usual;
  - the payload marks the recording as omitted.
- **Report payload (shared schema and server):** gains the optional `focus` and an optional `recording: false` marker.
  - A report that omits its recording may have an empty event list.
  - Such a report must contain nothing but error events. The server rejects it if it carries screen data.
  - Focus must lie within the recording, and isn't allowed when the recording is omitted.
- **Bundle budgets:** the main runtime keeps its ≤ 100 KB gzipped budget. The replay bundle gets its own budget of ≤ 150 KB gzipped.

## Capabilities

### New Capabilities
- `sdk-report-preview`: in the report window, the preview of the captured recording, the focus range timeline, and the choice to leave out the recording, together with what each choice puts in the uploaded report.

### Modified Capabilities
- `report-ingestion`: the "Report payload" requirement changes. It adds the optional focus range and the omitted-recording marker, allows an empty event list when the recording is omitted, and adds validation rules for both.

## Impact

- `packages/sdk`:
  - A new runtime entry and Vite build output for `replay.js`, which depends on rrweb's replayer at the same pinned rrweb version as the recorder.
  - The report window UI (preview, timeline, toggle).
  - Payload building and the interactive re-send cache: a changed choice must keep the client report id.
  - New unit and e2e tests and a size-budget test for the replay bundle.
- `packages/shared`: `ReportPayload` gains `focus` and `recording`, with a conditional event rule.
- `apps/server`:
  - The SDK bundle route also serves `/sdk/v1/replay.js` and its source map.
  - Ingestion validates focus against the recording's time span, and checks that omitted-recording reports contain only error events.
  - Feedback list output is unchanged; focus stays in the raw payload for digests.
- README: preview, focus and the recording toggle. The CSP note gets the preview's `style-src` behaviour.
- Depends on the `sdk` change, which is still open; archive `sdk` first. The new window behaviour builds on its `sdk-report-window`, `sdk-recording` and `sdk-upload-queue` capabilities.

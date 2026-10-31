# Proposal

## Why

Reporters often want to show something across several pages ("this list, then this detail view"), but the report window is modal: the only way to reach another page is Cancel, which throws away the note and captures. Separately, "Point" is an unclear name for what reporters think of as taking a screenshot.

## What Changes

- Tapping outside the report window (on the dimmed backdrop) minimizes it into a draggable bubble instead of doing nothing. The draft (note, captures, caret) is kept in memory.
- While minimized the page is fully usable, so the reporter can navigate within the app (client-side routing) and come back.
- Tapping the bubble restores the window with the same draft. The other triggers (keyboard shortcut, shake, `nooted.open()`) also restore it rather than starting a new report.
- The bubble is the floating button in a "draft in progress" look; it is shown while minimized even when the app passed `button: false`, so the draft is never stranded.
- The draft does **not** survive a full page load or reload (decided: SPA-only, in-memory).
- Rename the "Point" capture action to "Screenshot" in all user-facing text: the SDK report window (button, aria-label, placeholder, hint, capture titles such as "Pointed at …"), the web console capture card and dialog, and the README. The internal/wire capture kind `point` and the MCP/agent-facing wording are unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `sdk-report-window`: new requirement for minimizing to a bubble and restoring; note form lists "Screenshot" instead of "Point"
- `sdk-triggers`: triggers restore a minimized report instead of being ignored; floating button doubles as the minimized bubble (shown even with `button: false`)
- `sdk-captures`: the "Point" action is renamed "Screenshot" (separate actions, point capture, capture limit wording)

## Impact

- `packages/sdk/src/runtime`: `state.ts` (minimized flag), `trigger.ts`, `ui/App.tsx`, `ui/ReportWindow.tsx`, `ui/FloatingButton.tsx`, `ui/styles.ts`, `ui/capture-info.ts`.
- `apps/web/src/components/CaptureCard.tsx`, `apps/web/src/replay/CaptureDialog.tsx` (label text).
- SDK e2e tests that locate the button by "Point at something" or assert "Pointed at" text; new e2e coverage for minimize/restore.
- `README.md` user docs.
- No server, API, storage or wire-format changes.

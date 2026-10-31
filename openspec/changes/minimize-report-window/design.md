# Design

## Context

The SDK UI is one Preact tree (`ui/App.tsx`) driven by the tiny store in `runtime/state.ts`. `App` shows either the floating button (`!open`), the report window (`open`), or the capture layer (`captureMode`). Every trigger goes through `trigger()` in `runtime/trigger.ts`, which today ignores calls while `open`. `close()` discards the draft. The draft (`draft`, `note`) already lives in the store, not in `ReportWindow`, and `editorCaret` already restores the caret when the window remounts after a capture. The floating button is draggable with a persisted position.

## Goals / Non-Goals

**Goals:**
- Minimize/restore with the draft intact using the existing store and button.
- Rename user-facing "Point" text to "Screenshot".

**Non-Goals:**
- Persisting a draft across full page loads (in-memory only; agreed with the user).
- Renaming the internal/wire kind `point`, `startPoint`/`finishPoint`, MCP tool descriptions or the agent digest.
- A capture-count badge or preview in the bubble.

## Decisions

**1. `minimized: boolean` in `AppState`, orthogonal to `open`.** `open` keeps meaning "a report is in progress" (draft exists); `minimized` hides the window. `App` renders `ReportWindow` when `open && !minimized && !capturing`, and `FloatingButton` when `!capturing && (open ? minimized : state.button)`. `close()` resets `minimized`. Alternative — a third value of `open` — would touch every `open` check for no gain.

**2. Restore goes through `trigger()`.** `trigger()` gains one branch: if `open && minimized`, set `minimized: false` and return true (no new draft, no `nooted:open` event/counter bump since no new report starts). This makes the bubble, shortcut, shake and `nooted.open()` all restore with no per-trigger code. Still ignored during `captureMode`.

**3. The bubble is `FloatingButton` with a `minimized` prop.** Reuses drag, clamping, position persistence, focus return and the motion-permission tap. Minimized look: a distinct accent (e.g. blue background with a small dot) and `aria-label`/`title` "Continue your change request". Same position key, so it sits where the user keeps the button.

**4. Backdrop minimize only for a press that starts and ends on the backdrop.** Record `pointerdown` target === backdrop, then on `click` minimize only if that flag is set and the click target is the backdrop too. Prevents text-selection drags that end outside from minimizing. Ignored while `phase === 'sending'`. During `sent`/`queued`, tapping outside just lets the pending close run (no minimize).

**5. Keep caret via `editorCaret`.** On minimize, store the textarea selection in `editorCaret`; the existing layout effect restores it on remount. The large-view selection (`viewing`) is component state and resets to the form — acceptable.

**6. Sign-in in progress.** Minimizing unmounts `ReportWindow`, whose cleanup stops a pending sign-in session. Acceptable: the user restores and taps Sign in again. No special case.

**7. Rename is text-only.** SDK: `ReportWindow.tsx` button label "Screenshot", aria-label "Take a screenshot", placeholder and hint; `capture-info.ts` titles "Screenshot" / "Screenshot of Add to cart" / "Screenshot of the whole page". Web: `CaptureCard.tsx`, `CaptureDialog.tsx` same wording. README user docs. Hint gains a short line that tapping outside minimizes the window so the user can go to another page.

## Risks / Trade-offs

- [Host app does a full navigation (MPA, `<a>` without router) while minimized] → draft lost silently. Accepted per decision; documented in README.
- [Accidental backdrop tap on mobile hides the window] → nothing is lost; bubble restores it. Lower cost than the old modal's no-op.
- [e2e tests locate the button by "Point at something"] → update `capture-helpers.ts` locators in the same task as the rename.

# Tasks

## 1. Rename "Point" to "Screenshot" (user-facing text)

- [x] 1.1 SDK: in `ui/ReportWindow.tsx` change the button label to "Screenshot", aria-label to "Take a screenshot", the placeholder and the no-captures hint; in `ui/capture-info.ts` change "Pointed at" titles to "Screenshot" / "Screenshot of …" / "Screenshot of the whole page". Verify with `pnpm --filter @nooted/sdk typecheck` and a grep showing no user-facing "Point"/"Pointed at" left in `packages/sdk/src/runtime/ui`
- [x] 1.2 Web: update the same wording in `apps/web/src/components/CaptureCard.tsx` and `apps/web/src/replay/CaptureDialog.tsx`; verify web typecheck passes
- [ ] 1.3 Update SDK e2e locators and text assertions (`capture-helpers.ts` `pointButton`, `editor.spec.ts`, `rows.spec.ts`, `console.spec.ts`, `report-window.spec.ts`, any "Pointed at"); verify the affected e2e specs pass
- [x] 1.4 Update README user docs (Point → Screenshot, lines ~72–73 and ~193); verify by grep that user-facing docs no longer say "Point" for the action

## 2. Minimize to a bubble and restore

- [x] 2.1 Add `minimized: boolean` to `AppState` (default false); `close()` resets it; `trigger()` restores (`minimized: false`) when `open && minimized` without creating a new draft or emitting `nooted:open`. Add unit coverage in `src/index.test.ts` (or nearest runtime test) for trigger-restores-minimized; verify tests pass
- [x] 2.2 `ui/App.tsx`: render `ReportWindow` when `open && !minimized && !capturing`; render `FloatingButton` when `!capturing && (open ? minimized : button)`, passing `minimized`. Verify typecheck
- [x] 2.3 `ui/FloatingButton.tsx` + `ui/styles.ts`: `minimized` prop gives a distinct look and `aria-label`/`title` "Continue your change request"; drag and position behave as today. Verify visually and via e2e in 2.5
- [x] 2.4 `ui/ReportWindow.tsx`: backdrop press that starts and ends on the backdrop sets `editorCaret` from the textarea and `minimized: true`; ignored while sending; hint mentions tapping outside to go to another page. Focus goes to the bubble on minimize (reuse `requestFabFocus`). Verify typecheck
- [ ] 2.5 Add e2e `packages/sdk/e2e/minimize.spec.ts` covering spec scenarios: tap outside minimizes and page is clickable; restore via bubble keeps note, captures and caret; client-side route change then restore and screenshot gets next number and new URL; drag ending on backdrop doesn't minimize; shortcut and `nooted.open()` restore; `button: false` shows bubble only while minimized; Cancel after restore discards. Verify the spec passes
- [x] 2.6 README: document minimizing (tap outside, bubble, in-memory only, lost on full reload); verify the section reads correctly

## 3. Integration

- [ ] 3.1 Run SDK unit tests, full SDK e2e suite and workspace typecheck; verify all pass

## Workflow follow-up

- Archive the change after review (`/opsx:archive`), syncing the three delta specs into main specs.

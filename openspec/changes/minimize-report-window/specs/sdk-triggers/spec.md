# Spec Delta

## ADDED Requirements

### Requirement: Triggers restore a minimized report
When the report window is minimized, every trigger (floating bubble, keyboard shortcut, shake, `nooted.open()`) SHALL restore it with the kept draft instead of starting a new report.

#### Scenario: Shortcut while minimized
- **WHEN** a report with a note is minimized and the user presses Ctrl+Shift+.
- **THEN** the window returns with that note

#### Scenario: App call while minimized
- **WHEN** a report is minimized and the app calls `nooted.open()`
- **THEN** the window returns with the same draft and no second report is started

## MODIFIED Requirements

### Requirement: Floating button
While Nooted is enabled, the SDK SHALL show a small floating button unless the app passed `button: false` to `init`. Tapping it SHALL trigger a report. The button SHALL be draggable by touch or mouse, stay within the viewport, and keep its position across page loads on the same device. While a report is minimized, the button SHALL be shown as the minimized-report bubble, visibly distinct and labelled as continuing the report, even when the app passed `button: false`.

#### Scenario: Tap button
- **WHEN** the user taps the floating button
- **THEN** the report window opens

#### Scenario: Drag button
- **WHEN** the user drags the button to the left edge and reloads the page
- **THEN** the button appears at the left edge again

#### Scenario: Hidden button
- **WHEN** the app calls `nooted.init({ button: false })`
- **THEN** no floating button is shown and the other triggers still work

#### Scenario: Bubble with hidden button
- **WHEN** the app called `nooted.init({ button: false })`, opened the window with `nooted.open()` and the user minimized it
- **THEN** the bubble is shown, and after the report is sent or cancelled no button is shown

#### Scenario: Drag the bubble
- **WHEN** the user drags the minimized-report bubble out of the way
- **THEN** it moves without restoring the window

# Spec Delta

## MODIFIED Requirements

### Requirement: Shake trigger
On devices that report motion, the SDK SHALL open the report window when it detects a deliberate shake: at least 3 acceleration peaks above the threshold within 1 second. After a shake fires, further shakes SHALL be ignored for 2 seconds. The shake trigger SHALL work regardless of sign-in state.

#### Scenario: Shake
- **WHEN** the user shakes the phone firmly 3 times within a second
- **THEN** the report window opens

#### Scenario: Normal movement
- **WHEN** the user walks while scrolling the page
- **THEN** no report window opens

#### Scenario: Not signed in
- **WHEN** a user without an upload token shakes the phone
- **THEN** the report window opens, showing the sign-in button

### Requirement: Keyboard shortcut
While Nooted is enabled, pressing Ctrl+Shift+. (or Cmd+Shift+. on macOS) SHALL trigger a report. The shortcut SHALL be ignored when no report window can open (e.g. one is already open).

#### Scenario: Desktop shortcut
- **WHEN** a desktop user presses Ctrl+Shift+.
- **THEN** the report window opens

### Requirement: Floating button
While Nooted is enabled, the SDK SHALL show a small floating button unless the app passed `button: false` to `init`. Tapping it SHALL trigger a report. The button SHALL be draggable by touch or mouse, stay within the viewport, and keep its position across page loads on the same device.

#### Scenario: Tap button
- **WHEN** the user taps the floating button
- **THEN** the report window opens

#### Scenario: Drag button
- **WHEN** the user drags the button to the left edge and reloads the page
- **THEN** the button appears at the left edge again

#### Scenario: Hidden button
- **WHEN** the app calls `nooted.init({ button: false })`
- **THEN** no floating button is shown and the other triggers still work

### Requirement: Programmatic trigger
`nooted.open()` SHALL trigger a report in the same way as the other triggers.

#### Scenario: App menu item
- **WHEN** the app calls `nooted.open()` from a "Report a problem" menu item
- **THEN** the report window opens

# Spec Delta

## Purpose

Lets the person writing a change request show what they mean on the live page: mark the elements they're talking about, optionally demonstrate a short interaction, and attach that to the note as a capture.

## ADDED Requirements

### Requirement: Capture mode
Choosing "Add capture" in the report window SHALL hide the report window and the floating button and show a capture bar. The bar SHALL offer Done, Cancel and "Record demo". Triggers that would open the report window SHALL be ignored while capture mode is active.

#### Scenario: Enter capture mode
- **WHEN** the user taps "Add capture"
- **THEN** the report window and floating button are hidden and the capture bar is shown

#### Scenario: Cancel
- **WHEN** the user taps Cancel in the capture bar
- **THEN** the report window returns unchanged and no capture is added

### Requirement: Marking elements
While marking, tapping or clicking an element on the page SHALL toggle a visible highlight on it instead of activating it. On devices with a mouse, the element under the pointer SHALL be outlined before clicking. The page SHALL stay scrollable while marking.

#### Scenario: Mark a button
- **WHEN** the user taps the page's "Checkout" button while marking
- **THEN** the button is highlighted and the app's click handler does not run

#### Scenario: Unmark
- **WHEN** the user taps a highlighted element again
- **THEN** its highlight is removed

#### Scenario: Scroll while marking
- **WHEN** the user scrolls the page while marking
- **THEN** the page scrolls and existing highlights stay on their elements

### Requirement: Demo clip
"Record demo" SHALL let the user use the page normally while the SDK records it. Stopping the demo SHALL return to marking on the page's current state. A demo SHALL stop automatically after 60 seconds.

#### Scenario: Show an interaction
- **WHEN** the user taps "Record demo", opens a menu on the page, taps Stop, marks the open menu and taps Done
- **THEN** the capture contains a clip from the start of the demo to Done, with the menu marked in its final frame

#### Scenario: Time limit
- **WHEN** a demo has been recording for 60 seconds
- **THEN** recording stops and the user is back in marking mode

### Requirement: Capture content
A capture SHALL contain a full snapshot of the page when Done was tapped, preceded by the demo's events if one was recorded. It SHALL also contain the page URL, viewport size, scroll position and capture time, and a description of each marked element. Masking, privacy markers and the exclusion of Nooted's own UI SHALL apply as for any recording.

#### Scenario: Snapshot only
- **WHEN** the user marks two elements and taps Done without recording a demo
- **THEN** the capture holds one full snapshot of the page and two element descriptions

#### Scenario: Masked input in capture
- **WHEN** an email typed into a default field is visible when the capture is taken
- **THEN** the capture shows `*` characters in that field

### Requirement: Element descriptions
Each marked element SHALL be described by its tag name, role and accessible name when present, a text excerpt of at most 200 characters, a CSS selector that locates it on the page, its bounding box in page coordinates, and its node id in the capture's snapshot. Text of masked, blocked or input elements SHALL NOT appear in the description.

#### Scenario: Button description
- **WHEN** the user marks a `<button>Checkout</button>`
- **THEN** its description has tag `button`, role `button`, name and text "Checkout", a selector matching it, and its bounding box

#### Scenario: Masked text not leaked
- **WHEN** the user marks a `<span data-nooted="mask">` containing an account number
- **THEN** its description contains no part of the account number

### Requirement: Errors in demos
While a demo is recording, uncaught errors and unhandled promise rejections SHALL be added to the clip as `nooted:error` custom events with the message, stack (if any), source location (if any) and time. Outside demos, the SDK SHALL NOT listen for errors.

#### Scenario: Error during demo
- **WHEN** a click handler throws while a demo is recording
- **THEN** the clip contains a `nooted:error` event with that message

#### Scenario: No demo running
- **WHEN** the page throws an error while no demo is recording
- **THEN** nothing about it is stored or sent

### Requirement: Capture limit
A report SHALL hold at most 10 captures. When it holds 10, "Add capture" SHALL be disabled with a short explanation.

#### Scenario: Eleventh capture
- **WHEN** a report already has 10 captures
- **THEN** "Add capture" is disabled and says the limit is reached

### Requirement: Capture preview
Each capture card in the report window SHALL show the capture's final frame scaled to fit, with its marked elements highlighted, when the replay player can be loaded. The replay player SHALL be fetched only once a report has a capture. If it can't load, the card SHALL show the element summary only, and sending SHALL still work.

#### Scenario: Card with preview
- **WHEN** the user returns from capture mode with a capture
- **THEN** its card shows a scaled image of the captured page with the marked elements highlighted

#### Scenario: Player unavailable
- **WHEN** the replay player fails to load
- **THEN** the card lists the marked elements by name, and the report can still be sent

#### Scenario: No captures, no player
- **WHEN** a user writes and sends a report without captures
- **THEN** the replay player is never requested

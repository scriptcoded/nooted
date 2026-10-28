# sdk-captures Specification

## Purpose
Lets the person writing a change request show what they mean on the live page: point at the elements they're talking about, or record a short demonstration, and attach that to the note as a capture.

## Requirements

### Requirement: Separate capture actions
The report window SHALL offer two separate capture actions: "Point" (mark elements on the page as it is) and "Record" (record a short demonstration). Starting either SHALL hide the report window and the floating button and show a bar for that action only. Triggers that would open the report window SHALL be ignored while a capture is in progress.

#### Scenario: Point
- **WHEN** the user taps "Point"
- **THEN** the report window and floating button are hidden and a bar asks the user to tap the parts of the page they mean

#### Scenario: Record
- **WHEN** the user taps "Record"
- **THEN** the report window and floating button are hidden, recording starts, and a bar shows the elapsed time

### Requirement: Cancelling a capture
Cancel in either bar, or Escape, SHALL end the capture without adding anything and return to the report window unchanged.

#### Scenario: Cancel pointing
- **WHEN** the user marks two elements and taps Cancel
- **THEN** the report window returns, no capture is added, and the page is no longer intercepted

#### Scenario: Escape while recording
- **WHEN** the user presses Escape while recording
- **THEN** recording stops, nothing is added and the report window returns

### Requirement: Marking elements
While pointing, tapping or clicking an element on the page SHALL toggle a visible selection on it instead of activating it, and the bar SHALL show how many are selected. On devices with a mouse, the element under the pointer SHALL be outlined before clicking. The page SHALL stay scrollable.

#### Scenario: Mark a button
- **WHEN** the user taps the page's "Add to cart" button while pointing
- **THEN** the button is shown as selected, the bar says "1 selected", and the app's click handler does not run

#### Scenario: Unmark
- **WHEN** the user taps a selected element again
- **THEN** it is no longer selected

#### Scenario: Scroll while pointing
- **WHEN** the user scrolls the page while pointing
- **THEN** the page scrolls and existing selections stay on their elements

### Requirement: Point capture
Done in the pointing bar SHALL add a capture holding a full snapshot of the page at that moment and a description of each selected element. Done with nothing selected SHALL add a capture of the page without element descriptions.

#### Scenario: Two elements
- **WHEN** the user selects two elements and taps Done
- **THEN** a capture is added with one full snapshot and two element descriptions

#### Scenario: Whole page
- **WHEN** the user taps Done without selecting anything
- **THEN** a capture of the page is added with no element descriptions

### Requirement: Recording
While recording, the page SHALL work normally. Stop SHALL add a capture holding the recorded clip, ending with a full snapshot of the page at Stop. Recording SHALL stop and add the capture automatically after 60 seconds.

#### Scenario: Show an interaction
- **WHEN** the user taps "Record", opens a menu on the page and taps Stop
- **THEN** a recording capture is added whose clip starts before the menu opened and ends with the menu open

#### Scenario: Time limit
- **WHEN** a recording reaches 60 seconds
- **THEN** recording stops, the capture is added and the report window returns

### Requirement: Capture content
Every capture SHALL contain rrweb events starting with a full snapshot and ending with a full snapshot of the final state, the page URL, viewport size, scroll position and capture time. Masking, privacy markers and the exclusion of Nooted's own UI SHALL apply as for any recording.

#### Scenario: Masked input in capture
- **WHEN** an email typed into a default field is visible when a capture is taken
- **THEN** the capture shows `*` characters in that field

### Requirement: Element descriptions
Each selected element SHALL be described by its tag name, role and accessible name when present, a text excerpt of at most 200 characters, a CSS selector that locates it on the page, its bounding box in page coordinates, and its node id in the capture's last snapshot. Text of masked, blocked or input elements SHALL NOT appear in the description.

#### Scenario: Button description
- **WHEN** the user selects a `<button>Checkout</button>`
- **THEN** its description has tag `button`, role `button`, name and text "Checkout", a selector matching it, and its bounding box

#### Scenario: Masked text not leaked
- **WHEN** the user selects a `<span data-nooted="mask">` containing an account number
- **THEN** its description contains no part of the account number

### Requirement: Errors in recordings
While recording, uncaught errors and unhandled promise rejections SHALL be added to the clip as `nooted:error` custom events with the message, stack (if any), source location (if any) and time. Otherwise the SDK SHALL NOT listen for errors.

#### Scenario: Error during recording
- **WHEN** a click handler throws while recording
- **THEN** the clip contains a `nooted:error` event with that message

#### Scenario: Not recording
- **WHEN** the page throws an error while nothing is being recorded
- **THEN** nothing about it is stored or sent

### Requirement: Capture limit
A report SHALL hold at most 10 captures. When it holds 10, "Point" and "Record" SHALL be disabled with a short explanation.

#### Scenario: Eleventh capture
- **WHEN** a report already has 10 captures
- **THEN** "Point" and "Record" are disabled and the window says the limit is reached

### Requirement: Capture preview
Each capture in the report window SHALL show a thumbnail of its final frame when the replay player can be loaded. A point capture's thumbnail SHALL be framed around its selected elements, with them highlighted, and a recording's SHALL show its duration. Tapping a thumbnail SHALL open a larger view, and a recording SHALL play there. The replay player SHALL be fetched only once a report has a capture. If it can't load, captures SHALL be listed without thumbnails and sending SHALL still work.

#### Scenario: Thumbnail of a point capture
- **WHEN** the user returns from pointing with one selected button
- **THEN** the capture's thumbnail shows the area around that button with it highlighted

#### Scenario: Player unavailable
- **WHEN** the replay player fails to load
- **THEN** each capture is listed by its selected elements or as a recording, and the report can still be sent

#### Scenario: No captures, no player
- **WHEN** a user writes and sends a report without captures
- **THEN** the replay player is never requested

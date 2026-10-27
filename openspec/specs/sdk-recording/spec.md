# sdk-recording Specification

## Purpose

Keeps a privacy-respecting rolling recording of the last moments on the page, so that a report captures what happened just before the user asked for help, including crashes.

## Requirements

### Requirement: Rolling buffer
While Nooted is enabled, the SDK SHALL record the page with rrweb and keep only the current and previous checkout segments, starting a new segment every 30 seconds. The buffer therefore always covers at least the last 30 seconds (or everything since load, if shorter) and at most about 60 seconds.

#### Scenario: Long session
- **WHEN** a page has been open for 10 minutes
- **THEN** the buffer holds only events from the last two segments, and its first event is a full snapshot

#### Scenario: Short session
- **WHEN** a trigger fires 5 seconds after load
- **THEN** the buffer contains everything since recording started

### Requirement: Single buffer module
All rrweb events SHALL pass through one internal buffer module that owns segmenting and freezing. No other module SHALL read rrweb events directly.

#### Scenario: Buffer is the only consumer
- **WHEN** the recorder emits an event
- **THEN** it is delivered only to the buffer module, which other modules query for frozen copies

### Requirement: Freeze on trigger
When a trigger fires, the SDK SHALL take an immutable copy of the buffer and record the trigger time as the capture time. Recording SHALL continue, but later events SHALL NOT change the frozen copy.

#### Scenario: Time spent signing in
- **WHEN** a user shakes the phone, then spends 2 minutes signing in and typing a note
- **THEN** the uploaded events still end at the shake, and `capturedAt` is the shake time

#### Scenario: Second trigger while open
- **WHEN** a trigger fires while the report window is already open
- **THEN** the existing frozen copy is kept and no new freeze happens

### Requirement: Input masking
All input, textarea and select values SHALL be masked in the recording, except inside an element marked `data-nooted="show"`. Password fields SHALL always be masked, even inside `data-nooted="show"`.

#### Scenario: Default masking
- **WHEN** a user types an email into a form field
- **THEN** the recording contains `*` characters in its place

#### Scenario: Opt-out
- **WHEN** a search field is inside `<div data-nooted="show">`
- **THEN** its typed value is recorded

#### Scenario: Password inside show
- **WHEN** a password field is inside `data-nooted="show"`
- **THEN** its value is still masked

### Requirement: Privacy markers
Elements marked `data-nooted="block"` SHALL be recorded only as empty placeholders of the same size. Text inside `data-nooted="mask"` SHALL be replaced with `*` characters.

#### Scenario: Blocked element
- **WHEN** a credit card widget is marked `data-nooted="block"`
- **THEN** the recording contains a same-sized placeholder and none of its content

#### Scenario: Masked text
- **WHEN** an account number is shown in `<span data-nooted="mask">`
- **THEN** the recording contains `*` characters in its place

### Requirement: Nooted UI is excluded
Nooted's own elements (the floating button and report window) SHALL NOT appear in recordings with their content.

#### Scenario: Floating button
- **WHEN** the floating button is visible during recording
- **THEN** the recording contains at most a placeholder where it sits, with no Nooted markup or text

### Requirement: Errors in the timeline
The SDK SHALL add a custom timeline event for each uncaught error and unhandled promise rejection, with the message, the stack (if any), the source location (if any) and the time. Rejection reasons that are not errors SHALL be converted to a string of at most 1,000 characters.

#### Scenario: Uncaught error
- **WHEN** a click handler throws `TypeError: x is undefined`
- **THEN** the buffer contains a `nooted:error` custom event with that message and stack

#### Scenario: Rejection with a plain value
- **WHEN** a promise rejects with `{ code: 42 }`
- **THEN** the buffer contains a `nooted:error` event whose message is the stringified value

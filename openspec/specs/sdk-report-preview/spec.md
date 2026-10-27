# sdk-report-preview Specification

## Purpose

Lets the person sending a report see what it contains before it leaves the device, mark the part of the recording that matters, and choose to send the note without a screen recording.

## Requirements

### Requirement: Review view
When the recording is included, the note form SHALL offer a "Review recording" button that opens a separate review view within the report window, holding the preview and the focus timeline. The form SHALL show a one-line summary of the selection ("Whole recording" or the highlighted range). "Done" and Escape in the review view SHALL return to the form with the note unchanged; Escape SHALL NOT close the report window from the review view.

#### Scenario: Open and return
- **WHEN** the user taps "Review recording", highlights 12–20 s and taps "Done"
- **THEN** the form is shown again with the note intact and a summary saying 0:12–0:20 is highlighted

#### Scenario: Escape in review
- **WHEN** the user presses Escape in the review view
- **THEN** the form is shown again and the report window stays open

#### Scenario: Reset
- **WHEN** the user taps "Reset" in the review view
- **THEN** the handles return to the ends and the summary says "Whole recording"

### Requirement: Recording preview
The review view SHALL offer a preview that replays the frozen recording inside the window. The preview SHALL show the recording as it will be uploaded, with the same masking and blocked placeholders. It SHALL NOT run the page's scripts or send network requests on behalf of the recorded page.

#### Scenario: Watch before sending
- **WHEN** the user opens the preview after a trigger
- **THEN** the window plays back the frozen recording, ending at the trigger time

#### Scenario: Masking visible in preview
- **WHEN** the recording contains a typed email in a default (masked) field
- **THEN** the preview shows `*` characters in that field, not the email

#### Scenario: Small phone
- **WHEN** the preview is shown in a 320 px wide viewport
- **THEN** the replay is scaled to fit the window without horizontal scrolling

### Requirement: Preview loaded on demand
The replay player SHALL be fetched from the Nooted server only when a preview is first shown, never on page load. Page views where nobody opens a preview SHALL NOT fetch it.

#### Scenario: No preview opened
- **WHEN** a page with Nooted enabled is used and the report window is never opened
- **THEN** no request for the replay player is made

#### Scenario: Nonce-based CSP
- **WHEN** the SDK runs on a page whose CSP allows scripts only by nonce and the user opens the preview
- **THEN** the replay player loads using the same nonce and the preview plays

### Requirement: Preview failure does not block sending
If the replay player cannot be loaded or the preview cannot be rendered correctly, the window SHALL show a short explanation in place of the preview. The note form, the focus timeline and Send SHALL keep working.

#### Scenario: Player unavailable
- **WHEN** the replay player fails to load
- **THEN** the window says the preview is unavailable, and the report can still be sent with or without a focus range

#### Scenario: Styles blocked by the site's CSP
- **WHEN** the host page's CSP blocks inline styles and the preview's styling is rejected
- **THEN** the window says the preview may look unstyled because of the site's security policy, and sending still works

### Requirement: Focus range
The review view SHALL show a timeline of the recording with a start handle and an end handle, initially at the beginning and end. Moving them selects a focus range. Each handle SHALL be operable by touch, mouse and keyboard, and the start SHALL stay before the end.

#### Scenario: Pick the important part
- **WHEN** the user drags the start handle to 12 s and the end handle to 20 s of a 40 s recording
- **THEN** the selected range is shown on the timeline and the preview can play that range

#### Scenario: Keyboard
- **WHEN** a handle has focus and the user presses the arrow keys
- **THEN** the handle moves in small steps and its position is announced to assistive technology

### Requirement: Focus is metadata
The uploaded report SHALL always contain the full frozen recording. When the user narrowed the range, the report SHALL include the focus as start and end timestamps within the recording. When the handles are left at the ends, the report SHALL NOT include a focus.

#### Scenario: Focus sent
- **WHEN** the user narrows the range and sends the report
- **THEN** the report contains every frozen event and a focus whose start and end match the chosen timestamps

#### Scenario: No focus
- **WHEN** the user sends without moving the handles
- **THEN** the report has no focus

### Requirement: Error markers
The timeline SHALL mark the times of captured errors, so the user can place the focus around them.

#### Scenario: Error on timeline
- **WHEN** the frozen recording contains a captured error at 25 s
- **THEN** the timeline shows a marker at 25 s

### Requirement: Include recording toggle
The note form SHALL have an "Include recording" option, on by default for every new report. Turning it off SHALL hide the "Review recording" button and the selection summary. Turning it back on SHALL restore them with the previous focus.

#### Scenario: Default on
- **WHEN** the report window opens after a trigger
- **THEN** "Include recording" is on

#### Scenario: Turn off
- **WHEN** the user turns "Include recording" off
- **THEN** the "Review recording" button and the selection summary are hidden

### Requirement: Report without recording
When the recording is excluded, the uploaded report SHALL mark the recording as omitted. Its events SHALL contain only the captured error events from the frozen buffer, which may be none. It SHALL contain no focus. The note, URL at trigger time, capture time, device information and release SHALL be sent as usual.

#### Scenario: Send without recording
- **WHEN** the user turns off "Include recording" and sends a report from a page where an error was captured
- **THEN** the report is marked as having no recording and its events are only that error event

#### Scenario: Nothing captured
- **WHEN** the user sends without recording and no error was captured
- **THEN** the report is marked as having no recording and has an empty event list

### Requirement: Choices kept across retries
Changing the focus or the recording choice before a re-send (for example after signing in again) SHALL keep the report's client report id. The uploaded report SHALL reflect the choices at the time of the latest send.

#### Scenario: Re-send after sign-in with a new choice
- **WHEN** a send is rejected because the token expired, the user turns off "Include recording", signs in and sends again
- **THEN** the second upload uses the same client report id and contains no recording

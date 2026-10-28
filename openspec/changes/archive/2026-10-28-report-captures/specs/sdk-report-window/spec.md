# Spec Delta

## MODIFIED Requirements

### Requirement: Note form
The report window SHALL be titled "Request a change" and have a multiline note field labelled "What should change?" (required, at most 10,000 characters), the "Point" and "Record" capture actions, the list of captures, Send and Cancel. Finishing a capture SHALL insert a token `[n]` at the cursor position the note had when the capture started. Removing a capture SHALL remove its tokens. Send SHALL be disabled while the note is empty. Cancel SHALL close the window and discard the note and captures.

#### Scenario: Empty note
- **WHEN** the note is empty or whitespace
- **THEN** Send is disabled

#### Scenario: Cancel
- **WHEN** the user taps Cancel
- **THEN** the window closes and no report is sent or queued

#### Scenario: Inline capture
- **WHEN** the user types "If I click ", taps "Point", selects a button, taps Done and types "I want a confirmation"
- **THEN** the note reads "If I click [1] I want a confirmation" and capture 1 is listed below it

#### Scenario: Remove capture
- **WHEN** the user removes capture 1 from a note containing "[1]"
- **THEN** the capture is gone, "[1]" is removed from the note, and later captures keep their numbers

#### Scenario: Note kept during capture
- **WHEN** the user starts a capture and returns with Done, Stop or Cancel
- **THEN** the note text is unchanged apart from any inserted token

#### Scenario: Unknown token
- **WHEN** the note contains "[2]" and the report has no capture 2
- **THEN** Send is disabled and the window explains that [2] has no capture

### Requirement: Send outcome
After Send, the window SHALL show a short confirmation and close when the report was uploaded, or say the report was saved and will be sent later when it was queued. If the token was rejected, it SHALL switch to the sign-in state, keeping the note and captures.

#### Scenario: Uploaded
- **WHEN** the upload succeeds
- **THEN** the window shows "Sent" and closes

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the window says the report is saved and will be sent automatically, and closes

#### Scenario: Token expired
- **WHEN** the server answers 401
- **THEN** the window shows the sign-in button, and after signing in, Send uploads the same note and captures

## REMOVED Requirements

### Requirement: Turn off
**Reason**: Nothing in the UI told users how to turn Nooted back on, so the action was a trap.
**Migration**: The host app turns Nooted off with `nooted.disable()` ("Enabling from the app" in `sdk-loader`).

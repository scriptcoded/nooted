# Spec Delta

## MODIFIED Requirements

### Requirement: Note form
The form SHALL have a multiline note field (required, at most 10,000 characters), "Add capture", the list of captures, Send and Cancel. "Add capture" SHALL insert a token `[n]` at the cursor, where n is the new capture's number, once the capture is taken. Removing a capture SHALL remove its tokens. Send SHALL be disabled while the note is empty. Cancel SHALL close the window and discard the note and captures.

#### Scenario: Empty note
- **WHEN** the note is empty or whitespace
- **THEN** Send is disabled

#### Scenario: Cancel
- **WHEN** the user taps Cancel
- **THEN** the window closes and no report is sent or queued

#### Scenario: Inline capture
- **WHEN** the user types "If I click ", taps "Add capture", marks a button, taps Done and types " I want a confirmation"
- **THEN** the note reads "If I click [1] I want a confirmation" and capture 1 is listed below it

#### Scenario: Remove capture
- **WHEN** the user removes capture 1 from a note containing "[1]"
- **THEN** the capture is gone, "[1]" is removed from the note, and later captures keep their numbers

#### Scenario: Note kept during capture
- **WHEN** the user enters capture mode and returns with Done or Cancel
- **THEN** the note text is unchanged apart from any inserted token

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

### Requirement: Turn off
The report window SHALL offer "Turn off Nooted on this device", which clears the enabled flag, stops any capture in progress, and removes Nooted's UI from the page.

#### Scenario: Turn off
- **WHEN** the user chooses "Turn off Nooted on this device"
- **THEN** the floating button disappears, nothing is recorded, and later page loads do not load the SDK

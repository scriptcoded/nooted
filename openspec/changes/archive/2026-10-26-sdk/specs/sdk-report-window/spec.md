# Spec Delta

## Purpose

The in-page window where the user signs in to Nooted and writes the note for a report. It is isolated from the host app so the app can neither break it nor be broken by it.

## ADDED Requirements

### Requirement: Isolated mount
The SDK SHALL render its UI inside a shadow root attached to a host element appended to `<body>`. Host app styles SHALL NOT affect it. If the app removes the host element, the SDK SHALL re-attach it.

#### Scenario: App styles
- **WHEN** the host app has global CSS such as `button { display: none }`
- **THEN** Nooted's buttons are still visible

#### Scenario: Framework replaces body content
- **WHEN** the app's framework replaces everything inside `<body>` after an error
- **THEN** Nooted's host element is re-attached and the floating button is visible again

### Requirement: Sign-in state
When the report window opens without a valid upload token for the project, it SHALL show a "Sign in to Nooted" button in place of the form. A token is valid if it is stored for this tab and project and has not expired.

#### Scenario: No token
- **WHEN** the window opens in a tab that has never signed in
- **THEN** it shows the sign-in button and no note form

#### Scenario: Valid token
- **WHEN** the window opens with an unexpired token stored for this tab
- **THEN** the note form is shown directly

### Requirement: Sign-in flow
Tapping "Sign in to Nooted" SHALL open the Nooted sign-in window synchronously within the tap handler, so popup blockers allow it. The SDK SHALL accept messages only from the Nooted origin and only from the window it opened. On `nooted:token` it SHALL store the token in `sessionStorage` and show the form. On `nooted:sign-in-error` it SHALL show the reason. The frozen buffer SHALL be kept throughout.

#### Scenario: Successful sign-in
- **WHEN** the user signs in through the popup
- **THEN** the popup closes, the form appears, and the frozen buffer from the original trigger is still the one that will be sent

#### Scenario: Popup blocked
- **WHEN** the browser blocks the popup
- **THEN** the window shows a message asking the user to allow popups for this site

#### Scenario: Not a member
- **WHEN** the popup reports `not_member`
- **THEN** the window explains that the user is not a member of this project

#### Scenario: Foreign message
- **WHEN** another frame posts `{ type: 'nooted:token' }` to the page
- **THEN** the SDK ignores it

### Requirement: Note form
The form SHALL have a multiline note field (required, at most 10,000 characters), Send and Cancel. Send SHALL be disabled while the note is empty. Cancel SHALL close the window and discard the frozen buffer.

#### Scenario: Empty note
- **WHEN** the note is empty or whitespace
- **THEN** Send is disabled

#### Scenario: Cancel
- **WHEN** the user taps Cancel
- **THEN** the window closes and no report is sent or queued

### Requirement: Voice input
Where the browser supports the Web Speech API, the form SHALL show a microphone button. While it is active, recognized speech SHALL be appended to the note. Where it is not supported, no microphone button SHALL be shown.

#### Scenario: Dictate
- **WHEN** a Chrome on Android user taps the microphone and speaks
- **THEN** the transcript is appended to the note

#### Scenario: Unsupported browser
- **WHEN** the window opens in a browser without `SpeechRecognition`
- **THEN** no microphone button is shown

### Requirement: Send outcome
After Send, the window SHALL show a short confirmation and close when the report was uploaded, or say the report was saved and will be sent later when it was queued. If the token was rejected, it SHALL switch to the sign-in state, keeping the note and frozen buffer.

#### Scenario: Uploaded
- **WHEN** the upload succeeds
- **THEN** the window shows "Sent" and closes

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the window says the report is saved and will be sent automatically, and closes

#### Scenario: Token expired
- **WHEN** the server answers 401
- **THEN** the window shows the sign-in button, and after signing in, Send uploads the same note and buffer

### Requirement: Turn off
The report window SHALL offer "Turn off Nooted on this device", which clears the enabled flag, stops recording, and removes Nooted's UI from the page.

#### Scenario: Turn off
- **WHEN** the user chooses "Turn off Nooted on this device"
- **THEN** the floating button disappears, recording stops, and later page loads do not load the SDK

### Requirement: Usable on phones and with a keyboard
The window SHALL fit in a 320 px wide viewport without horizontal scrolling. It SHALL move focus into itself when it opens and return focus when it closes. Escape SHALL close it.

#### Scenario: Small phone
- **WHEN** the window opens on a 320 px wide viewport
- **THEN** all controls are visible and usable without horizontal scrolling

#### Scenario: Escape
- **WHEN** a desktop user presses Escape in the window
- **THEN** it closes as with Cancel

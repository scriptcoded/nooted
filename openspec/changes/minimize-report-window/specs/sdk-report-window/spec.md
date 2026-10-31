# Spec Delta

## ADDED Requirements

### Requirement: Minimize to a bubble
Tapping or clicking outside the report window SHALL minimize it: the window and backdrop are hidden and a draggable bubble is shown, while the note, captures and caret position are kept in memory. A press that starts or ends inside the window SHALL NOT minimize it. The window SHALL NOT minimize while a report is being sent. While minimized, the page SHALL be fully usable. The draft is not required to survive a full page load.

#### Scenario: Tap outside
- **WHEN** the user has typed a note and added one capture, then taps the dimmed area outside the window
- **THEN** the window is hidden, a bubble is shown, and the page responds to taps again

#### Scenario: Navigate and come back
- **WHEN** the user minimizes the window, follows an in-app link to another route and taps the bubble
- **THEN** the window returns with the same note and captures, and the caret where it was

#### Scenario: Add a screenshot on another page
- **WHEN** the user minimizes, navigates to another route, restores the window and takes a screenshot
- **THEN** the new capture is numbered after the existing ones and records the new page's URL

#### Scenario: Drag ending outside
- **WHEN** the user starts selecting text in the note and releases the pointer over the backdrop
- **THEN** the window stays open

#### Scenario: While sending
- **WHEN** the user taps outside the window while "Sending…" is shown
- **THEN** the window stays open

#### Scenario: Full reload
- **WHEN** the window is minimized and the page is reloaded
- **THEN** the draft is gone and the floating button shows in its normal state

### Requirement: Restoring a minimized report
Tapping the bubble SHALL restore the report window with the kept draft and move focus into it. Cancel or Send in the restored window SHALL behave as for a window that was never minimized.

#### Scenario: Restore and cancel
- **WHEN** the user restores a minimized report and taps Cancel
- **THEN** the window closes, the draft is discarded and the normal floating button is shown

#### Scenario: Escape while minimized
- **WHEN** the report is minimized and the user presses Escape
- **THEN** nothing happens and the draft is kept

## MODIFIED Requirements

### Requirement: Note form
The report window SHALL be titled "Request a change" and have a multiline note field labelled "What should change?" (required, at most 10,000 characters), the "Screenshot" and "Record" capture actions, the list of captures, Send and Cancel. Finishing a capture SHALL insert a token `[n]` at the cursor position the note had when the capture started. Removing a capture SHALL remove its tokens. Send SHALL be disabled while the note is empty. Cancel SHALL close the window and discard the note and captures.

#### Scenario: Empty note
- **WHEN** the note is empty or whitespace
- **THEN** Send is disabled

#### Scenario: Cancel
- **WHEN** the user taps Cancel
- **THEN** the window closes and no report is sent or queued

#### Scenario: Inline capture
- **WHEN** the user types "If I click ", taps "Screenshot", selects a button, taps Done and types "I want a confirmation"
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

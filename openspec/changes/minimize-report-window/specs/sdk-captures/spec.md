# Spec Delta

## ADDED Requirements

### Requirement: Screenshot and Record actions
The report window SHALL offer two separate capture actions: "Screenshot" (capture the page as it is, marking the elements meant) and "Record" (record a short demonstration). Starting either SHALL hide the report window and the floating button and show a bar for that action only. Triggers that would open the report window SHALL be ignored while a capture is in progress.

#### Scenario: Screenshot
- **WHEN** the user taps "Screenshot"
- **THEN** the report window and floating button are hidden and a bar asks the user to tap the parts of the page they mean

#### Scenario: Record
- **WHEN** the user taps "Record"
- **THEN** the report window and floating button are hidden, recording starts, and a bar shows the elapsed time

## REMOVED Requirements

### Requirement: Separate capture actions
**Reason**: The "Point" action is renamed "Screenshot".
**Migration**: Replaced by "Screenshot and Record actions" with the same behavior.


## MODIFIED Requirements

### Requirement: Capture limit
A report SHALL hold at most 10 captures. When it holds 10, "Screenshot" and "Record" SHALL be disabled with a short explanation.

#### Scenario: Eleventh capture
- **WHEN** a report already has 10 captures
- **THEN** "Screenshot" and "Record" are disabled and the window says the limit is reached

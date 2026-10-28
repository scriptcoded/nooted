# Spec Delta

## MODIFIED Requirements

### Requirement: Raw report storage
The system SHALL store each accepted report's raw payload unchanged, linked to its feedback item, so that digests can be built or rebuilt from it later. The raw payload as a whole SHALL NOT be exposed through the console API; the item detail and capture endpoints of `feedback-detail` MAY serve parts of it (metadata and captures) to project members.

#### Scenario: Raw data kept
- **WHEN** a report is accepted
- **THEN** its raw payload is stored and can be read back byte for byte by the server

#### Scenario: Raw payload not served
- **WHEN** a member uses the console API
- **THEN** no endpoint returns the stored payload as a whole or the compressed blob

### Requirement: Feedback list
Project members SHALL be able to list a project's feedback items, newest first, with id, note, page URL, reporter, status, creation time and the number of captures.

#### Scenario: Member lists feedback
- **WHEN** a member opens a project's feedback list
- **THEN** they see its items, newest first

#### Scenario: Non-member
- **WHEN** a non-member requests a project's feedback list
- **THEN** the response is 404

#### Scenario: Capture count
- **WHEN** a report with two captures has been accepted
- **THEN** its list entry has a capture count of 2

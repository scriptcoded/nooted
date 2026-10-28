# Spec Delta

## REMOVED Requirements

### Requirement: Report payload
**Reason**: Reports no longer carry a single event list, a focus range or an omitted-recording marker.
**Migration**: Replaced by "Report contents" and "Capture validation" below; send captures instead of `events`.

## ADDED Requirements

### Requirement: Report contents
A report SHALL contain a client-generated report id (UUID), a note (1 to 10,000 characters), the page URL, the report time, the user agent, viewport width, height and device pixel ratio, a list of 0 to 10 captures, and optionally a release identifier. The system SHALL reject invalid payloads with 400 and a description of the problem.

#### Scenario: Empty note
- **WHEN** a report has an empty note
- **THEN** the response is 400 and nothing is stored

#### Scenario: No captures
- **WHEN** a report has a note and an empty capture list
- **THEN** it is accepted and a feedback item is created

#### Scenario: Too many captures
- **WHEN** a report has 11 captures
- **THEN** the response is 400

#### Scenario: Old report format
- **WHEN** a report carries a top-level `events` list instead of captures
- **THEN** the response is 400

### Requirement: Capture validation
Each capture SHALL have a number from 1 to 10 that is unique in the report, a URL, a capture time, the viewport size, the scroll position, rrweb events that include a full snapshot, and 0 to 20 marked-element descriptions. Every `[n]` token in the note SHALL refer to a capture in the report. The system SHALL reject reports that break these rules with 400.

#### Scenario: Token without capture
- **WHEN** the note contains "[3]" and the report has captures 1 and 2
- **THEN** the response is 400

#### Scenario: Duplicate capture number
- **WHEN** two captures in a report both have number 1
- **THEN** the response is 400

#### Scenario: Capture without snapshot
- **WHEN** a capture's events contain no full snapshot
- **THEN** the response is 400

#### Scenario: Unreferenced capture
- **WHEN** a report has captures 1 and 2 and the note only mentions "[1]"
- **THEN** it is accepted

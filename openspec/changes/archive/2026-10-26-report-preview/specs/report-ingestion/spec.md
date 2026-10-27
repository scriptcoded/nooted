# Spec Delta

## MODIFIED Requirements

### Requirement: Report payload
A report SHALL contain a client-generated report id (UUID), a note (1 to 10,000 characters), the page URL, the capture timestamp (the shake time), the user agent, viewport width, height and device pixel ratio, a list of rrweb events, and optionally a release identifier. The event list SHALL be non-empty unless the report marks its recording as omitted. A report MAY carry a focus range (start and end timestamps) and MAY mark its recording as omitted. The system SHALL reject invalid payloads with 400 and a description of the problem.

#### Scenario: Empty note
- **WHEN** a report has an empty note
- **THEN** the response is 400 and nothing is stored

#### Scenario: No events
- **WHEN** a report has an empty event list and does not mark its recording as omitted
- **THEN** the response is 400

#### Scenario: Omitted recording without events
- **WHEN** a report marks its recording as omitted and has an empty event list
- **THEN** it is accepted and a feedback item is created

#### Scenario: Omitted recording with screen data
- **WHEN** a report marks its recording as omitted but its events contain anything other than captured error events
- **THEN** the response is 400 and nothing is stored

#### Scenario: Valid focus
- **WHEN** a report includes a focus whose start is before its end and both lie within the time span of its events
- **THEN** it is accepted and the focus is kept in the stored raw payload

#### Scenario: Invalid focus
- **WHEN** a report includes a focus whose start is not before its end, or that lies outside the time span of its events
- **THEN** the response is 400

#### Scenario: Focus without recording
- **WHEN** a report marks its recording as omitted and includes a focus
- **THEN** the response is 400

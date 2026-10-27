# Spec Delta

## MODIFIED Requirements

### Requirement: Report upload
The SDK SHALL build a report that matches the shared `ReportPayload` schema, using a new client report id per report, the note, the report's captures, the time the report window opened as `capturedAt`, the page URL when the window opened, the device info and the release (if any). It SHALL gzip the report and POST it to `<nooted>/api/sdk/reports` with the upload token as a bearer token.

#### Scenario: Successful upload
- **WHEN** the user sends a note with a valid token while online
- **THEN** the server receives a gzipped body that passes `ReportPayload` validation and answers 201

#### Scenario: URL at trigger time
- **WHEN** the user opens the report window on `/cart` and navigates to `/checkout` during a demo before sending (in a single-page app)
- **THEN** the report's `url` is the `/cart` URL and the capture's URL is the `/checkout` URL

#### Scenario: Report without captures
- **WHEN** the user sends a note without adding captures
- **THEN** the report has an empty capture list and is accepted

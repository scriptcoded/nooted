# report-ingestion Specification

## Purpose

Accepts feedback reports (note, frozen rrweb buffer and capture metadata) from the SDK, stores the raw data safely and turns each report into a feedback item.

## Requirements

### Requirement: Report upload
The system SHALL accept reports at `POST /api/sdk/reports`, authorized by an upload token, with a gzip-compressed JSON body (`Content-Encoding: gzip`). A stored report SHALL produce a new feedback item with status **New**, and the response SHALL be 201 with the item id.

#### Scenario: Successful upload
- **WHEN** the SDK uploads a valid gzipped report with a valid token
- **THEN** the response is 201 with `{ id }` and a feedback item with status New exists in the token's project

#### Scenario: Missing token
- **WHEN** a report is uploaded without an `Authorization: Bearer` token
- **THEN** the response is 401

### Requirement: Report payload
A report SHALL contain a client-generated report id (UUID), a note (1 to 10,000 characters), the page URL, the capture timestamp (the shake time), the user agent, viewport width, height and device pixel ratio, a non-empty list of rrweb events, and optionally a release identifier. The system SHALL reject invalid payloads with 400 and a description of the problem.

#### Scenario: Empty note
- **WHEN** a report has an empty note
- **THEN** the response is 400 and nothing is stored

#### Scenario: No events
- **WHEN** a report has an empty event list
- **THEN** the response is 400

### Requirement: Idempotent retries
The system SHALL treat a report whose client report id was already accepted in the same project as a retry. It SHALL return the existing item id instead of creating a duplicate.

#### Scenario: Retried upload
- **WHEN** the SDK retries an upload that had already succeeded, with the same client report id
- **THEN** the response is 200 with the existing item id and no new item is created

### Requirement: Size limits
The system SHALL reject compressed bodies larger than 10 MB and payloads that decompress to more than 100 MB, with 413. It SHALL stop decompressing as soon as the limit is exceeded.

#### Scenario: Gzip bomb
- **WHEN** a 1 MB body decompresses to more than 100 MB
- **THEN** the response is 413 and decompression stops at the limit

### Requirement: Origin enforcement
SDK endpoints SHALL answer CORS requests only for the token's project's allowed origins. They SHALL reject requests whose `Origin` header is present and not allowed, with 403.

#### Scenario: Allowed origin
- **WHEN** an upload comes from an allowed origin
- **THEN** the response carries `Access-Control-Allow-Origin` set to that origin

#### Scenario: Foreign origin
- **WHEN** an upload with a valid token comes from an origin not in the project's list
- **THEN** the response is 403 and nothing is stored

### Requirement: Raw report storage
The system SHALL store each accepted report's raw payload unchanged, linked to its feedback item, so that digests can be built or rebuilt from it later. The raw payload SHALL NOT be exposed through the console API.

#### Scenario: Raw data kept
- **WHEN** a report is accepted
- **THEN** its raw payload is stored and can be read back byte for byte by the server

### Requirement: Feedback list
Project members SHALL be able to list a project's feedback items, newest first, with id, note, page URL, reporter, status and creation time.

#### Scenario: Member lists feedback
- **WHEN** a member opens a project's feedback list
- **THEN** they see its items, newest first

#### Scenario: Non-member
- **WHEN** a non-member requests a project's feedback list
- **THEN** the response is 404

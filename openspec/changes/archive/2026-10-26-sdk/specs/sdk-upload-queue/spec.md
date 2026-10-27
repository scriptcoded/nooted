# Spec Delta

## Purpose

Delivers reports to the Nooted server reliably from flaky mobile connections: it compresses the report, uploads it with the upload token, and keeps failed uploads on the device until they can be sent.

## ADDED Requirements

### Requirement: Report upload
The SDK SHALL build a report that matches the shared `ReportPayload` schema, using a new client report id per report, the frozen events, the trigger time as `capturedAt`, the page URL at trigger time, the device info and the release (if any). It SHALL gzip the report and POST it to `<nooted>/api/sdk/reports` with the upload token as a bearer token.

#### Scenario: Successful upload
- **WHEN** the user sends a note with a valid token while online
- **THEN** the server receives a gzipped body that passes `ReportPayload` validation and answers 201

#### Scenario: URL at trigger time
- **WHEN** the user shakes on `/cart` and navigates to `/checkout` before sending (in a single-page app)
- **THEN** the report's `url` is the `/cart` URL

### Requirement: Response handling
The SDK SHALL treat 200 and 201 as delivered, 401 as an invalid token, and 400, 403, 413 and 415 as permanent failures. It SHALL treat network errors, 408, 429 and 5xx as temporary failures. Permanent failures SHALL be logged with the `[nooted]` prefix and not retried.

#### Scenario: Retry already accepted
- **WHEN** a retried upload is answered with 200
- **THEN** the report counts as delivered and is removed from the queue

#### Scenario: Permanent failure
- **WHEN** the server answers 413
- **THEN** the report is not queued for retry and a `[nooted]` warning is logged

### Requirement: Persistent queue
Reports that hit a temporary failure, or are sent while the browser is offline, SHALL be stored in IndexedDB as compressed bytes with their client report id and project key. They SHALL be retried with the same client report id. If IndexedDB is unavailable, the queue SHALL live in memory for the page's lifetime.

#### Scenario: Offline then online
- **WHEN** a report is sent offline and the device reconnects
- **THEN** the report is uploaded without user action and removed from the queue

#### Scenario: Reload before retry
- **WHEN** a report is queued and the page is reloaded
- **THEN** the report is still in the queue and is retried after the SDK starts

#### Scenario: No duplicates
- **WHEN** a request reached the server but the response was lost, and the report is retried
- **THEN** the server returns the existing item and no duplicate is created

### Requirement: Retry schedule
The SDK SHALL retry queued reports when it starts, when the browser fires `online`, and on a backoff timer starting at 30 seconds and doubling up to 30 minutes. Only one retry pass SHALL run at a time in a page.

#### Scenario: Backoff
- **WHEN** the server keeps answering 503
- **THEN** retries happen at increasing intervals capped at 30 minutes

### Requirement: Queue and token
Retries SHALL use the tab's current valid token for the report's project. Without a valid token, queued reports SHALL wait and SHALL NOT prompt for sign-in on their own. A 401 during a retry SHALL forget the token and keep the report queued.

#### Scenario: Token expired while queued
- **WHEN** a queued report is retried after the token has expired
- **THEN** the report stays queued and is sent after the user next signs in from the report window

### Requirement: Queue limits and visibility
The queue SHALL hold at most 20 reports, dropping the oldest when full, and SHALL drop reports older than 7 days. While the queue is not empty, the floating button SHALL show the number of pending reports.

#### Scenario: Full queue
- **WHEN** a 21st report is queued
- **THEN** the oldest queued report is dropped with a `[nooted]` warning

#### Scenario: Pending badge
- **WHEN** two reports are waiting in the queue
- **THEN** the floating button shows a badge with "2"

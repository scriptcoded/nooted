# Spec Delta

## Purpose

Lets coding agents work with change requests over MCP: find the projects they may see, list a project's requests, read one as a digest they can act on, and update its status.

## ADDED Requirements

### Requirement: MCP endpoint
The system SHALL serve an MCP server over Streamable HTTP at `/mcp`. Requests SHALL carry a valid access token for that resource (see `mcp-authorization`); without one the response SHALL be 401 with a `WWW-Authenticate` challenge.

#### Scenario: Connect with a token
- **WHEN** an MCP client initializes a session at `/mcp` with a valid access token
- **THEN** the server responds and lists the tools `list_projects`, `list_feedback`, `get_feedback` and `set_feedback_status`

#### Scenario: No token
- **WHEN** a client calls `/mcp` without an access token
- **THEN** the response is 401 with a `WWW-Authenticate` header that points to the protected resource metadata

### Requirement: Project scope
Tools SHALL act only on projects the token's user can see in the console (their projects, or all projects for instance admins), evaluated at call time. Projects and items outside that set SHALL be reported as not found.

#### Scenario: Other project
- **WHEN** an agent calls `get_feedback` for an item in a project its user is not a member of
- **THEN** the tool returns a not-found error and nothing of the item

#### Scenario: Membership removed
- **WHEN** a user is removed from a project after granting an agent access
- **THEN** the agent no longer sees that project or its items

### Requirement: Listing
`list_projects` SHALL return the visible projects with id and name. `list_feedback` SHALL return a project's items newest first with id, status, a note excerpt, page URL, capture count and creation time, optionally filtered by status, at most 50 per call, with a cursor for the next page.

#### Scenario: Filter open items
- **WHEN** an agent calls `list_feedback` with status `new`
- **THEN** only items with status New are returned, newest first

#### Scenario: Paging
- **WHEN** a project has 120 items and the agent follows the returned cursor
- **THEN** it receives all 120 items across three calls without duplicates

### Requirement: Change request digest
`get_feedback` SHALL return a Markdown digest of one item: the note with each `[n]` reference resolved to its capture, the item's status, reporter, page URL, report time, device, release and console link, and for each capture its page URL and viewport. A point capture SHALL list its selected elements with name, role, text and selector, or say it shows the whole page. A recording SHALL give its duration, the page it started and ended on, and the messages of errors captured during it.

#### Scenario: Point capture in the digest
- **WHEN** an item's note says "Make [1] bigger" and capture 1 selected an "Add to cart" button
- **THEN** the digest shows the note and, under capture 1, the element "Add to cart" with role button and its selector

#### Scenario: Recording in the digest
- **WHEN** an item has a 12-second recording during which an error "x is undefined" was captured
- **THEN** the digest describes the recording as 0:12 and lists the error message

#### Scenario: Older report
- **WHEN** the item was stored before captures existed
- **THEN** the digest contains the note and available metadata and says the report has no captures

### Requirement: No raw recording data
MCP responses SHALL NOT contain rrweb events, snapshots or serialized DOM. Text taken from captures SHALL be limited to the element descriptions and error messages already stored with the report.

#### Scenario: Digest content
- **WHEN** an agent reads any item through MCP
- **THEN** the response contains no rrweb event data

### Requirement: Status updates
`set_feedback_status` SHALL set an item's status to one of the defined statuses (see `feedback-status`) and return the updated status. It SHALL require the token to have write access.

#### Scenario: Mark done
- **WHEN** an agent with write access sets an item's status to `done`
- **THEN** the item shows as Done in the console

#### Scenario: Read-only token
- **WHEN** an agent whose token only has read access calls `set_feedback_status`
- **THEN** the call fails with an insufficient-scope error and the status is unchanged

## MODIFIED Requirements

### Requirement: MCP endpoint
The system SHALL serve an MCP server over Streamable HTTP at `/mcp`. Requests SHALL carry a valid access token for that resource (see `mcp-authorization`); without one the response SHALL be 401 with a `WWW-Authenticate` challenge.

#### Scenario: Connect with a token
- **WHEN** an MCP client initializes a session at `/mcp` with a valid access token
- **THEN** the server responds and lists the tools `list_projects`, `list_feedback`, `get_feedback`, `get_capture_frames` and `set_feedback_status`

#### Scenario: No token
- **WHEN** a client calls `/mcp` without an access token
- **THEN** the response is 401 with a `WWW-Authenticate` header that points to the protected resource metadata

### Requirement: Change request digest
`get_feedback` SHALL return a Markdown digest of one item. The digest SHALL contain:
- the note, with each `[n]` reference resolved to its capture;
- the item's status, reporter, page URL, report time, device, release and console link;
- for each capture, its page URL and viewport.

A point capture SHALL list its selected elements with name, role, text and selector, or say it shows the whole page. A recording SHALL give:
- its duration and the page it started and ended on;
- the messages of errors captured during it;
- a timeline of what happened, at most 30 entries, each with its time from the start of the recording. Entries are navigations, clicks and taps (naming the element), typing in a field (naming the field, never the value), checkbox changes, viewport resizes and errors. Consecutive typing in one field SHALL be a single entry.

When capture images are available (see `capture-rendering`), the response SHALL also include one image per capture: its still. Each image SHALL be labelled with its capture number, and at most 4 images SHALL be returned. When there are more captures, the digest SHALL say which ones to fetch with `get_capture_frames`. When images aren't available or a render fails, the digest SHALL say so in one line and the rest of the response SHALL be unaffected.

#### Scenario: Point capture in the digest
- **WHEN** an item's note says "Make [1] bigger" and capture 1 selected an "Add to cart" button
- **THEN** the digest shows the note and, under capture 1, the element "Add to cart" with role button and its selector

#### Scenario: Recording in the digest
- **WHEN** an item has a 12-second recording during which an error "x is undefined" was captured
- **THEN** the digest describes the recording as 0:12 and lists the error message

#### Scenario: Recording timeline
- **WHEN** a recording shows a click on a button "Add to cart", typing in a field labelled "Quantity", then a navigation to /checkout
- **THEN** the digest's timeline lists those three entries with their times, names the button and the field, and contains no typed value

#### Scenario: Images included
- **WHEN** images are available and an item has two captures
- **THEN** `get_feedback` returns the digest followed by two images labelled [1] and [2]

#### Scenario: Images unavailable
- **WHEN** the server cannot render images
- **THEN** `get_feedback` returns the full text digest with a line saying images aren't available on this server

#### Scenario: Older report
- **WHEN** the item was stored before captures existed
- **THEN** the digest contains the note and available metadata and says the report has no captures

### Requirement: No raw recording data
MCP responses SHALL NOT contain rrweb events, snapshots or serialized DOM. Text taken from captures SHALL be limited to:
- the element descriptions and error messages stored with the report;
- short descriptions of the elements named in a recording timeline: name, role, text and selector, each truncated;
- captions of rendered stills.

Images SHALL only be drawings of a capture (see `capture-rendering`).

#### Scenario: Digest content
- **WHEN** an agent reads any item through MCP
- **THEN** the response contains no rrweb event data

## ADDED Requirements

### Requirement: Capture frames tool
`get_capture_frames` SHALL take an item id and a capture number, follow the same project scope as `get_feedback`, and return:
- for a recording: its timeline and its storyboard (see `capture-rendering`), each still labelled with its caption;
- for a point capture: its description and its still.

An unknown capture number SHALL be reported as not found. When images aren't available, the tool SHALL return the text with a line saying so.

#### Scenario: Recording frames
- **WHEN** an agent calls `get_capture_frames` for capture 2 of an item, a recording with a click and a navigation
- **THEN** it receives the timeline and up to 6 captioned stills in time order

#### Scenario: Unknown capture
- **WHEN** an agent asks for capture 7 of an item that has 2 captures
- **THEN** the tool returns a not-found error

#### Scenario: Other project
- **WHEN** an agent asks for frames of an item in a project its user can't see
- **THEN** the tool returns a not-found error and nothing of the item

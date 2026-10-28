# Spec Delta

## Purpose

Lets project members open a feedback item in the console and see what the change request points at: the note with its references, the captured pages with the selected elements, and recordings.

## ADDED Requirements

### Requirement: Item detail page
Each feedback item SHALL have a console page showing its note, reporter, page URL, report time, device and viewport, release (if any), status and its captures. Only project members SHALL be able to open it; for anyone else the page SHALL show a not-found state that reveals nothing about the item.

#### Scenario: Member opens an item
- **WHEN** a member opens a feedback item from the list
- **THEN** the item's note, metadata and captures are shown

#### Scenario: Non-member
- **WHEN** a non-member opens the URL of an item in another project
- **THEN** the page shows a not-found state and nothing of the item, and the item's APIs answer 404

### Requirement: Note references
The note SHALL be shown with each `[n]` token rendered as a reference to capture n. Activating a reference SHALL bring that capture into view and highlight it.

#### Scenario: Jump to a capture
- **WHEN** a member clicks the reference "[2]" in the note
- **THEN** capture 2 is scrolled into view and briefly highlighted

### Requirement: Capture display
Each capture SHALL be listed with its number, a thumbnail of its final frame, its page URL and capture time. A point capture's thumbnail SHALL be framed around its selected elements, which are highlighted, and each selected element SHALL be described by name, role, text excerpt and selector. A recording SHALL show its duration.

#### Scenario: Point capture
- **WHEN** an item has a capture with one selected "Add to cart" button
- **THEN** the capture shows a thumbnail around that button with it highlighted, and lists "Add to cart" with its role and selector

#### Scenario: Whole page
- **WHEN** a point capture has no selected elements
- **THEN** it shows a thumbnail of the page and says "Whole page"

### Requirement: Large view and playback
Activating a capture SHALL open a large view of its final frame with the selected elements highlighted. A recording SHALL be playable there from its start.

#### Scenario: Play a recording
- **WHEN** a member opens a recording capture and presses Play
- **THEN** the recording plays from its start and ends on its final frame

### Requirement: Player loaded on demand
The replay player SHALL be loaded only on pages that show captures, and a capture's events SHALL be fetched only when its thumbnail or large view is shown. If the player or the events cannot be loaded, the capture SHALL still be listed with its descriptions.

#### Scenario: List without player
- **WHEN** a member opens the feedback list
- **THEN** neither the replay player nor any capture events are loaded

#### Scenario: Events unavailable
- **WHEN** a capture's events fail to load
- **THEN** its row shows a placeholder instead of the thumbnail, and its element descriptions are still shown

### Requirement: Item and capture API
The console API SHALL provide, to project members only, an item's detail (note, metadata and capture summaries without events) and, separately, the events of one capture. Both SHALL answer 404 for non-members, unknown items and unknown capture numbers. Responses SHALL be cacheable, since stored reports never change.

#### Scenario: Detail without events
- **WHEN** a member requests an item's detail
- **THEN** the response contains each capture's number, URL, capture time, viewport, scroll, recording flag, duration and selected elements, and no rrweb events

#### Scenario: Capture events
- **WHEN** a member requests the events of capture 2 of an item
- **THEN** the response contains exactly that capture's rrweb events

#### Scenario: Unknown capture
- **WHEN** a member requests capture 5 of an item with two captures
- **THEN** the response is 404

### Requirement: Older reports
Items whose stored report predates captures SHALL still open, showing their note and the metadata that is available, with a notice that the report has no viewable captures.

#### Scenario: Pre-capture report
- **WHEN** a member opens an item stored before captures existed
- **THEN** the note and metadata are shown with a notice, and no error is shown

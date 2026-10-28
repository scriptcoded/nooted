# Spec Delta

## Purpose

Gives each change request a status from a fixed set, so people and agents can track which requests are open, being worked on, done or dismissed.

## ADDED Requirements

### Requirement: Defined statuses
A feedback item's status SHALL be one of New, In progress, Done or Dismissed (`new`, `in_progress`, `done`, `dismissed`). New reports SHALL start as New. The system SHALL reject any other value.

#### Scenario: New report
- **WHEN** a report is accepted
- **THEN** its item has status New

#### Scenario: Unknown status
- **WHEN** a status change to `archived` is requested
- **THEN** it is rejected and the status is unchanged

### Requirement: Change status in the console
Project members SHALL be able to change an item's status from its console page. The list SHALL show each item's status.

#### Scenario: Member changes status
- **WHEN** a member sets an item to In progress on its page
- **THEN** the page and the feedback list show In progress

#### Scenario: Non-member
- **WHEN** a non-member requests a status change for an item
- **THEN** the response is 404 and the status is unchanged

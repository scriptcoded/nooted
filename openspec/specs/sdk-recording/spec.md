# sdk-recording Specification

## Purpose

Defines the privacy rules that apply whenever Nooted records the page, which happens only during a capture: input masking, the `data-nooted` privacy markers, and keeping Nooted's own UI out of recordings.

## Requirements

### Requirement: Input masking
All input, textarea and select values SHALL be masked in the recording, except inside an element marked `data-nooted="show"`. Password fields SHALL always be masked, even inside `data-nooted="show"`.

#### Scenario: Default masking
- **WHEN** a user types an email into a form field
- **THEN** the recording contains `*` characters in its place

#### Scenario: Opt-out
- **WHEN** a search field is inside `<div data-nooted="show">`
- **THEN** its typed value is recorded

#### Scenario: Password inside show
- **WHEN** a password field is inside `data-nooted="show"`
- **THEN** its value is still masked

### Requirement: Privacy markers
Elements marked `data-nooted="block"` SHALL be recorded only as empty placeholders of the same size. Text inside `data-nooted="mask"` SHALL be replaced with `*` characters.

#### Scenario: Blocked element
- **WHEN** a credit card widget is marked `data-nooted="block"`
- **THEN** the recording contains a same-sized placeholder and none of its content

#### Scenario: Masked text
- **WHEN** an account number is shown in `<span data-nooted="mask">`
- **THEN** the recording contains `*` characters in its place

### Requirement: Nooted UI is excluded
Nooted's own elements (the floating button and report window) SHALL NOT appear in recordings with their content.

#### Scenario: Floating button
- **WHEN** the floating button is visible during recording
- **THEN** the recording contains at most a placeholder where it sits, with no Nooted markup or text

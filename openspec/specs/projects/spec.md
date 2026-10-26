# projects Specification

## Purpose

Groups feedback by site. Projects define which origins may send reports, who may report and triage, and how long raw data is kept.

## Requirements

### Requirement: Project creation
The system SHALL let instance admins create projects with a name. Each project SHALL get a unique public key, which the SDK uses to identify the project. The key is not a secret.

#### Scenario: Admin creates a project
- **WHEN** an admin creates a project named "Shop"
- **THEN** the project is stored with a generated public key and returned to the admin

#### Scenario: Non-admin cannot create
- **WHEN** a user who is not an admin tries to create a project
- **THEN** the system responds with 403

### Requirement: Allowed origins
Each project SHALL have a list of allowed origins, each an exact scheme, host and optional port. The system SHALL normalize origins and reject values that are not valid origins.

#### Scenario: Valid origin
- **WHEN** an admin adds `https://shop.example.com/` to a project
- **THEN** it is stored as `https://shop.example.com`

#### Scenario: Invalid origin
- **WHEN** an admin adds `shop.example.com/*`
- **THEN** the system responds with 400 and the list is unchanged

### Requirement: Project membership
Instance admins SHALL be able to add members to a project by email and remove them. A membership for an email with no user yet SHALL take effect when a user with that verified email signs in. Emails SHALL be matched case-insensitively.

#### Scenario: Add existing user
- **WHEN** an admin adds `dev@example.com`, which belongs to an existing user
- **THEN** that user can see the project

#### Scenario: Add before first sign-in
- **WHEN** an admin adds `New@Example.com` and later a user with verified email `new@example.com` signs in for the first time
- **THEN** that user is a member of the project

#### Scenario: Remove member
- **WHEN** an admin removes a member
- **THEN** that user no longer sees the project and their existing upload tokens for it are revoked

### Requirement: Project visibility
The system SHALL show members only their own projects, while admins see all projects. Requests for a project the user cannot see SHALL return 404.

#### Scenario: Member lists projects
- **WHEN** a member of "Shop" but not "Blog" lists projects
- **THEN** only "Shop" is returned

#### Scenario: Hidden project
- **WHEN** a non-member requests a project's details by id
- **THEN** the response is 404

### Requirement: Retention setting
Each project SHALL have a retention setting: the number of days raw report data is kept after an item is closed, or no limit. New projects SHALL default to 90 days. Only admins MAY change it.

#### Scenario: Default retention
- **WHEN** a project is created without a retention value
- **THEN** its retention is 90 days

#### Scenario: Disable retention limit
- **WHEN** an admin sets retention to no limit
- **THEN** the project stores retention as unlimited

### Requirement: Project deletion
Instance admins SHALL be able to delete a project. Deletion SHALL remove its memberships, feedback items and stored report data, and revoke its upload tokens.

#### Scenario: Delete project
- **WHEN** an admin deletes "Shop"
- **THEN** its feedback items and report blobs are gone and uploads with its tokens are rejected

# user-auth Specification

## Purpose

Lets people sign in to Nooted through the organization's OIDC provider and keeps a server-side session for the console and the SDK sign-in window.

## Requirements

### Requirement: OIDC sign-in
The system SHALL authenticate users with a configured OIDC provider using the authorization code flow with PKCE and a state parameter. After a successful callback, the system SHALL create a session and redirect to the requested return path.

#### Scenario: Successful sign-in
- **WHEN** an unauthenticated user visits `/auth/login?returnTo=/projects` and completes login at the provider
- **THEN** the callback creates a session, sets the session cookie and redirects to `/projects`

#### Scenario: State mismatch
- **WHEN** the callback receives a `state` that does not match the one issued for this browser
- **THEN** the system responds with 400 and creates no session

#### Scenario: Unsafe return path
- **WHEN** `returnTo` is an absolute URL or a protocol-relative path such as `//evil.example`
- **THEN** the system ignores it and redirects to `/` after sign-in

### Requirement: User provisioning
The system SHALL create a user on first sign-in, identified by the provider's issuer and subject. On each sign-in, the system SHALL update the stored email and display name from the ID token claims.

#### Scenario: First sign-in
- **WHEN** a person signs in for the first time
- **THEN** a user record is created with their issuer, subject, email and name

#### Scenario: Changed email
- **WHEN** a returning user signs in and the provider reports a new email
- **THEN** the stored email is updated and the user keeps the same identity and memberships

### Requirement: Instance admins
The system SHALL treat users whose verified email is in the configured admin list as instance admins, re-evaluating this on every sign-in.

#### Scenario: Admin by configuration
- **WHEN** a user whose email is in `NOOTED_ADMIN_EMAILS` signs in
- **THEN** the user is an instance admin for that session

#### Scenario: Admin removed from configuration
- **WHEN** an email is removed from the admin list and that user signs in again
- **THEN** the user is no longer an instance admin

### Requirement: Session cookie
The system SHALL keep sessions server-side and identify them with an opaque, httpOnly, SameSite=Lax cookie, marked Secure when served over HTTPS. Sessions SHALL expire 7 days after creation.

#### Scenario: Valid session
- **WHEN** a request carries a valid, unexpired session cookie
- **THEN** the request is treated as that user

#### Scenario: Expired session
- **WHEN** a request carries a session cookie older than 7 days
- **THEN** the session is rejected and API requests return 401

### Requirement: Sign-out
The system SHALL let a signed-in user end their session, deleting it server-side and clearing the cookie.

#### Scenario: Sign out
- **WHEN** a signed-in user posts to `/auth/logout`
- **THEN** the session is deleted and later requests with the old cookie return 401

### Requirement: Authenticated console API
The system SHALL reject console API requests without a valid session with 401, and SHALL expose the current user's id, email, name and admin flag.

#### Scenario: Current user
- **WHEN** a signed-in user calls `GET /api/me`
- **THEN** the response contains their id, email, name and `isAdmin`

#### Scenario: Anonymous request
- **WHEN** a request without a session calls `GET /api/me`
- **THEN** the response is 401

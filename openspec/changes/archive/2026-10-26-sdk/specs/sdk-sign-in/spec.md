# Spec Delta

## MODIFIED Requirements

### Requirement: Token delivery
On success, the window SHALL post `{ type: "nooted:token", token, expiresAt, user: { name, email } }` to the opener and close itself. If there is no opener, it SHALL show a message telling the user to start from the report window. The message SHALL also explain that a site sending `Cross-Origin-Opener-Policy: same-origin` cuts the link to the popup, and that `same-origin-allow-popups` is needed.

#### Scenario: Successful delivery
- **WHEN** a member completes the sign-in window opened from an allowed origin
- **THEN** the opener receives the token message and the window closes

#### Scenario: Opened directly
- **WHEN** the sign-in URL is opened in a tab with no opener
- **THEN** no token is issued and the page explains how to sign in

#### Scenario: Opener severed by COOP
- **WHEN** the report window on a site with `Cross-Origin-Opener-Policy: same-origin` opens the sign-in window
- **THEN** no token is issued and the page names `Cross-Origin-Opener-Policy` as the likely cause and suggests `same-origin-allow-popups`

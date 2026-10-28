# Proposal

## Why

Nooted exists so coding agents can act on change requests from the people using a site. Reports now carry captures with element descriptions, and the console shows them. Agents still have no way in. This change adds MCP access, so an agent like Claude Code can list a project's change requests, read one as a digest it can act on, and mark it as done. Nooted is the OAuth authorization server, so people grant access with their existing console login and can revoke it.

## What Changes

- **MCP endpoint** at `/mcp`: Streamable HTTP, stateless, served by the existing server. It offers four tools:
  - `list_projects`;
  - `list_feedback`: per project, with an optional status filter and paging;
  - `get_feedback`: one change request as a Markdown digest;
  - `set_feedback_status`.
- **The digest:**
  - the note, with each `[n]` resolved to its capture;
  - point captures list their selected elements: name, role, text, selector, and the capture's page and viewport;
  - recordings give their duration, the start and end pages, and any errors captured while recording;
  - metadata, and a link to the item in the console.

  Raw rrweb data is never returned.
- **OAuth 2.1 authorization server,** following the MCP authorization spec:
  - discovery: protected resource metadata (RFC 9728) and a `WWW-Authenticate` challenge on 401, plus authorization server metadata (RFC 8414);
  - dynamic client registration (RFC 7591);
  - the authorization code flow with PKCE S256 only;
  - tokens bound to the MCP resource (RFC 8707);
  - opaque access tokens and rotating refresh tokens, stored hashed, with revocation.
- **Consent in the console:** the authorization endpoint needs a console session, using the existing sign-in, and shows a consent page naming the agent and what it may do. Access is limited to the projects the user can see.
- **Connected agents page,** in the console's user menu: lists each granted agent with when it was connected and last used, and offers Revoke.
- **Feedback status:** the statuses become a defined set: New, In progress, Done, Dismissed. They can be changed on the console item page and through MCP, and the list shows them.
- **Dev setup:** Vite proxies `/mcp`, `/oauth` and `/.well-known` to the server.
- **README:** how to connect Claude Code (`claude mcp add --transport http nooted <url>/mcp`) and other MCP clients.

## Capabilities

### New Capabilities
- `mcp-server`: the MCP endpoint, its tools, the change-request digest, and which projects an agent can see.
- `mcp-authorization`: OAuth discovery, client registration, authorization with console consent, tokens, refresh and revocation, and the connected agents page.
- `feedback-status`: the defined statuses and changing them from the console and through MCP.

### Modified Capabilities
- None. The console API keeps accepting only session cookies, and MCP tokens are accepted only at `/mcp`. Both rules are stated in `mcp-authorization`.

## Impact

- **`apps/server`:**
  - new modules `oauth/` (metadata, registration, authorize, token, revoke, grants and tokens repo) and `mcp/` (server, tools, digest);
  - migration `003` for OAuth clients, authorization requests, grants and tokens, plus a status constraint;
  - status update route and tests.
- **Dependency:** `@modelcontextprotocol/sdk`, pinned exactly to 1.32.2, using its web-standard Streamable HTTP transport.
- **`apps/web`:** a consent route, a Connected agents page, the status control on the item page, status chips in the list, and the Vite proxy entries.
- **`packages/shared`:** the status list and labels.
- **Security:**
  - access tokens work only on `/mcp`;
  - refresh token reuse revokes the grant;
  - redirect URIs must match exactly what was registered (loopback or https);
  - consent can't be forged, because approving needs a same-origin request with the session.

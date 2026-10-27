# Spec Delta

## Purpose

Gets Nooted onto a page cheaply and safely: a tiny inline loader that only fetches the full SDK when Nooted is enabled on the device, a small public API for the host app, and the guarantee that Nooted never breaks the app.

## ADDED Requirements

### Requirement: Inline loader
The loader SHALL be an inline script with the project key and Nooted URL embedded. When `nooted:enabled` is not set in `localStorage`, it SHALL make no network requests and register no listeners other than the `#nooted` hash check. Its minified, gzipped size SHALL be at most 1 KB.

#### Scenario: Disabled device
- **WHEN** a page with the loader is opened on a device where Nooted was never enabled
- **THEN** no request is made to the Nooted server

#### Scenario: Enabled device
- **WHEN** a page with the loader is opened and `nooted:enabled` is set
- **THEN** the loader injects an async script for `<nooted>/sdk/v1/nooted.js` before the app bundle has finished loading

### Requirement: Enabling and disabling
The flag SHALL be set by `nooted.init()` or by loading any page whose URL hash is exactly `#nooted`. It SHALL be cleared by `#nooted-off`, `nooted.disable()` or the report window's "Turn off" action. On either hash, the loader SHALL remove the hash from the URL without reloading or adding a history entry.

#### Scenario: Enable by hash
- **WHEN** a user visits `https://shop.example.com/cart#nooted`
- **THEN** the flag is set, the SDK loads, and the URL becomes `https://shop.example.com/cart`

#### Scenario: Disable by hash
- **WHEN** a user visits a page with `#nooted-off`
- **THEN** the flag is cleared and the SDK no longer loads on later page views

### Requirement: Early queueing
Until the SDK has loaded, the loader SHALL record `error` and `unhandledrejection` events and calls to the public API in a queue. The SDK SHALL process that queue when it starts, so nothing that happens before it loads is lost.

#### Scenario: Error before SDK loads
- **WHEN** the app throws during startup before `nooted.js` has loaded
- **THEN** the error appears in the timeline of the next report

#### Scenario: Early API call
- **WHEN** the app calls `nooted.open()` before the SDK has loaded
- **THEN** the report window opens once the SDK has loaded

### Requirement: Public API
The `@nooted/sdk` package SHALL export a typed `nooted` object with `init(options?)`, `open()`, `signOut()` and `disable()`, which forward to the loaded SDK or to the loader's queue. `init` SHALL accept a `release` string and a `button` flag. `signOut()` SHALL revoke the current upload token on the server and forget it locally.

#### Scenario: Init from the app
- **WHEN** the app calls `nooted.init({ release: '1.4.2' })` on a device without the flag
- **THEN** the flag is set, the SDK loads, and later reports carry release `1.4.2`

#### Scenario: Sign out
- **WHEN** the app's logout calls `nooted.signOut()`
- **THEN** the token is revoked on the server and the next report requires signing in again

### Requirement: Loader snippet
The package SHALL export `loaderSnippet({ projectKey, nootedUrl, release? })`, which returns the complete inline `<script>` element, and `loaderCspHash(options)`, which returns the `'sha256-…'` source expression that allows exactly that script under a Content Security Policy.

#### Scenario: Hash matches snippet
- **WHEN** a page's CSP has `script-src` with the value from `loaderCspHash(options)` and no `'unsafe-inline'`
- **THEN** the snippet from `loaderSnippet(options)` runs on that page

### Requirement: Vite plugin
The package SHALL export a Vite plugin (`@nooted/sdk/vite`). By default it SHALL emit the loader as a content-hashed external file in the build output and reference it with a plain `<script src>` as the first child of `<head>`. With `inline: true` it SHALL insert the inline snippet instead.

#### Scenario: Default external loader
- **WHEN** an app builds with `nooted({ projectKey, nootedUrl })` in its Vite plugins
- **THEN** the build output contains the loader file and the built `index.html` references it before any other script

#### Scenario: Strict CSP with default plugin
- **WHEN** a page built with the default plugin sends `script-src 'self' <nooted origin>` and no `'unsafe-inline'`
- **THEN** the loader runs and, if Nooted is enabled, the SDK loads

#### Scenario: Inline option
- **WHEN** the plugin is configured with `inline: true`
- **THEN** the built `index.html` contains the inline snippet before any other script

### Requirement: Nonce propagation
When the loader script carries a `nonce`, the loader SHALL set the same nonce on the SDK script it injects.

#### Scenario: Nonce-based CSP
- **WHEN** a server-rendered page sends `script-src 'nonce-r4nd0m' <nooted origin>` and renders the loader with `nonce="r4nd0m"`
- **THEN** the injected SDK script has `nonce="r4nd0m"` and runs

### Requirement: Load failure diagnostics
When the SDK script fails to load, the loader SHALL log one `[nooted]` warning that names the bundle URL and mentions a Content Security Policy `script-src` or an unreachable Nooted server as likely causes.

#### Scenario: Blocked by CSP
- **WHEN** the page's CSP does not allow the Nooted origin and Nooted is enabled
- **THEN** the console shows a single `[nooted]` warning mentioning `script-src`, and the app keeps working

### Requirement: SDK bundle served by Nooted
The Nooted server SHALL serve the SDK bundle at `GET /sdk/v1/nooted.js` with a JavaScript content type, an `ETag`, and `Cache-Control: no-cache`, so browsers revalidate and pick up SDK fixes without app rebuilds.

#### Scenario: Fetch bundle
- **WHEN** a browser requests `/sdk/v1/nooted.js`
- **THEN** the response is 200 with `Content-Type: text/javascript` and an `ETag`

#### Scenario: Revalidate
- **WHEN** the browser repeats the request with `If-None-Match` matching the current bundle
- **THEN** the response is 304

### Requirement: Never break the host app
Every Nooted entry point (loader, API calls, event handlers and timers) SHALL catch its own errors and log them with a `[nooted]` console prefix instead of throwing. Nooted SHALL NOT replace or wrap app globals other than adding its own listeners.

#### Scenario: SDK bundle unreachable
- **WHEN** the Nooted server is down and the flag is set
- **THEN** the app loads and works normally, and calls to `nooted.open()` are no-ops that do not throw

#### Scenario: Internal failure
- **WHEN** an exception occurs inside Nooted's event handling
- **THEN** it is logged with the `[nooted]` prefix and does not reach the app's error handlers

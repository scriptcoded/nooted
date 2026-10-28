# sdk-loader Specification

## Purpose

Gets Nooted onto a page cheaply and safely: a tiny inline loader that only fetches the full SDK when Nooted is enabled on the device, a small public API for the host app, and the guarantee that Nooted never breaks the app.

## Requirements

### Requirement: Inline loader
The loader SHALL be an inline script with the project key and Nooted URL embedded. When `nooted:enabled` is not set in `localStorage`, it SHALL make no network requests and register no listeners. Its minified, gzipped size SHALL be at most 1 KB.

#### Scenario: Disabled device
- **WHEN** a page with the loader is opened on a device where Nooted was never enabled
- **THEN** no request is made to the Nooted server

#### Scenario: Enabled device
- **WHEN** a page with the loader is opened and `nooted:enabled` is set
- **THEN** the loader injects an async script for `<nooted>/sdk/v1/nooted.js` before the app bundle has finished loading

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

### Requirement: Enabling from the app
The enabled flag SHALL be set only by `nooted.init()` and cleared only by `nooted.disable()`. The loader SHALL NOT read or change the URL.

#### Scenario: Hash has no effect
- **WHEN** a user visits `https://shop.example.com/cart#nooted` on a device without the flag
- **THEN** the flag stays unset, the SDK does not load, and the URL is unchanged

#### Scenario: Disable from the app
- **WHEN** the app calls `nooted.disable()`
- **THEN** the flag is cleared, Nooted's UI is removed, and later page views do not load the SDK

#### Scenario: Enable again on the same page
- **WHEN** the app calls `nooted.disable()` and later `nooted.init()` without a reload
- **THEN** the floating button and triggers come back without loading the SDK again

### Requirement: Early call queueing
Until the SDK has loaded, the loader SHALL record calls to the public API in a queue. The SDK SHALL process that queue in order when it starts, so no call made before it loads is lost. The loader SHALL NOT listen for errors.

#### Scenario: Early API call
- **WHEN** the app calls `nooted.open()` before the SDK has loaded
- **THEN** the report window opens once the SDK has loaded

#### Scenario: No error listeners
- **WHEN** a page with Nooted enabled loads
- **THEN** the loader adds no `error` or `unhandledrejection` listeners

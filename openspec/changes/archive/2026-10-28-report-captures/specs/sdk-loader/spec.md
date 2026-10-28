# Spec Delta

## MODIFIED Requirements

### Requirement: Inline loader
The loader SHALL be an inline script with the project key and Nooted URL embedded. When `nooted:enabled` is not set in `localStorage`, it SHALL make no network requests and register no listeners. Its minified, gzipped size SHALL be at most 1 KB.

#### Scenario: Disabled device
- **WHEN** a page with the loader is opened on a device where Nooted was never enabled
- **THEN** no request is made to the Nooted server

#### Scenario: Enabled device
- **WHEN** a page with the loader is opened and `nooted:enabled` is set
- **THEN** the loader injects an async script for `<nooted>/sdk/v1/nooted.js` before the app bundle has finished loading

## REMOVED Requirements

### Requirement: Enabling and disabling
**Reason**: The `#nooted` and `#nooted-off` hashes and the report window's "Turn off" action are removed. Nobody could tell how to turn Nooted back on after turning it off, so the host app now decides.
**Migration**: The app calls `nooted.init()` to enable Nooted on a device and `nooted.disable()` to turn it off, as described in "Enabling from the app".

### Requirement: Early queueing
**Reason**: The loader no longer queues errors; only API calls are queued.
**Migration**: Replaced by "Early call queueing" below.

## ADDED Requirements

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

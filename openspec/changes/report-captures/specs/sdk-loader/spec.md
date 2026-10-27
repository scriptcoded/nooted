# Spec Delta

## REMOVED Requirements

### Requirement: Early queueing
**Reason**: The loader no longer queues errors; only API calls are queued.
**Migration**: Replaced by "Early call queueing" below.

## ADDED Requirements

### Requirement: Early call queueing
Until the SDK has loaded, the loader SHALL record calls to the public API in a queue. The SDK SHALL process that queue in order when it starts, so no call made before it loads is lost. The loader SHALL NOT listen for errors.

#### Scenario: Early API call
- **WHEN** the app calls `nooted.open()` before the SDK has loaded
- **THEN** the report window opens once the SDK has loaded

#### Scenario: No error listeners
- **WHEN** a page with Nooted enabled loads
- **THEN** the loader adds no `error` or `unhandledrejection` listeners

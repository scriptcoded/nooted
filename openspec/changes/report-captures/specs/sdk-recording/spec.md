# Spec Delta

## REMOVED Requirements

### Requirement: Rolling buffer
**Reason**: Nooted no longer records in the background; it records only during a capture.
**Migration**: Use captures (`sdk-captures`), which hold a snapshot or a short demo clip chosen by the user.

### Requirement: Single buffer module
**Reason**: There is no continuous event stream to buffer any more; each capture owns its own short recording.
**Migration**: None. Capture recordings are described in `sdk-captures`.

### Requirement: Freeze on trigger
**Reason**: Opening the report window no longer captures anything.
**Migration**: The user adds captures from the report window (`sdk-captures`).

### Requirement: Errors in the timeline
**Reason**: Error capture is not central to change requests and needed an always-on listener.
**Migration**: Errors are recorded only inside demo clips ("Errors in demos" in `sdk-captures`).

# Spec Delta

## Purpose

Defines how Nooted runs as a production container: how it shuts down on termination signals, how orchestrators check that it is alive, which image is published, and what the image needs from its runtime filesystem.

## ADDED Requirements

### Requirement: Graceful shutdown
On SIGTERM or SIGINT the server SHALL stop accepting new connections and let in-flight requests finish. It SHALL then close the capture renderer's browser and the database and exit with code 0. Requests still running after 10 seconds SHALL be cut off; the server SHALL then exit with a non-zero code.

#### Scenario: Idle server is stopped
- **WHEN** a running server with no open requests receives SIGTERM
- **THEN** it exits with code 0 within a second, and the database file holds no uncommitted write-ahead state needing recovery

#### Scenario: Request in flight
- **WHEN** SIGTERM arrives while a report upload is being received
- **THEN** that upload completes and is stored, new connections are refused, and the server then exits with code 0

#### Scenario: Request outlasts the deadline
- **WHEN** a request is still open 10 seconds after SIGTERM
- **THEN** the server closes it and exits with a non-zero code

#### Scenario: Second signal
- **WHEN** a second SIGTERM or SIGINT arrives during shutdown
- **THEN** the server exits immediately with a non-zero code

### Requirement: Health endpoint
`GET /api/health` SHALL answer 200 with `{"status":"ok"}` without authentication while the server is serving. It SHALL NOT depend on the OIDC provider or Chromium being reachable.

#### Scenario: Probe on a running server
- **WHEN** an orchestrator calls `GET /api/health` on a running server
- **THEN** it receives 200 with `{"status":"ok"}`

#### Scenario: Identity provider down
- **WHEN** the OIDC issuer is unreachable
- **THEN** `GET /api/health` still answers 200

### Requirement: Container image
Each release SHALL have a container image published, which includes the console, the SDK bundle and Chromium for capture images. It SHALL run as a non-root user, listen on port 3000 by default, store all state under `/data`, and declare a health check against `/api/health`.

#### Scenario: Default container
- **WHEN** the image is run with the required environment variables and a volume at `/data`
- **THEN** the console, API, SDK and MCP endpoints are served on port 3000 by a non-root process, and the container reports healthy

#### Scenario: Images off
- **WHEN** the image runs with `CAPTURE_IMAGES=off`
- **THEN** it never launches Chromium and all other features work

### Requirement: Read-only root filesystem
The image SHALL run with a read-only root filesystem when `/data` and `/tmp` are writable. All features, including capture images, SHALL keep working.

#### Scenario: Locked-down pod
- **WHEN** the container runs with a read-only root filesystem, a writable volume at `/data` and a writable `/tmp`
- **THEN** reports are stored and capture images render

### Requirement: Image tags
An image SHALL be published for every commit on `main`, tagged with its commit SHA and `main`. For each `vX.Y.Z` tag it SHALL be published as `X.Y.Z`, `X.Y` and `latest`. Each image SHALL carry OCI labels for its source repository, revision and version. An image SHALL be published only after typecheck and unit tests pass for that commit.

#### Scenario: Version tag
- **WHEN** `v1.2.0` is pushed and its checks pass
- **THEN** the registry has the image under `1.2.0`, `1.2` and `latest`, labeled with that commit and version

#### Scenario: Failing tests
- **WHEN** a commit on `main` fails its unit tests
- **THEN** no image is published for it

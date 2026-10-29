# Deploying Nooted

Nooted is one container with one SQLite database on a volume. This guide covers running that image on Kubernetes; the same points apply to any other container host. For the full list of settings see [Configuration](../README.md#configuration).

## Image and tags

Images are published to `ghcr.io/<owner>/nooted` by the `Image` GitHub Actions workflow, only after typecheck and unit tests pass.

| Tag | Published for |
| --- | --- |
| `<short sha>` (for example `sha-1a2b3c4`) | every commit on `main` |
| `main` | the latest commit on `main` |
| `1.2.0`, `1.2` | a `v1.2.0` tag |
| `latest` | the most recent `vX.Y.Z` tag (not `main`) |

For a cluster, pin a version (`1.2.0`) or a `sha-` tag rather than `main` or `latest`. Each image carries the OCI labels `org.opencontainers.image.source`, `.revision` and `.version`.

New GHCR packages are private. Either make the package public (package settings on GitHub), or create a pull secret and reference it from the pod:

```sh
kubectl create secret docker-registry ghcr --docker-server=ghcr.io \
  --docker-username=<github user> --docker-password=<token with read:packages>
```

```yaml
spec:
  imagePullSecrets: [{ name: ghcr }]
```

The image is linux/amd64 only and about 1 GB, because it includes Chromium for capture images. Chromium sits in its own layer, so an update that only changes code pulls little.

## Runtime facts

| | |
| --- | --- |
| Port | 3000 (`PORT` changes it) |
| User | `node`, uid 1000, gid 1000 |
| State | everything under `/data` (`DATA_DIR`): `nooted.db` plus its `-wal` and `-shm` files, and uploaded report blobs |
| Writable paths | `/data` and `/tmp` only. Chromium's profile and the font cache (`XDG_CACHE_HOME=/tmp/.cache`) go to `/tmp`; they are rebuilt on demand |
| Health | `GET /api/health` returns 200 `{"status":"ok"}`, unauthenticated. It does not check the identity provider or Chromium |
| Shutdown | SIGTERM drains in-flight requests for up to 10 seconds, closes Chromium and the database, then exits 0 |

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `PUBLIC_URL` | yes | The public https origin, no trailing slash, for example `https://nooted.example.com`. Used for the OIDC redirect URI. With an `https` URL, cookies are marked `Secure` |
| `OIDC_ISSUER` | yes | Issuer URL of your OpenID Connect provider |
| `OIDC_CLIENT_ID` | yes | Client ID registered with the provider |
| `OIDC_CLIENT_SECRET` | yes | Put this in a Secret, not a ConfigMap |
| `TRUST_PROXY_HOPS` | no | Number of proxies in front of Nooted; see Ingress. Default `0` |
| `NOOTED_ADMIN_EMAILS` | no | Comma-separated instance admins |
| `CAPTURE_IMAGES` | no | `off` never launches Chromium. Default `auto` |
| `PORT`, `DATA_DIR`, `WEB_DIST_DIR`, `SDK_DIST_DIR`, `CHROMIUM_PATH` | no | Already set correctly in the image; leave them alone |

The server exits at startup with a message naming every missing or invalid variable, so a bad config shows up as a crash-looping pod with a readable log.

## OIDC

Register this redirect URI with your provider:

```
${PUBLIC_URL}/auth/callback
```

The pod must be able to reach the issuer URL over the network at sign-in time.

## Storage and replicas

Mount `/data` from a PersistentVolumeClaim with `ReadWriteOnce`. Do not use NFS or other network filesystems that lack reliable file locking: SQLite will corrupt on them.

Run exactly one replica. Two pods writing the same SQLite file must never overlap, not even briefly during a rollout, so use the `Recreate` strategy:

```yaml
spec:
  replicas: 1
  strategy: { type: Recreate }
```

## Probes

Use httpGet probes on `/api/health`. The Dockerfile's `HEALTHCHECK` is for `docker run` and compose only; Kubernetes ignores it.

```yaml
livenessProbe:
  httpGet: { path: /api/health, port: 3000 }
  periodSeconds: 30
  timeoutSeconds: 5
readinessProbe:
  httpGet: { path: /api/health, port: 3000 }
  periodSeconds: 10
  timeoutSeconds: 5
```

## Security context

The image runs unchanged as non-root with a read-only root filesystem and no capabilities (verified with `--read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges`, including capture images). Chromium is launched without its own sandbox, so it needs no extra privileges.

```yaml
securityContext:            # pod
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000             # makes the volume writable by `node`
containers:
  - securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: [ALL] }
    volumeMounts:
      - { name: data, mountPath: /data }
      - { name: tmp, mountPath: /tmp }
volumes:
  - { name: tmp, emptyDir: {} }
```

## Ingress

- Terminate TLS at the ingress and forward plain HTTP to port 3000. Set `PUBLIC_URL` to the https origin, so the session cookies get `Secure`.
- Set `TRUST_PROXY_HOPS=1` (or the real number of proxies) so rate limiting sees client addresses. At `0` the `X-Forwarded-For` header is ignored and every request appears to come from the ingress.
- Allow request bodies of at least 10 MiB on `/api/sdk/reports`. Reports are gzip-compressed JSON, and the server rejects bodies over 10 MiB (compressed) with 413; it also rejects reports that unpack to more than 100 MiB. Many ingress controllers default to 1 MiB (ingress-nginx: `nginx.ingress.kubernetes.io/proxy-body-size: 10m`).
- The MCP endpoint (`/mcp`) is stateless request/response and needs no special streaming or timeout settings.

## Resources

| | Value |
| --- | --- |
| Memory request | about 200 MiB |
| Memory limit | at least 1 GiB with capture images on. Chromium takes about 150 MiB per render, with up to 2 renders at once. With `CAPTURE_IMAGES=off` a smaller limit is fine |
| `/dev/shm` | Docker's default of 64 MiB is enough. Rendering was checked with exactly that, and the server passes no `--disable-dev-shm-usage`. Kubernetes also gives pods a 64 MiB `/dev/shm`. Only raise it (an `emptyDir` with `medium: Memory` mounted at `/dev/shm`) if Chromium crashes while rendering unusually large pages |

## Termination

`terminationGracePeriodSeconds` can stay at the default 30. Shutdown takes well under a second when idle and is capped at 10 seconds.

## Backups

Everything is in `/data`. The database runs in WAL mode, so a plain file copy taken while the server runs can miss recent writes or be inconsistent. Either:

- take a snapshot of the volume, or
- stop the pod (SIGTERM checkpoints the WAL into `nooted.db`) and copy the directory, or
- copy `nooted.db`, `nooted.db-wal` and `nooted.db-shm` together, then verify the copy opens.

Back up the whole directory, including the report blobs.

---
description: How a worker is installed on Linux and in Docker
---

`splates worker recipe` prints the root install script for a fresh Debian or
Ubuntu machine (`snapshotRecipe` in `packages/server/workers/snapshot.ts`);
cloud snapshots are built from it. The Windows WSL2 installer went with
worker waking, and the worker proof (`splates dev prove worker`) with remote
agents, on 2026-10-22. `splates dev prove coordinator`, which ran
`splates server` in a Debian container, went the same day: the server runs
on this machine, with its agents, and a runner (`splates dev test` on one) covers
what differs on Linux.

`docker/worker.Dockerfile` builds a credential-free Linux worker from this
checkout, which is also the runner `splates dev prove runner` joins
(`docker/prove-runner.sh`, with `prove-lib.sh` and `forward.ts`, which gives
the container a loopback to reach this machine's server through). A server on
Linux needs a working device store: libsecret's, or
files under `~/.splates/secrets/` with `SPLATES_SECRET_STORE=file`; a server
with neither stops at once saying so.


`docker/runner.Dockerfile` is the slim cloud job image, separate from the
worker proof. It has bun, git, curl, procps, a non-root `splates` user, the
released CLI at `SPLATES_VERSION`, and bun's cache warmed from the release
checkout with scripts skipped. A separate build stage keeps that checkout
out of the final image. No Chromium or agent runtime is installed.

Its entrypoint runs `splates runners serve` on port 8080. The hosting
platform supplies `SPLATES_RUNNER_SECRET`. An HTTP upgrade at `/api/jobs`
requires `Authorization: Bearer <secret>`. Once upgraded, the client installs
its `WorkerSession.hello` listener and sends the text frame `ready`; the
runner then sends its ordinary worker hello (`jobs: true`, zero agent slots).
Only `job` channels are accepted. Disconnecting kills that connection's jobs;
clients must not replay a command on another connection as if it resumed.
The secret is stripped from job child environments.

For a checkout's own build, set `SPLATES_BUILD_URL` to the server's
`GET /api/workers/join` URL and `SPLATES_BUILD_TOKEN` to `OwnBuild.grant()`.
The boot wrapper fetches with `x-splates-build`, atomically installs the
bundle, and runs that CLI instead. A failed fetch stops boot, so the release
cannot silently substitute for a checkout. The URL must be reachable without
interactive Cloudflare Access; the transport integration must arrange that
before handing it to Fly. Build tokens are unset before the CLI starts.

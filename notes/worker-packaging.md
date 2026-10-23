---
description: How splates installs on a Linux machine or in Docker, and what a Linux server needs to start; bears on Linux setup and the worker image
---

Little packaging is left: `splates worker recipe` prints a Linux install
script, and `docker/worker.Dockerfile` builds a Linux worker from this
checkout. Everything else that packaged splates for other machines was
removed on 2026-10-22 and 2026-10-23.

## How it works

- `splates worker recipe` prints the root install script for a fresh
  Debian or Ubuntu machine, from `snapshotRecipe`.
- `docker/worker.Dockerfile` builds a credential-free Linux worker from
  this checkout.
- `docker/forward.ts` forwards a port, so a worker in a container can
  reach this machine's server through its own loopback.
- A server on Linux needs a working device store: libsecret's, or files
  under `~/.splates/secrets/` with `SPLATES_SECRET_STORE=file`.
- A server with neither stops at once saying so.

## History

- 2026-10-22: the Windows WSL2 installer went with worker waking.
- 2026-10-22: the worker proof, `splates dev prove worker`, went with
  remote agents.
- 2026-10-22: `splates dev prove coordinator`, which ran `splates server`
  in a Debian container, went too, since the server runs on this machine
  with its agents.
- 2026-10-23: the cloud runner image, its bootstrap,
  `splates runners serve`, the Linux binaries and the rest of
  `splates dev prove` were removed with the Fly.io integration.

## Where

- `packages/server/workers/snapshot.ts`: `snapshotRecipe`, `workerRecipe`
- `packages/server/creds/stores.ts`: `SPLATES_SECRET_STORE`
- `packages/server/server/start.ts`: the `no_secret_store` refusal
- `docker/worker.Dockerfile`
- `docker/forward.ts`

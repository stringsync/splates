---
description: How a worker is installed on Linux and in Docker
---

`splates worker recipe` prints the root install script for a fresh Debian or
Ubuntu machine (`snapshotRecipe` in `packages/server/workers/snapshot.ts`);
cloud snapshots are built from it. The Windows WSL2 installer went with
worker waking, and the worker proof (`splates dev prove worker`) with remote
agents, on 2026-10-22. `splates dev prove coordinator`, which ran
`splates server` in a Debian container, went the same day: the server runs
on this machine, with its agents, and `splates dev test --linux` covers
what differs on Linux.

`docker/worker.Dockerfile` builds a credential-free Linux worker from this
checkout. A server on Linux needs a working device store: libsecret's, or
files under `~/.splates/secrets/` with `SPLATES_SECRET_STORE=file`; a server
with neither stops at once saying so.

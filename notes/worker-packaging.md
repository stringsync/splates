---
description: How a worker is installed on Linux and in Docker, and how splates dev prove coordinator runs the server in a container
---

`splates worker recipe` prints the root install script for a fresh Debian or
Ubuntu machine (`snapshotRecipe` in `packages/server/workers/snapshot.ts`);
cloud snapshots are built from it. The Windows WSL2 installer went with
worker waking, and the worker proof (`splates dev prove worker`) with remote
agents, on 2026-10-22.

`docker/worker.Dockerfile` builds a credential-free Linux worker from this
checkout. `splates dev prove coordinator` (`docker/prove-coordinator.sh`)
runs `splates server` in a Debian container as the user `splates`, joins
this machine to it as a worker, and drives a task through to a merge, a
restart, an archive and a cred with `docker/scripted-agent.ts`, an ACP agent
that runs `coordinator-turn.sh` each turn in place of a real model, sharing
`docker/prove-lib.sh`. It placed that task's agent on this machine's worker,
which no longer runs a remote agent, so it waits on being reworked. The
coordinator needs a working device store: on Linux that is libsecret's, or
files under `~/.splates/secrets/` with `SPLATES_SECRET_STORE=file`; a server
on a Linux with neither stops at once saying so. The box's image adds
gnome-keyring (`coordinator.Dockerfile`) to prove the keyring's path.
systemd and cloudflared have no stand-in in Docker.

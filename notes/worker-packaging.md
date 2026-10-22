---
description: How a worker is installed on Linux, in Docker and on Windows (a WSL2 distro started at boot), and how a second worker is proven locally without a real model
---

`splates worker recipe` prints the root install script for a fresh Debian or
Ubuntu machine (`snapshotRecipe` in `packages/server/workers/snapshot.ts`);
cloud snapshots are built from it. `windows/install-worker.ps1`, fetched
from the coordinator's release tag since a bare `irm` cannot pass Access,
makes a WSL2 distro named `splates` from Ubuntu 24.04, runs the recipe,
joins with `splates worker join --key-file` (the key in
`~/.splates/worker.env`, since no secret service is unlocked at boot) and
registers a scheduled task run by S4U so it starts with no one signed in;
the worker holds Windows awake while it runs an agent, and its hello says
what waking it takes, so the coordinator can wake it by asking a worker on
the same network to send the packet.

`docker/worker.Dockerfile` builds a credential-free Linux worker from this
checkout, and `splates dev prove worker` (`docker/prove-worker.sh`) proves it end to end against a
throwaway coordinator with `docker/scripted-agent.ts`, an ACP agent that
runs `turn.sh` each turn in place of a real model. `splates dev prove coordinator`
(`docker/prove-coordinator.sh`) is its inverse: `splates server` runs in a Debian
container as the user `splates`, this machine joins it as a worker, and the
script drives a task through to a merge, a restart, an archive and a cred. Both
share `docker/prove-lib.sh`. The coordinator needs a working device store, as
the worker's key does not: on Linux that is libsecret's, Parameter Store
under an instance role, or files under `~/.splates/secrets/` with
`SPLATES_SECRET_STORE=file`; a server on a Linux with none of these stops at
once saying so. The box's image adds gnome-keyring (`coordinator.Dockerfile`)
to prove the keyring's path. IMDSv2, Parameter Store, systemd and cloudflared
have no stand-in in Docker. Home workers are extra
capacity at $0/hour, never the only capacity.

---
description: How the server starts its local worker, what a Linux server needs, and which remote installation tools were removed
---

The worker is part of the ordinary splates installation. `splates server`
starts `splates worker run --id local --quiet` beside itself over the local
Unix socket. No separate machine, join token or root recipe is needed.

## How it works

- The server supervises this machine's worker (`coordinator-and-workers.md`).
- `splates dev test` and the merge gate run on this machine.
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
  `splates dev prove` were removed.
- 2026-10-23: remote workers, `splates worker recipe` and snapshots were
  removed too.

## Where

- `packages/server/workers/run.ts`: local worker startup
- `packages/server/creds/stores.ts`: `SPLATES_SECRET_STORE`
- `packages/server/server/start.ts`: the `no_secret_store` refusal

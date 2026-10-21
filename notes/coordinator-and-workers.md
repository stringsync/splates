---
description: The coordinator (splates server) holds the records and the page; workers, including the local one on the Mac, run the agents and dial in over a replayed channel protocol
---

The coordinator is the `splates server` process: the records, the page, the
scheduler, the merge lease. Agents never run inside it. They run on workers
(`splates worker run`, `WorkerDaemon` in `packages/server/workers/`), which
dial out to the coordinator's `/api/workers` and never listen on a public
port; the local worker is the same code as its own process over the Unix
socket `~/.splates/worker.sock`, supervised by `splates server`, so a server
restart or update leaves agents running. One code path, so local and remote
cannot drift.

`WorkerSession` runs at both ends: JSON control frames and binary data
frames with per-channel seqs, every frame kept until acked and replayed
after a reconnect, so agents and PTYs outlive a dropped link and a
coordinator restart (its session id is kept in `~/.splates/coordinator.json`).
A worker that loses its coordinator for ten minutes ends what it held. The
hello carries `protocol: major.minor` and capabilities; a minor negotiates,
another major is drained. Workers join with a single-use token and then show
a key. `Scheduler` places agents on free slots first come first served, the
local worker first. The coordinator can move onto an always-on AWS box
(`coordinator/move.ts`), after which the Mac joins it as a worker and keeps
its tasks in their worktrees.

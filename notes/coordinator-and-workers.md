---
description: The coordinator (splates server) holds the records and the page; this machine's own worker runs every agent and dials in over a replayed channel protocol; other workers run no agents
---

The coordinator is the `splates server` process: the records, the page, the
scheduler, the merge lease, all git and GitHub. Agents never run inside it.
They run on this machine's own worker (`splates worker run --id local`,
`WorkerDaemon` in `packages/server/workers/`), its own process over the Unix
socket `~/.splates/worker.sock`, supervised by `splates server`, so a server
restart or update leaves agents running.

`WorkerSession` runs at both ends: JSON control frames and binary data
frames with per-channel seqs, every frame kept until acked and replayed
after a reconnect, so agents and PTYs outlive a dropped link and a
coordinator restart (its session id is kept in `~/.splates/coordinator.json`).
A worker that loses its coordinator for ten minutes ends what it held. The
hello carries `protocol: major.minor` and capabilities; a minor negotiates,
another major is drained. `Scheduler` places the agents other agents start
on the local worker's free slots, first come first served.

Other machines still join with a single-use token and then show a key, and
made workers are still provisioned and budgeted, but since 2026-10-22 none
runs an agent, a checkout or a terminal: remote agents, their clones, the
relay, task keys and waking were removed (see `designs/worker-pool.md`).
They come back as stateless runners for heavy jobs (`heavy-jobs-on-runners.md`).

---
description: Where agents run, the splates server or this machine's own worker, and how the two stay linked; bears on agent placement, restarts and other workers
---

The coordinator, the `splates server` process, holds the records and the
page, and agents never run inside it. Every agent runs on this machine's
own worker, which dials the server over a replayed channel protocol.
Only this machine's `local` worker is accepted.

## How it works

- The coordinator holds the records, the page, the scheduler, the merge
  lease, and all git and GitHub work.
- This machine's own worker is `splates worker run --id local`,
  `WorkerDaemon`.
- It is its own process, over the Unix socket `~/.splates/worker.sock`,
  supervised by `splates server`.
- So a server restart or update leaves agents running.
- `Scheduler` places the agents other agents start on the local worker's
  free slots, first come first served.

## The link

`WorkerSession` runs at both ends. It sends JSON control frames and binary
data frames with per-channel seqs. Every frame is kept until acked and
replayed after a reconnect. So agents and PTYs outlive a dropped link and
a coordinator restart. The coordinator keeps its session id in
`~/.splates/coordinator.json`.

A worker that loses its coordinator for ten minutes ends what it held.
The hello carries `protocol: major.minor` and capabilities. A different
minor negotiates; a different major is drained.

## Only this machine

Since 2026-10-23 only `local`, connecting over this machine's Unix socket,
is accepted. Remote joining, tokens, keys, provisioning, budgets, snapshots
and the Linux sandbox are gone. Processes run as the person in their own
worktrees. There are no job runners.

## History

- 2026-10-22: remote agents, their clones, the relay, task keys and
  waking were removed (see `designs/worker-pool.md`).
- 2026-10-23: the stateless runners that took heavy jobs instead were
  removed, with their jobs, server provisioning and runner billing.

## Where

- `packages/server/workers/daemon.ts`: `WorkerDaemon`
- `packages/server/workers/session.ts`: `WorkerSession`
- `packages/server/workers/protocol.ts`: `WorkerProtocol`
- `packages/server/workers/scheduler.ts`: `Scheduler`
- `packages/server/workers/run.ts`: `worker.sock`
- `packages/server/workers/coordinator-state.ts`: `coordinator.json`
- `designs/worker-pool.md`

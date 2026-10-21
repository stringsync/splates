---
description: How splates decides whether an agent still holds a task: the pid on the same host, the heartbeat's age on another, which is why stale is normal
---

A started task's record carries a lease, `{pid, hostname, heartbeatAt,
conversation?}` (`LeaseState` in `packages/server/tasks/worktree.ts`). On the
same host only `ps.alive(pid)` decides: every splates command is its own
short-lived process, so a lease goes stale the moment the command exits, and
nothing refreshes it locally. That is why `stale` in `splates list` is normal
for a task mid-edit and says nothing about abandonment.

For a holder on another host, such as a worker, the heartbeat's age is
compared with `leaseStalenessMs` (90s), and `LeaseBeat` re-stamps the lease
every third of that while a command runs there, so a long merge gate never
looks abandoned. `take()` writes a fresh lease with this process's pid;
`leaseHeldByOther` is what makes `merge` and `claim` refuse with
`lease_held`. Tests use `LIVE_PID = 1` to stand for another live agent.

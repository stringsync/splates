---
description: On a remote worker, splates commands reach the coordinator's records over a loopback relay with a per-agent project-scoped secret; checkouts there are clones, and Linux agents run in bubblewrap
---

A remote worker holds no project records. `splates` there reaches the
coordinator through a loopback port, the relay (`packages/server/workers/
relay.ts`), each connection going up the worker's socket as a `relay`
channel; agents find it as `SPLATES_DEV`, and a hand-run `splates` finds
`relay.json`. A connection is served only when its first request carries
the relay secret, issued per agent and limited to that agent's project.
Record reads and writes go through `RelayFs` (`records/relay-fs.ts`), one
`POST /api/state` each, which is why `merge` has a `relayed` flag.

A remote worker's disk is a disposable cache: a bare mirror per project and
task clones made from it with `--reference`, re-cloned from the pushed
`splates/<task>` branch when the checkout is elsewhere or swept away
(`workers/placement.ts`). The local worker keeps worktrees. On Linux each
agent runs in a bubblewrap sandbox (`workers/sandbox.ts`) and refuses to run
as root; on macOS, or without bubblewrap, agents run as the worker's user.

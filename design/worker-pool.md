# arbor dev on a pool of workers

`arbor dev` splits into a **coordinator** and **workers**, so more
conversations run at once than one machine holds, and arbor can run always-on
without a laptop. The question/answer UX does not change: distribution is
plumbing.

Each todo in the worker lanes points here. Decisions marked *settled* were made
with the user; those under *Open* are asked when their phase starts, never
decided by the agent alone.

## Roles

- **Coordinator**: the page, the scheduler, the merge lease, proxying, and all
  persistent arbor state (outcomes, roster, projects, `.git/arbor`). Today
  that is the Mac; later a small always-on cloud box behind Access.
- **Worker**: runs whole tasks: the checkout, the agent process, its browser,
  dev servers and test runs, all on one machine. A task never spans machines.

A worker is defined by what it can do, never by where it runs. The coordinator
and scheduler talk only to that contract:

- advertise capacity (slots) and platform;
- claim a task and materialize its checkout;
- spawn processes and stream their stdio: agent ACP, PTYs, hooks;
- answer the calls the coordinator makes on the task's machine today: git in
  the worktree around tool calls (`Watch`), background output files, the
  process tree (`heldBy`), session listing;
- proxy HTTP and WebSocket traffic to its own loopback ports;
- push the task's branch;
- heartbeat; drain and tear down.

## Protocol (settled)

- A worker daemon (`arbor worker run`) dials **out** to the coordinator's
  `/api/workers` WebSocket and multiplexes every channel over it. Workers
  never listen on a public port.
- The local worker speaks the same protocol to a coordinator on the same
  machine, as **its own process**. One code path; local and remote cannot
  drift.
- **Framing:** JSON control frames, and binary data frames with a small
  header (channel id, seq). Seq is per channel. The worker keeps unacked
  frames; the coordinator acks; on reconnect the coordinator says the last seq
  it holds per channel and the worker replays the rest.
- **Versioning:** the hello carries `protocol: major.minor` and a capability
  list. Minor differences negotiate by capability; a worker on another major
  is drained instead of breaking.

## Where the ACP client lives (settled)

In the coordinator, as today. `RemoteLaunch` implements the existing
`Launch` seam (`agent-process.ts`) over the protocol, streaming raw agent
stdio, so everything above it is unchanged. On a coordinator restart the
worker replays from the last seq the coordinator logged, and the coordinator
reattaches ACP knowing its in-flight request ids. The worker stays dumb, so
conversation logic versions with the coordinator alone.

## Repo state from a remote worker (settled)

The agent's own `arbor` commands (add, todo, escalate, merge, attach, creds)
write `.git/arbor` directly today. Repo state goes behind an interface:
files when local, an HTTP API to the coordinator when remote. The worker
opens a **loopback relay port** forwarded over its socket; `ARBOR_DEV`
points at it, so callbacks and repo-state calls both reach the coordinator.

## Task ports (settled direction)

Assume nothing of Cloudflare but Access. arbor routes by `Host` header under a
configured wildcard base host, `<task>-<port>.<base>`; how that base reaches
the coordinator (DNS, TLS, tunnel) is the operator's ingress or a
`TunnelProvider`'s job, and Access verification is the existing JWT check.
With no base host configured, the coordinator forwards each task port to a
loopback port of its own, so a remote worker's dev server still opens at
`http://localhost:<port>` on the coordinator's machine. One mechanism covers
poking at the app, demos and screenshots.

## Durability and merge

- No shared volume. Each worker's disk is a disposable cache: a bare mirror
  per project, task clones made from it with `--reference`.
- A central git remote is the durable truth. The task branch is pushed at
  every checkpoint, so the plan (intent) and the commits (done work) are
  durable together; a fresh worker clones the branch and resumes.
- The merge lock becomes a lease held by the coordinator. The worker takes
  it, fetches trunk, rebases, runs the hooks locally, and fast-forward pushes.

## Scheduler, queue and budget

- Placement: a local slot, then an existing remote worker, then a newly
  provisioned one if the budget allows; otherwise the task queues, visibly,
  with its position, wait and reason.
- A heavy-job cap per worker (test runs, installs, browser launches) turns
  contention into queueing.
- Every limit the user sets is in dollars: a $/hour rate cap, and $/day and
  $/month limits each with a warning threshold and a hard stop. Specs are
  secondary detail. A queue offers a priced one-click raise; `arbor budget`
  does the same.
- Reuse scry's window maths (`Budgets.standing`/`allowance`, `Limit[]`,
  raise and pause in `packages/cli/scry`), not its ledger: scry counts
  integer tokens per fixed role in a per-device JSON file with no warning
  tier in its logic. Spend is a coordinator ledger keyed by project and task
  (slot-hours), marked estimate (list price) or billed.
- Provisioned workers go through a `WorkerProvider` (create, destroy, list,
  price per hour per type) in `arbor.config.ts`, the way `TunnelProvider`
  is, with a fake for tests.

## Updates without waiting

The coordinator restarts on its own: agents, terminals and dev servers belong
to workers, which keep running and reconnect, and replay fills the gap.
UI-only changes rebuild the page and push it to open tabs. Worker builds roll
out one worker at a time by drain and resume; new tasks go to updated workers
first; the pool view shows each worker's build.

## Sizing

Measured 2026-10-16 on an M4 Max (16 cores, 64 GB) with ~8 live sessions;
macOS RSS double-counts shared pages.

- Agent session at rest (ACP adapter, claude, playwright-mcp): 0.6–0.7 GB,
  0–7% of a core.
- Full headless Chrome per session: ~0.95 GB with one page. One shared
  chrome-headless-shell: 154 MB plus ~120 MB per context.
- Per-task preview server: ~0.35 GB.
- `bin/wiz dev test` (preMerge, also run mid-task): 31–33 s wall, 220 CPU-s,
  ~7 cores, 7.2–7.4 GB.
- `bun install`: 0.8 s warm cache, 14.6 s cold.
- arbor dev: ~0.6 GB with 7 sessions.

A shared browser and a cap of 2 concurrent test runs bring 24 sessions to
about 43 GB on that Mac. A worker holds 8 slots with a heavy-job cap of 2,
bound by test throughput (test runs per task-hour is unmeasured).

| Type | Spec | $/h | $/mo always on | $/slot-hour |
| --- | --- | --- | --- | --- |
| Hetzner CX53 (EU, shared) | 16 vCPU / 32 GB | 0.0561 | 34.99 | 0.0070 |
| Hetzner CCX33 (dedicated) | 8 vCPU / 32 GB | 0.2612 | 162.99 | 0.033 |
| Fly performance-8x + 16 GB | 8 vCPU / 32 GB | ~0.50 | ~360 | ~0.063 |

Prices from Hetzner's 15 June 2026 adjustment and fly.io/pricing, USD,
excluding IPv4 and VAT; CX53 specs from third parties. Recommended: CX53,
a $0.25/h rate cap, $5/day (warn $3.50), $75/month (warn $60), and idle
shutdown after 15 minutes at the end of the paid hour. All remote, that is
about $55/month typical and $86 at peak, coordinator included.

## Delivery

Phases merge independently; the single-Mac setup works after each.

1. Protocol: local worker as its own process, remote launch, terminals and
   proxying through it, `arbor worker ls`, a restartable coordinator.
2. Durability and merge: repo state over the relay, the central remote,
   checkpoint pushes, the merge lease, clone-based checkouts.
3. Registered workers: join tokens, add/drain/rm, the pool UI, the visible
   queue, proven with a Linux container as a second worker.
4. Provisioning and budget.
5. Cloud coordinator.

Before phase 1: a shared browser and the heavy-job cap, on their own.

## Open

Asked when their phase starts:

- Where the central git remote lives (phase 2).
- How agent credentials reach workers (phase 3).
- What happens to an escalated task when its worker is removed (phase 3).
- What a hard spend limit does to workers already running (phase 4).
- Whether a worker daemon restart re-adopts live agents or drains and resumes
  (phase 4).
- Which provider (phase 4; recommended Hetzner).

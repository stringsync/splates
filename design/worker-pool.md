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
  machine, as **its own process**, over a Unix socket in `ARBOR_HOME`
  guarded by file permissions. One code path; local and remote cannot
  drift. The supervisor starts it beside the server, as
  `arbor worker run --id local --quiet`, starts it again a second after it
  ends, and stops it on quitting `arbor dev`; a server restart or update
  leaves it running.
- **Framing:** JSON control frames, and binary data frames with a small
  header (channel id, seq). Seq is per channel. The worker keeps unacked
  frames; the coordinator acks; on reconnect the coordinator says the last seq
  it holds per channel and the worker replays the rest. When the
  coordinator stays away longer than the buffer holds, the worker stops
  reading the agent's output: the agent blocks and nothing is lost.
  The hello and welcome each name their end's session, new each time a
  process starts: an end that finds the other one new ends every channel it
  held, since the new one knows none of them. Until a coordinator logs what
  it holds and takes its sessions back after a restart, a restart ends the
  agents it was running, as before workers.
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

## Task ports (settled)

Assume nothing of Cloudflare but Access. Any port a task's processes listen
on is found and forwarded automatically, as VS Code and Codespaces do, and
never without Access. arbor routes by `Host` header under a wildcard base
host saved per machine (`arbor dev --ports-host`), `<task>-<port>.<base>`;
how that base reaches
the coordinator (DNS, TLS, tunnel) is the operator's ingress or a
`TunnelProvider`'s job, and Access verification is the existing JWT check.
With no base host configured, the coordinator forwards each task port to a
loopback port of its own, so a remote worker's dev server still opens at
`http://localhost:<port>` on the coordinator's machine. One mechanism covers
poking at the app, demos and screenshots.

## Durability and merge

- No shared volume. Each remote worker's disk is a disposable cache: a bare
  mirror per project, task clones made from it with `--reference`. The
  local worker keeps worktrees.
- The central remote is the project's existing GitHub origin. A task's
  branch is pushed there as `arbor/<task>` after every commit and at every
  checkpoint, and deleted on merge or remove; `ARBOR.md` syncs to the
  coordinator as repo state at the same moments and never lands on main. The
  plan (intent) and the commits (done work) are durable together; a fresh
  worker clones the branch and resumes.
- The merge lock becomes a lease held by the coordinator. The worker takes
  it, fetches trunk, rebases, runs the hooks locally, and pushes the tested
  `arbor/<task>`; the coordinator checks it is a fast-forward of what was
  tested and pushes main itself.

## Git credentials

The repo and main are protected first. Workers never hold a credential that
can push main or change repo settings: they get a short-lived, repo-scoped
token per task (recommended: a GitHub App installation token the coordinator
mints), revoked with the worker, and a ruleset lets only the coordinator's
identity update main. How workers authenticate is asked in #281.

## Credentials

Agent credentials reach workers from the coordinator over the socket at
task start, kept in memory or tmpfs, never baked into an image, revoked on
`rm`. Delivery flows from `webappwiz/creds`, as a store. A comparison with a
secrets manager comes before it is built (#284).

## Scheduler, queue and budget

- Placement: a local slot, then an existing remote worker, then a newly
  provisioned one if the budget allows; otherwise the task queues, visibly,
  with its position, wait and reason. First come, first served, and the
  user can reorder the queue.
- A task prefers the worker holding its checkout. Workers advertise their
  platform (Linux or macOS); a project may require one in `arbor.config.ts`.
- A task waiting on the user holds its slot while its agent is live; when
  the agent idles out (30 min) the slot frees, and the answer queues it
  again. When its worker is removed, it checkpoints, pushes and frees the
  slot.
- A heavy-job cap per worker (test runs, installs, browser launches) turns
  contention into queueing.
- Every limit the user sets is in dollars: a $/hour rate cap, and $/day and
  $/month limits each with a warning threshold and a hard stop. Specs are
  secondary detail. A queue offers a priced one-click raise; `arbor budget`
  does the same.
- Workers are a budget of their own, beside scry's `som` and `llm`; agent
  API spend stays out for now. Reaching 80%, 90% and 100% of any limit is
  loud: a Web Push each and the header. A hard stop places nothing new, and
  running tasks stop at their next checkpoint.
- A worker's idle time is shared across the tasks that ran on it that hour.
- Reuse scry's window maths (`Budgets.standing`/`allowance`, `Limit[]`,
  raise and pause in `packages/cli/scry`), not its ledger: scry counts
  integer tokens per fixed role in a per-device JSON file with no warning
  tier in its logic. Spend is a coordinator ledger keyed by project and task
  (slot-hours), marked estimate (list price) or billed.
## Provisioning

Provisioned workers go through a `WorkerProvider` (create, destroy, list,
price per hour per type) in `arbor.config.ts`, the way `TunnelProvider` is,
with a fake for tests. Everything provisioned must be Pulumi-supported: the
first real provider drives a Pulumi stack through the Automation API, and
the cloud coordinator's box is a Pulumi program too. Workers boot from a
snapshot arbor builds and refreshes, and scale to zero.

## Updates without waiting

The coordinator restarts on its own: agents, terminals and dev servers belong
to workers, which keep running and reconnect, and replay fills the gap.
UI-only changes rebuild the page and push it to open tabs. Worker builds roll
out one worker at a time by drain and resume, never re-adopting live agents;
new tasks go to updated workers first; the pool view, a Workers page in the
nav, shows each worker's build.

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
about $55/month typical and $86 at peak, coordinator included. These
predate the Pulumi requirement; the provider is chosen again in #289.

## Delivery

Phases merge independently; the single-Mac setup works after each.

1. Protocol: local worker as its own process, remote launch, terminals and
   proxying through it, `arbor worker list`, a restartable coordinator.
2. Durability and merge: repo state over the relay, the central remote,
   checkpoint pushes, the merge lease, clone-based checkouts.
3. Registered workers: join tokens, add/drain/rm, the pool UI, the visible
   queue, proven with a Linux container as a second worker.
4. Provisioning and budget.
5. Cloud coordinator, near New Jersey, backed up by nightly provider
   snapshots; the Mac becomes a registered worker while awake, managed from
   the Workers page.

Before phase 1: a shared browser and the heavy-job cap, on their own.

## Open

Asked when their todo starts:

- How the local worker starts: the supervisor or launchd (#273).
- How workers authenticate to GitHub (#281).
- Credential delivery against a secrets manager (#284).
- Which Pulumi-supported cloud and region for workers, and what one warm
  worker costs (#289).
- Where the cloud coordinator runs, near New Jersey (#295).

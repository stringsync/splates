# splates server on a pool of workers

`splates server` splits into a **coordinator** and **workers**, so more
conversations run at once than one machine holds, and splates can run always-on
without a laptop. The question/answer UX does not change: distribution is
plumbing.

All of it is public, and none of it closes off running it as a hosted
service later (see [splates.md](splates.md)); nothing hosted is built now.

Each todo in the worker lanes points here. Decisions marked *settled* were made
with the user; those under *Open* are asked when their phase starts, never
decided by the agent alone.

## Roles

- **Coordinator**: the page, the scheduler, the merge lease, proxying, and all
  persistent splates state (outcomes, roster, projects, `.git/splates`). Today
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
- offer its agents' sessions the MCP servers it runs, its shared browser
  among them, on its own loopback (the `servers` call, protocol 1.2);
- push the task's branch;
- heartbeat; drain and tear down.

## Protocol (settled)

- A worker daemon (`splates worker run`) dials **out** to the coordinator's
  `/api/workers` WebSocket and multiplexes every channel over it. Workers
  never listen on a public port.
- The local worker speaks the same protocol to a coordinator on the same
  machine, as **its own process**, over a Unix socket in `SPLATES_HOME`
  guarded by file permissions. One code path; local and remote cannot
  drift. The supervisor starts it beside the server, as
  `splates worker run --id local --quiet`, starts it again a second after it
  ends, and stops it on quitting `splates server`; a server restart or update
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

The agent's own `splates` commands (add, todo, escalate, merge, attach, creds)
write `.git/splates` directly today. Repo state goes behind an interface:
files when local, an HTTP API to the coordinator when remote. The worker
opens a **loopback relay port** forwarded over its socket; `SPLATES_DEV`
points at it, so callbacks and repo-state calls both reach the coordinator.
"Local" means on the coordinator's own machine: once the coordinator is in
the cloud, `splates` run by hand on the Mac reaches repo state through the
Mac's own worker daemon, so a machine holds one credential, its worker's.

How it is built (todo #12). The interface is the filesystem: `openRepository`
hands every class an `Fs` that sends paths under `.git/splates` to the
coordinator, one `POST /api/state` per call, confined there, and everything
else to the local disk, so records, todos, the journal and attachments read
and write as before, and the page's watches still fire. A checkout uses it
when it has no `.git/splates` and a relay is found: `SPLATES_DEV`, else the
`relay.json` the worker daemon writes in `SPLATES_HOME`. The project is
`SPLATES_PROJECT`, which the coordinator gives each agent, else the one
whose origin URL the checkout shares. Locks are `FileLock`'s directories
taken through the relay, and a command keeps its locks and task leases
fresh while it runs, since a holder on another host is judged by age. The
relay is protocol 1.1's `relay` channel: the worker listens on loopback and
opens one per connection, the coordinator pipes it into its own server, and
a process the worker starts finds the relay as its `SPLATES_DEV`.

## Task ports (settled)

Assume nothing of Cloudflare but Access. Any port a task's processes listen
on is found and forwarded automatically, as VS Code and Codespaces do, and
never without Access. splates routes by `Host` header under a wildcard base
host saved per machine (`splates server --ports-host`), `<task>-<port>.<base>`;
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
  branch is pushed there as `splates/<task>` after every commit and at every
  checkpoint, and deleted on merge or remove. A checkpoint commits the
  working tree first, as a WIP commit the agent squashes before merging, so
  a worker that dies or is removed by force loses nothing past its last
  checkpoint; `SPLATES.md` syncs to the
  coordinator as repo state at the same moments and never lands on main. The
  plan (intent) and the commits (done work) are durable together; a fresh
  worker clones the branch and resumes.
- The merge lock becomes a lease held by the coordinator. The worker takes
  it, fetches trunk, rebases, runs the hooks locally, and pushes the tested
  `splates/<task>`; the coordinator checks it is a fast-forward of what was
  tested and pushes main itself.

How the merge lease is built (todo #13). The lease is `merge.lock` on the
coordinator's disk, so it outlives a restart: a merge on the coordinator
takes it there, one on a worker through `/api/state`, as a `RelayLock`
either way, whose holder beats every third of `leaseStalenessMs`. A holder
on the same host is judged by its pid, one elsewhere by its beat, so a
worker that dies frees it within 90 s and a long test run on either side is
never stolen. With `remote` configured, a merge onto trunk fetches the
remote's trunk (`TaskBranches.fetchTrunk`, with the task's token), rebases
onto that commit, runs the hooks, pushes `splates/<task>`, and asks the
coordinator to land it (`TrunkLanding`: in-process on the coordinator,
`POST /api/land` from a worker). The coordinator checks the asker still
holds the lease, that the remote's trunk is still the tested commit, and
that `splates/<task>` is the tested head and a fast-forward of it, then
pushes trunk with its own credentials as `--force-with-lease` against that
commit, and fast-forwards its own trunk checkout. A refusal there is a
`merge_failed` that spends an attempt. A coordinator whose trunk holds
commits the remote lacks refuses to merge until they are pushed. Without
`remote`, and for parts landing on a task's branch, a merge lands locally
as before.

How clone checkouts are built (todo #14). A task's checkout goes behind
`Checkouts` (`checkouts.ts`): `WorktreeCheckouts` on the coordinator's
machine, `CloneCheckouts` in a checkout reached through the relay, so a
remote worker clones and the local one keeps worktrees. Before an agent
starts on a remote worker, `materialize` mints a token and asks the worker
(the `checkout` call) to fetch, or make, `<SPLATES_HOME>/worker/mirrors/<slug>.git`
and a clone of trunk beside it in `worker/projects/<slug>/<repo>`, which
names the mirror in its config (`splates.mirror`) and is answered by its
canonical path, the agent's working directory. `splates add` there clones
the task from the central remote with `--reference-if-able` the mirror,
checks out `task/<task>` and makes its base a local branch, and names the
project clone as its home (`splates.home`), which `openRepository` takes as
the main tree. The record names the worker (`machine`, from
`SPLATES_WORKER`, which `RemoteWorker.start` sets, else `relay.json`), and
`Worktree.git` reads the task's branch in its clone: on the worker
directly, on the coordinator through that worker (`workerGit` over
`WorkerMachine.git`), so the page reads it as any task; a worker that has
not joined is taken to hold it still. `splates claim` on a worker whose
record points elsewhere, or whose clone is gone, clones the task again from
`splates/<task>`. Every push runs in the tree the branch is in
(`TaskBranches.pushTree`, and `pushOnMove` in the tree the command ran in,
on its machine). Tokens never touch a worker's disk: the coordinator sends
one over the socket in a git call's environment, and a command on the
worker asks for one through the relay (`POST /api/token`, `RelayApp`),
minted for the project's own repository alone and held in that process's
memory. `SPLATES.md` is not in the clone it resumes into until #69 syncs it.

How an agent starts there (remote-placement). A worker says
`checkouts: true` in its hello, so placement may send it agents; only those
other agents start ever are. Once a slot on a remote worker is granted, the
`Placement` carries that worker's `WorkerMachine`, and `PlacedCheckouts`
(`WorkerPlacement`) says where the agent opens: its task's clone when the
record names that worker and the clone is there, else the project's clone
`materialize` readies, from which the agent's `splates claim` clones the
task again; a task still a worktree here is pushed to `splates/<task>`
first. The conversation keeps the worker it was placed on: `Watch` runs its
git there, rooted at the clone, so `pushOnMove` pushes from it, and
background output is read there. A task whose record names a worker is not
taken for landed when its directory is missing here. Not yet: taking back,
after a coordinator restart, an agent still running on a remote worker
(`Conversation.read` resumes only through the local launcher).

## Git credentials

The repo and main are protected first. Workers never hold a credential that
can push main or change repo settings: they get a short-lived, repo-scoped
token per task (recommended: a GitHub App installation token the coordinator
mints), revoked with the worker, and a ruleset lets only the coordinator's
identity update main. How workers authenticate is asked in #281.

## Credentials

Agent credentials reach workers from the coordinator over the socket at
task start, kept in the worker daemon's memory alone, never baked into an
image or written to disk, revoked on remove. Each worker gets API keys of
its own from each provider's console, each with its own spend limit, rather
than a share of the user's seats: seats are per person, and the agent CLIs
sign in per user (#305).

Settled against a hosted secrets manager such as AWS Secrets Manager
(#284): it would put a second, standing credential on every worker (an IAM
key, on disk for a home machine), cost per secret, and couple splates to one
cloud, while workers cannot start a task without the coordinator anyway.

Agents never see a key. An agent's environment and files are one `env`
away from the agent, so the daemon runs a loopback credential proxy per
task that adds the real key, and the agent CLI gets a placeholder key and
its provider's base URL pointed at the proxy (`ANTHROPIC_BASE_URL` and the
like). The proxy forwards to its provider alone and refuses a request
without its own placeholder. The daemon makes itself undumpable
(`PR_SET_DUMPABLE` 0 on Linux) so an agent running as the same user cannot
read its memory, and Linux workers run agents in containers. The
memory-only store, the proxy and the undumpable helper belong to
`webappwiz/creds` (webappwiz #402); splates delivers through them (#93).

## Managing the pool

- `splates worker add --local N` makes this machine a worker with N slots;
  `splates worker add` mints a join token, single use and good for 15
  minutes, for `splates worker run --coordinator <url> --join <token>` on
  any machine. Spending it (`POST /api/workers/join`) answers a key of the
  worker's own, which it keeps in its system store (or `SPLATES_WORKER_KEY`
  where there is none) and shows as `Authorization: Bearer <id>:<key>` on
  every upgrade of `/api/workers`; a worker without one, or whose hello
  names another id, is refused. Joining again under an id revokes its old
  key. Each joined worker also gets a Cloudflare Access service token of its
  own, minted with the join token by the API token `splates tunnel setup`
  keeps, carried inside the join token so the join itself passes Access,
  kept in the worker's store beside its key, and sent as the
  `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on the join
  and every upgrade (#92). Access lets it in by a Service Auth policy,
  `<app> workers`, listing each worker's token and no other. Both are
  revoked on remove, the token too when a join token runs out unused. The registry, with only each key's and token's sha256, persists
  across coordinator restarts in `~/.splates/workers.json`.
- `splates worker drain <id>` takes no new tasks and lets in-flight ones
  finish (`--undo` takes them again); `splates worker slots <id> <n>`
  changes how many it runs at once. `splates worker remove <id>` drains
  first and is done once its agents end; `--force` ends them now, frees
  their slots, and is to requeue each task from its last pushed checkpoint
  (#94). Either way the worker's key is revoked. Removing the local worker
  (*settled*, #95) leaves the machine coordinator only, across restarts, and
  takes no `--force`: its agents run to their end. Its process stays, since
  the page's shells and task ports run on it; `splates worker add --local
  <n>` brings it back.
- A Workers page in the nav shows each worker (kind, platform, slots,
  health, build, tasks, $/hour) with the same actions as the CLI, and turns
  this Mac on and off as a worker, after the coordinator moves to the cloud
  too.
- Home workers: the two Windows machines run the Linux worker unchanged in
  WSL2, joined by a one-line PowerShell installer, started at boot by a
  scheduled task, and shown as `linux (wsl2)`. They may sleep when idle;
  the coordinator marks them asleep, not gone, and wakes one with a
  Wake-on-LAN packet sent from the Mac or any awake worker on that network
  when the queue needs it. They are extra capacity at $0/hour, never the
  only capacity (#302, #303).

## Scheduler, queue and budget

- Placement: a free slot on an awake worker (the local one, then a
  registered one, then one already provisioned), then waking a sleeping
  registered worker, then a newly provisioned one if the budget allows;
  otherwise the task queues, visibly, with its position, wait and reason.
  A wake that has not checked in within a time limit falls through to
  provisioning, so a home machine never holds the queue up. First come,
  first served, and the user can reorder the queue.
- Slots cap the agents other agents start (*settled*): those `splates add
  --agent` or a lane's orchestrator hand out. An agent the person starts
  goes on any worker up, however full, and counts against no slot, waiting
  only while none is (as with the local worker removed); by default a
  worker caps the rest at 16 (`splates server --worker-slots`).
- A task prefers the worker holding its checkout. Workers advertise their
  platform (Linux or macOS); a project may require one in `splates.config.ts`.
- A task waiting on the user holds its slot while its agent is live; when
  the agent idles out (30 min) the slot frees, its dev servers stop with
  it, and the answer queues it again, which brings its ports back. When its worker is removed, it checkpoints, pushes and frees the
  slot.
- A heavy-job cap per worker (test runs, installs, browser launches) turns
  contention into queueing.
- Every limit the user sets is in dollars: a $/hour rate cap, and $/day and
  $/month limits each with a warning threshold and a hard stop. Specs are
  secondary detail. A queue offers a priced one-click raise; `splates budget`
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
price per hour per type) in `splates.config.ts`, the way `TunnelProvider` is,
with a fake for tests. Everything provisioned must be Pulumi-supported: the
first real provider drives a Pulumi stack through the Automation API, and
the cloud coordinator's box is a Pulumi program too. Workers boot from a
snapshot splates builds and refreshes, and scale to zero.

The provider built is self-hosted: the Pulumi provider in the user's own
cloud account, with their API token as a cred. The interface still assumes
nothing of where cloud credentials live or where Pulumi runs, so a hosted
provider calling a remote API could sit behind it later without changing
it (settled; see [splates.md](splates.md)). A provider's price per hour is
what the user pays, so the budget would count the same dollars either way.

## Updates without waiting

The coordinator restarts on its own: agents, terminals and dev servers belong
to workers, which keep running and reconnect, and replay fills the gap.
UI changes reach open tabs only with that restart, which builds the page
again, so a tab never reloads while in use or runs ahead of its server. Worker builds roll
out one worker at a time by drain and resume, never re-adopting live agents;
new tasks go to updated workers first; the pool view, a Workers page in the
nav, shows each worker's build.

How a restart keeps its agents (built 2026-10-17, todo #279). Each
coordinator answers its workers by one session id, kept with the roots and
shells it let go of in `~/.splates/coordinator.json`, so the next run is the
same coordinator to them and they keep every channel. A conversation's log
stamps each entry with the seq of the agent's frame being handled, and the
coordinator acks a frame only once the log holds it, so the worker replays
from exactly where the log leaves off; the log also records every request
id this side sent, so the new run's ids start past them and a late answer
to the open prompt is told apart and ends the turn once. A restart detaches
at a frame boundary, flushes the logs, waits a bound for acks, and hangs up
without closing anything; the next run serves those roots and takes their
shells back before the worker joins, since the worker's hello settles which
channels live on, and ends a channel it kept that nobody took back. A
page's shell is keyed by its tab and conversation, kept two minutes after
its socket goes, and redrawn from the worker's screen buffer for the page
that comes back. Power's Restart is at once; the checkpoint tick is a
shutdown's, which ends everything as before.

That makes the log, the frame numbering and the worker protocol formats a
restart reads across versions: a change to any of them has to stay readable
by the next run, or the restart that deploys it loses the agents mid-turn.

Each is stamped, so a restart that cannot read one declines to resume rather
than resuming it wrongly:

- **The conversation log** (the `launched`, `request` and `ask` entries and
  every entry's `seq`) and **the frame numbering** of `AgentStream` carry
  `LOG_FORMAT` (`conversation-log.ts`), stamped on `launched`; a missing
  stamp is format 1. `ConversationLog.replay` stops a live log of another
  format with an error saying so, and the agent's process is let go.
- **The worker protocol's channel seqs and `held`** carry `WorkerProtocol.version`,
  which `coordinator.json` records as `protocol`. `WorkerSession.takeBack`
  drops the channels it was to take back when that major is not the
  running one's.

To bump one, change the format and raise its number in the same change: the
major of `WorkerProtocol.version` (a minor negotiates by capability and
never touches channels), or `LOG_FORMAT`. The restart that deploys it then
ends the agents mid-turn once, instead of misreading them.

A worker also bounds how long it keeps what a coordinator left. When the
coordinator's session is lost, the worker (`WorkerDaemon`) starts
`orphanBound`, ten minutes, and a coordinator that connects again cancels it.
If none does, the worker ends every channel it held, which kills each agent
and shell. Ten minutes is longer than a restart or a network blip, which take
seconds, and shorter than a forgotten evening, in which a stopped coordinator
would leave agents burning slots and tokens on the turn they were in. A
coordinator that returns under a new session id ends the old session's
channels at once (`WorkerSession.forget`), without waiting for the bound.

## Sizing

Measured 2026-10-16 on an M4 Max (16 cores, 64 GB) with ~8 live sessions;
macOS RSS double-counts shared pages.

- Agent session at rest (ACP adapter, claude, playwright-mcp): 0.6–0.7 GB,
  0–7% of a core.
- Full headless Chrome per session: ~0.95 GB with one page. One shared
  chrome-headless-shell: 154 MB plus ~120 MB per context.
- Per-task preview server: ~0.35 GB.
- `splates dev test` (preMerge, also run mid-task): 31–33 s wall, 220 CPU-s,
  ~7 cores, 7.2–7.4 GB. In a Linux container on the same Mac (Docker
  Desktop, 16 vCPU / 31 GB, measured 2026-10-17): 29–39 s wall, 260–340
  CPU-s, 6.4 GB peak, the higher figures with another test run on the host.
- `bun install`: 0.8 s warm cache, 14.6 s cold.
- splates server: ~0.6 GB with 7 sessions.

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
   proxying through it, `splates worker list`, a restartable coordinator.
2. Durability and merge: repo state over the relay, the central remote,
   checkpoint pushes, the merge lease, clone-based checkouts.
3. Registered workers: join tokens, add, drain and remove, the pool UI, the visible
   queue, proven with a Linux container as a second worker
   (`docker/prove-worker.sh`: a scripted agent placed on the container
   claims its task there, serves a port the coordinator forwards, opens it
   in the worker's own shared browser, and merges).
4. Provisioning and budget.
5. Cloud coordinator, near New Jersey, backed up by nightly provider
   snapshots; the Mac becomes a registered worker while awake, managed from
   the Workers page.

Before phase 1: a shared browser and the heavy-job cap, on their own.

## Open

Asked when their todo starts:

- How workers authenticate to GitHub (#281).
- How each worker's API keys are made and kept per provider (#305).
- Which Pulumi-supported cloud and region for workers, and what one warm
  worker costs (#289).
- Where the cloud coordinator runs, near New Jersey (#295).

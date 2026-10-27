# splates server on a pool of workers

A record of a design that was built and then mostly taken back: what it was,
what stays of it, and what replaced the rest.

## Built and superseded (2026-10-23)

The later decision went further than the original plan below. Runners are
removed entirely, including from `splates dev`: no job pool, direct runner,
Fly integration, cloud config, runner image, compiled Linux binary or
runner proof remains. Billing has no Fly source and ignores historical
runner and job spend rows. Old credentials and cloud state on disk are
left untouched.

Remote workers, joining, provisioning, budgets, snapshots, recipes and the
Linux sandbox are also removed. Only this machine's `local` worker and its
replayed Unix-socket protocol remain. The merge gate runs on the host, one
premerge at a time. Agents keep checks scoped and ask for other heavy work
with the run-command permission card (the lane "Ask before heavy commands").
The following sections record the earlier decisions, not current behavior.

## What it was

From 2026-10 `splates server` was split into a **coordinator** (the page, the
scheduler, the merge lease and every record) and **workers** that ran whole
tasks: the checkout, the agent, its browser, dev servers and test runs. A
worker dialed out to the coordinator and never listened on a public port.
Remote workers kept a mirror and a clone per task, pushed `splates/<task>`
as they went, reached the coordinator's records through a loopback relay
with a per-agent project-scoped secret, were sent provider API keys in
memory (task keys, a credential proxy), served PTYs and task ports back down
their socket, and could be woken over Wake-on-LAN. The scheduler placed an
agent on the local worker, then a registered one, then a made one, by
platform, key and the checkout it held, and provisioned workers when the
queue outran the slots. The cloud history: Hetzner, then DigitalOcean, then
AWS with Pulumi, then none.

## What replaced it (settled 2026-10-22)

Remote agents are no longer a thing. The coordinator, the Mac for now, runs
every agent, every worktree, all git and GitHub, the merge, the shared
browser and dev servers. No agent ran remotely in practice, and every
remote path was a second shape to carry through each change. Cloud boxes
come back only as stateless **runners** for heavy jobs (tests, installs,
the merge gate), lane 66: a snapshot commit shipped as a bundle, run, and
streamed back.

Removed with it: remote checkouts and clone-based worktrees, git and records
over the relay, task pushes of `splates/<task>`, the worker's path to land
through the coordinator, task keys and relay scopes, worker API keys, port
forwarding and remote PTY hosts, waking (Wake-on-LAN, keep-awake, the WSL2
installer), placement on workers (platforms, `--worker-slots`, a task
preferring the worker with its checkout), provisioning on the queue, and
`splates dev prove worker`.

## What stays, for the runners

- **This machine's worker** as the process host agents run under: its own
  process over a Unix socket in `SPLATES_HOME`, supervised by `splates
  server` (`splates worker run --id local --quiet`), so a server restart or
  update leaves agents running. The coordinator reaches git, processes, the
  process table and listening ports there through the worker's calls.
- **The protocol**: JSON control frames and binary data frames with
  per-channel seqs, kept until acked and replayed after a reconnect; the
  hello names each end's session and carries `protocol: major.minor` with
  capabilities, a minor negotiating and another major drained.
- **The ACP client in the coordinator**: `RemoteLaunch` implements `Launch`
  over the protocol, so conversation logic versions with the coordinator.
- **Joining**: single-use join tokens good for 15 minutes, a key per worker
  in its system store, a Cloudflare Access service token per worker through
  a tunnel; the registry keeps only hashes, in `~/.splates/workers.json`.
- **Provisioning and budget**: `WorkerProvider` (create, destroy, list, price
  per type), snapshots built from `splates worker recipe`, reconcile, idle
  retirement, and a dollar budget (a $/hour rate cap, $/day and $/month
  limits with warnings and a hard stop) on the Billing page, which becomes
  the runner budget.
- **Rollouts**: a worker on another build than the coordinator's drains and
  is brought to it, one at a time. Settled 2026-10-27: as this machine's own
  drains, the server starts a handoff worker, `local-<build>`, on its build
  beside it, tied to the supervisor as its own is, and new agents go there,
  so a release never holds them up. Once `local` is back on the build, the
  handoff worker takes no new agents and stops once its last one ends.
- **Slots**: the local worker's slots cap the agents other agents start;
  an agent the person starts takes none.

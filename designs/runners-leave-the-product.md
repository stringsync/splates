# Runners leave the product

A design record, decided with the user on 2026-10-22 in a design talk
after the runner work of that week (Fly machines reached through the proxy,
the job pool, the keeper, budgets, the release binary and bootstrap). It
records what was settled and what is open; the lane that carries it out is
named at the end, and this file gains dated "built" paragraphs as it lands.

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

## The decision (settled)

**Runners and cloud provisioning leave the product.** What splates promises
is many agents on one repo, each in a worktree, landing on trunk without
pull requests. The one thing that needs tests run is the merge gate, and the
product's whole story for that is `preMerge`: a command, run on the host in a
heavy-job slot. A user whose suite is too heavy for the host writes
`preMerge: "./scripts/test-elsewhere.sh"` and owns the rest: ssh to a box, a
CI dispatch, whatever fits them. splates makes no machine, keeps no pool,
reaches no runner and sets no cloud budget for anyone.

**Fly becomes this repository's own test runner.** Runners exist because
splates's own suite is heavy (1,285 tests, 40 s at 8 workers on a 16-core
Mac, 90 s on a 4-CPU Fly machine), and with several agents merging at once
that saturates the host. That is a fact about this repository, so the
machinery moves under `splates dev`, which holds only this repository's own
commands: `splates dev test` (unfiltered), `splates dev premerge` and a
`splates dev run` for other heavy work make and reach Fly machines as the
runner work started to. None of it is exported from the server package,
documented for users, or on a page.

**Billing stays, Fly one cost source among many.** The Billing page keeps
its promise that every paid machine shows its cost, per machine with
history, and never a hand-entered or a zero-for-unreachable number
(`notes/billing-pulled-only.md`). Fly's provisioning leaves the product; its
*cost* does not: `spend/` knows Fly by what it bills and estimates, as it
knows model prices and plans, and nothing on the page knows how a machine is
made. Task #1094 shapes the interface a cost source implements, Fly one
implementation of it.

## What was weighed and set aside

- A user-supplied `RunnerFleet` interface in `splates.config.ts` (list,
  wake, make, destroy) with a `LocalRunners` default: too much interface for
  what it buys. Once the user owns the machines, the honest contract is
  "run this command", which `preMerge` already is.
- `splates run` kept in the product against a fixed list of machines the
  user runs: it would keep the pool, the wire protocol and the reach logic
  in the product for a feature most projects never need.

## What leaves the product

- `splates run`, `splates runners serve` and `splates runners delete` as
  user-facing commands; the `job` and `cloud` settings of
  `splates.config.ts`; `WorkerProvider`'s runner half (`reach`, `asleep`,
  `running`) and `CloudWorkers`.
- `JobPool`, `RunnerKeeper`, `RunnerDialer`, the provisioning sweep, the
  `kept` cap, `splates budget set runners/day/month/idle/kept` and the
  runner budget's warnings; the `jobs` fields of `GET /api/workers`.
- The Runners page and the job widget's runner wait reasons, with the
  Runners section of Billing replaced by whatever #1094 gives Fly.
- Cloud provisioning of agent machines, by the same reasoning: `splates
  worker add --provider`, `CloudWorkers` for agents, snapshots, recipes and
  the builder. `splates worker join` on a machine the user set up stays the
  product.
- From the agent skill: the rule that heavy work goes through `splates
  run`. It becomes: a whole suite is the merge gate's; a test file or two is
  fine on the host.

## What stays

- Heavy-job slots and the core budget (`notes/heavy-jobs-and-cores.md`): a
  host-side concern that is still real.
- `prepare` and the job channel (snapshot commit, bundle, streamed output and
  files, timeout), since `splates dev test` and `dev premerge` use them, but
  as internals of `splates dev`.
- The release's compiled Linux binary and the sh bootstrap, as what a dev
  runner boots; they are useful to anyone and cost nothing to keep.
- `splates dev prove runner`, as the check that the dev runner still works.

## Order (settled)

The open runner tasks land first: they build what moves, so none of their
work is thrown away, only re-homed. Then one lane, each task blocked by what
it needs:

1. Move the job pool, keeper, Fly provisioning, `run` and `runners serve`
   under `splates dev`, unexported.
2. Remove the product surfaces: pages, budgets, routes, config settings.
3. Agent-machine cloud provisioning leaves, keeping `worker join`.
4. Rewrite the skill's heavy-work rule, CLAUDE.md, and the notes.

#1094 (the billing interface) runs beside the lane in its own, since its
timing depends on what the lane leaves of `spend/`.

## Open

- Whether `splates dev run` keeps the pool's placement (wait for a busy
  machine or make one) or makes one per job: decided in task 1 by what the
  dev commands need, since no one else sees it.
- What the Billing page shows for Fly between the lane landing and #1094:
  the Runners section as it is, read from `spend.jsonl`, until #1094
  replaces it.

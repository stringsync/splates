# @webappwiz/arbor

Runs several AI coding agents on one repository at once — each in its own git
worktree, landing on `main` without pull requests.

```bash
bunx @webappwiz/arbor <command>
```

Each agent drives its own landing. It works in a worktree, then calls
`arbor graft` to get that work onto trunk. If grafting fails, the failure comes
back to that same agent, in the same conversation, which fixes it and calls
`graft` again. There is no daemon, no queue, no orchestrator.

Two rules make that safe:

1. **arbor never spawns an agent.** Agents exist because a human opened a
   thread. arbor is a set of deterministic verbs over git and disk — no LLM
   calls, no knowledge of who is running.
2. **Agents never run raw git for these operations.** Every state transition
   goes through an arbor command. Exit codes and stderr are the interface the
   agent reasons about.

Conflicts between agents are expected, not a process failure. Discarding a task
and redoing it against current trunk is cheap and often better than a hard
rebase — that is what `prune` is for.

## Commands

### `arbor create <task>`

Creates the workstream: branch `task/<task>`, a worktree at
`../<repo>-arbor/<task>`, and a state record.

A fresh worktree shares no untracked files with the repo — no `node_modules`,
no `.env` — which is what `postCreate` is for.

If the hook fails the worktree stays; fix it and re-run the hook by hand.

### `arbor claim <task>`

Takes ownership of an existing worktree. **This is the resume entry point**: a
fresh agent thread picking up dead work starts here.

Prints the worktree path, status, uncommitted changes, and — loudly — any
half-finished rebase or merge the tree is standing in. Refuses if another agent
holds a live lease. A worktree with no record is rebuilt rather than rejected.

### `arbor graft`

Lands the current worktree's branch on trunk. The core command.

**Despite the name this never runs `git merge` in the merge-commit sense.** It
rebases onto trunk, runs the tests there, and fast-forwards trunk. History stays
linear; there is no merge commit to reason about.

1. Refuses if the worktree is dirty, out of retry budget, or leased elsewhere.
2. Takes the graft lock — **blocking**, polling every 2s. Blocking is
   deliberate: telling an agent "busy, try later" invites it to go edit more
   code in a branch that is supposed to be frozen.
3. `git rebase <trunk>`, then the test command, **in that order**. A branch that
   passed before rebasing says nothing about whether it works against current
   trunk; this is the only defense against semantic conflicts, where both sides
   merge cleanly and the combination is broken.
4. Re-checks the lease, then `git checkout <trunk> && git merge --ff-only`.

On conflict the rebase is **left in progress** — the agent needs the markers.
Resolve, `git add`, `git rebase --continue`, `arbor graft` again. On test
failure the branch is reset to where it was and trunk is never touched.

There is deliberately no flag to skip the test gate.

### `arbor prune <task>`

Discards a workstream: worktree, branch, and record. Unrelated to
`git worktree prune`, which only tidies stale metadata.

Use it freely. Warns about commits that never landed, but never blocks —
throwing work away is the cheap escape hatch, not a last resort.

Pruning leaves a tombstone in `.git/arbor/pruned/` so a second `prune` can say
`already_pruned` rather than `not_found`. The ledger keeps the 50 most recent
and drops the oldest as new ones arrive, so a long-forgotten task reports
`not_found` again.

### `arbor ls [--json]`

Every workstream: task, status, lease (`live`/`cold`/`none`), branch, commits
ahead of trunk, age. A corrupt record shows as `unknown` instead of taking
down the listing; a record whose worktree vanished shows as `orphaned`.

### `arbor escalate <reason> [--task <name>]`

The explicit "this needs a human" exit. Records the reason, drops the lease, and
leaves the worktree **exactly** as it is so the human sees what the agent saw.

This exists so an agent has a way out that is not "resolve the conflict badly to
finish the task". Agents are reliable at mechanical conflicts — both sides added
imports, a signature changed on one side and its callers on the other — and
unreliable when both sides restructured the same logic, because then there is no
correct merge, only a decision.

## Exit codes

The agent's control flow runs on these.

| Code | Reason              | Meaning and what to do                                            |
| ---- | ------------------- | ----------------------------------------------------------------- |
| 0    | —                   | Success.                                                           |
| 1    | `usage`             | Bad task name, bad flags, or an unexpected git failure.            |
| 2    | `conflict`          | Rebase conflicted. **Rebase is still in progress.** Resolve, `git add`, `git rebase --continue`, graft again. |
| 3    | `tests_failed`      | Tests failed after the rebase. Branch rolled back, trunk untouched. Fix and graft again. |
| 4    | `lease_lost`        | Another agent took the tree mid-graft. **Stop. Do not retry.**     |
| 5    | `budget_exhausted`  | Out of graft attempts. `arbor escalate` or `arbor prune` and redo against current trunk. |
| 6    | `lease_live`        | Another agent is driving this tree.                                |
| 7    | `dirty`             | Uncommitted changes. Commit before grafting.                       |
| 8    | `not_found`         | No such task, or not run from a task worktree.                     |
| 9    | `hook_failed`       | `postCreate` failed. The worktree still exists; fix and re-run the hook. |
| 10   | `exists`            | Task already exists — `arbor claim` it, or `arbor prune` first.    |
| 11   | `orphaned`          | Record with no worktree. `arbor prune` it.                         |
| 12   | `merge_failed`      | Trunk could not be fast-forwarded (usually a dirty main worktree). |
| 13   | `already_pruned`    | This task was pruned earlier; nothing left to remove.              |

Every failure prints a one-line JSON object on **stdout** (`{"reason": ...}`,
plus fields like `paths` for conflicts) and the human explanation on **stderr**.

## Configuration

`arbor.config.ts` at the repo root, all keys optional:

```ts
export default {
	testCommand: "bun test",        // what graft runs after rebasing, via sh -c
	trunk: "main",
	worktreeRoot: "../myrepo-arbor",
	postCreate: "bun install && cp ../../myrepo/.env .env",
	leaseStalenessMs: 90_000,
	graftRetryCount: 2,
	pruneStorageCapacity: 50,       // pruned names kept, so prune can say "already pruned"
};
```

`testCommand` defaults to `bun run test` when the root `package.json` has a
`test` script, otherwise `bun test`. `postCreate` and `testCommand` both run
through `sh -c` in the worktree with `ARBOR_TASK` and `ARBOR_WORKTREE` in the
environment.

arbor does not allocate ports. Several worktrees running at once will collide on
whatever they bind, and the thing that binds — docker-compose, a dev server, a
test harness — is the only thing able to retry and release. `ARBOR_TASK` is in
the environment to derive a stable port from if a task needs one.

### Leases and locks

State lives in `.git/arbor/` — shared by every worktree, never tracked by git.
Records are written to a temp file and `rename()`d into place, so a concurrent
reader never sees half a file. The graft lock is `mkdir` on
`.git/arbor/graft.lock`: atomic everywhere, no dependencies, and it either
succeeds or fails with no check-then-write window. A holder that dies is
detected (dead pid, or a timestamp past `leaseStalenessMs`) and its lock is
stolen, loudly.

A lease is **live** when its heartbeat is fresh *and*, for a holder on this
host, its pid still exists. The pid check matters because every arbor command is
its own short-lived process: without it, a tree would stay locked for the whole
staleness window after a command that merely finished, and `create` would block
the `graft` that follows it.

### `git rerere`

Adding `git config rerere.enabled true` to `postCreate` is worth it. The cache
lives in `.git/rr-cache`, which every worktree shares — verified against two
real worktrees: a conflict resolved in one is replayed automatically in the
other. Git still leaves the file staged as `UU`, so the agent must confirm with
`git add` and `git rebase --continue`. Not enabled by default; opt in per repo.

## Retry budget

`graftAttempts` counts conflicts, failed test runs, and failed fast-forwards. It
exists because of a real livelock: an agent rebases onto trunk, another agent
lands during its test run, and it is stale again before it finishes. Under load
an unlucky agent can chase a moving trunk indefinitely. When the budget is gone,
escalate or prune — redoing the task against current trunk usually beats
retrofitting a rebase.

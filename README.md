# @webappwiz/arbor

Runs several AI coding agents on one repository at once, each in its own git
worktree, landing on `main` without pull requests.

```bash
bunx @webappwiz/arbor <command>
```

Each agent drives its own landing. It works in a worktree, then calls
`arbor merge` to get that work onto trunk. If merging fails, the failure comes
back to that same agent, in the same conversation, which fixes it and calls
`merge` again. There is no daemon, no queue, no orchestrator.

Two rules make that safe:

1. **arbor never spawns an agent.** Agents exist because a human opened a
   thread. arbor is a set of deterministic verbs over git and disk: no LLM
   calls, no knowledge of who is running.
2. **Agents never run raw git for these operations.** Every state transition
   goes through an arbor command. Exit codes and stderr are the interface the
   agent reasons about.

Conflicts between agents are expected, not a process failure. Discarding a task
and redoing it against current trunk is cheap and often better than a hard
rebase, and that is what `rm` is for.

## Commands

### `arbor add <task>`

Creates the task: branch `task/<task>`, a worktree at
`../<repo>-arbor/<task>`, and a state record.

A fresh worktree shares no untracked files with the repo (no `node_modules`,
no `.env`) which is what `postCreate` is for.

If the hook fails the worktree stays; fix it and re-run the hook by hand.

### `arbor claim <task>`

Takes ownership of an existing worktree. **This is the resume entry point**: a
fresh agent thread picking up dead work starts here.

Prints the worktree path, status, uncommitted changes, and, loudly, any
half-finished rebase or merge the tree is standing in. Refuses if another agent
holds the lease. A worktree with no record is rebuilt rather than rejected.

### `arbor merge`

Lands the current worktree's branch on trunk. The core command.

**Never a merge commit.** It rebases onto trunk, runs the tests there, and
fast-forwards trunk with `git merge --ff-only`. History stays linear.

1. Refuses if the worktree is dirty, out of retry budget, or leased elsewhere.
2. Takes the merge lock, **blocking**, polling every 2s. Blocking is
   deliberate: telling an agent "busy, try later" invites it to go edit more
   code in a branch that is supposed to be frozen.
3. `git rebase <trunk>`, then the test command, **in that order**. A branch that
   passed before rebasing says nothing about whether it works against current
   trunk; this is the only defense against semantic conflicts, where both sides
   merge cleanly and the combination is broken.
4. Re-checks the lease, then `git checkout <trunk> && git merge --ff-only`.
5. Discards the task (worktree, branch and record) exactly as `rm`
   would. The work is on trunk, so the tree has nothing left to hold, and
   `arbor ls` stays a list of live work rather than a graveyard of landed
   tasks. The agent's own directory goes with it, so the success message
   prints the main tree to `cd` back to.

On conflict the rebase is **left in progress**: the agent needs the markers.
Resolve, `git add`, `git rebase --continue`, `arbor merge` again. On test
failure the branch is reset to where it was and trunk is never touched.

There is deliberately no flag to skip the test gate.

### `arbor rm <task>`

Discards a task: `git worktree remove` plus the branch and the record.

For abandoning work that will never land. A successful `merge` already
discards its own tree. Use it freely. Warns about commits that never landed,
but never blocks: throwing work away is the cheap escape hatch, not a last
resort.

Removal leaves a tombstone in `.git/arbor/removed/` so a second `rm` can say
`already_removed` rather than `not_found`. The ledger keeps the 50 most recent
and drops the oldest as new ones arrive, so a long-forgotten task reports
`not_found` again.

### `arbor ls [--json]`

Every task: name, status, lease (`held`/`stale`/`none`), commits ahead of
trunk, age. A corrupt record shows as `unknown` instead of taking
down the listing; a record whose worktree vanished shows as `orphaned`.

### `arbor show <task> [--json]`

One task in full: the row `ls` would print for it, plus the `TODO.md`
its agent keeps at the worktree root and the reason behind an `escalated`
status.

```
alpha working
  branch:    task/alpha
  worktree:  /src/repo-arbor/alpha
  lease:     held
  ahead:     3  +82 -14
  age:       2h

TODO.md
# alpha
...
```

`ls` says a task exists; this says what it is doing. Like `path`, it takes no
lease, so reading another agent's tree cannot knock it off its own work the way
`claim` would. A task with no `TODO.md` is called out rather than passed over
in silence: it is the one thing that makes the work resumable.

A `TODO.md` that is there gets checked against the shape the agent skill
prescribes (`# <task>`, `## Goal`, `## Next` with something unchecked in it, a
`## Blocked` question once escalated), and anything off is printed under it.
Warnings only, never a refusal: the agent that wrote the file is the one that
runs `show` on it, and a rough TODO still beats none.

### `arbor wait <task> [--timeout 30] [--json]`

Blocks until a task stops moving, polling every 2s:

```
$ arbor wait alpha
gone alpha: merged or removed, nothing of it is left (waited 4m 12s)
```

Three things end the wait: the task disappears (`gone`, it merged or was
removed), it escalates, or it falls apart (`orphaned`, `stray`, `unrecorded`,
`unknown`). Anything else is still in flight and worth waiting for.

**This is what an agent does instead of starting work that overlaps a task
already in flight.** The overlap disappears when that task merges; starting now
buys a rebase conflict instead.

Running out of `--timeout` minutes (default 30) is a refusal (`timed_out`,
exit 14) not a result. A task still working after the whole budget is a
question for a human: keep waiting, work alongside it, or do something else.

Discarding a task removes its directory before its record, so a tree mid-merge
reads as `orphaned` for a moment. A broken status has to survive a poll before
`wait` believes it, which is why it does not report a landing as a wreck.

### `arbor log [--count 20] [--json]`

The last N things done here (`add`, `claim`, `merge`, `rm`, `escalate`),
oldest first, each with the task and how it ended (`ok`, or the refusal reason).

```
WHEN  ACTION    TASK   RESULT
2h    add       alpha  ok
1h    merge     alpha  tests_failed
1h    merge     alpha  ok
```

`ls` is what still exists; this is what happened. Entries outlive their tasks:
a successful `merge` and a `rm` both take the record with them, so this is
the only thing that remembers a task landed at all. The last 200 are kept
(`logCapacity`) in `.git/arbor/log.jsonl`.

### `arbor dev [--port 4269]`

`ls`, `show` and `log` as one page, which reloads itself when a task changes:

```bash
arbor dev            # http://localhost:4269
```

Every task gets a card carrying what `show` prints for it, `TODO.md` included,
with the log underneath. A poll every two seconds decides whether anything moved
and pushes to open pages over SSE, so a page left on a second monitor keeps up
with agents on its own. `age` is deliberately left out of that comparison: it
ticks every minute and would otherwise reload every page for nothing.

Read-only, and takes no lease, for the same reason `show` does not: driving a
task is what the CLI is for, and a button that took a lease would fight the
agent holding it.

### `arbor path [task]`

Prints one path and nothing else, so it composes:

```bash
cd "$(arbor path)"             # back to the main tree, from any worktree
zed -a "$(arbor path alpha)"   # read a task's work beside your own
git -C "$(arbor path alpha)" diff main...task/alpha
```

**This is how a human looks at an agent's work.** Moving between trees is `cd`
and nothing else. Worktrees are directories, not checkouts, so your main tree
stays on trunk while agents work and there is no branch to switch, nothing to
stash, nothing to switch back. Reading a task this way takes no lease, so it
cannot knock the agent driving it off its own tree the way `claim` would.

With no task it prints the main tree, which is the one path a process standing
in a worktree cannot otherwise name: git's `--show-toplevel` hands back the
worktree it is already in.

Refuses a task that does not exist, or one whose directory is gone, rather than
printing a path you cannot `cd` into.

### `arbor escalate <reason> [--task <name>]`

The explicit "this needs a human" exit. Records the reason, drops the lease, and
leaves the worktree **exactly** as it is so the human sees what the agent saw.

This exists so an agent has a way out that is not "resolve the conflict badly to
finish the task". Agents are reliable at mechanical conflicts (both sides added
imports, a signature changed on one side and its callers on the other) and
unreliable when both sides restructured the same logic, because then there is no
correct merge, only a decision.

## Exit codes

The agent's control flow runs on these.

| Code | Reason              | Meaning and what to do                                            |
| ---- | ------------------- | ----------------------------------------------------------------- |
| 0    | none                | Success.                                                           |
| 1    | `usage`             | Bad task name, bad flags, or an unexpected git failure.            |
| 2    | `conflict`          | Rebase conflicted. **Rebase is still in progress.** Resolve, `git add`, `git rebase --continue`, merge again. |
| 3    | `tests_failed`      | Tests failed after the rebase. Branch rolled back, trunk untouched. Fix and merge again. |
| 4    | `lease_lost`        | Another agent took the tree mid-merge. **Stop. Do not retry.**     |
| 5    | `budget_exhausted`  | Out of merge attempts. `arbor escalate` or `arbor rm` and redo against current trunk. |
| 6    | `lease_held`        | Another agent is driving this tree.                                |
| 7    | `dirty`             | Uncommitted changes. Commit before merging.                       |
| 8    | `not_found`         | No such task, or not run from a task worktree.                     |
| 9    | `hook_failed`       | `postCreate` failed. The worktree still exists; fix and re-run the hook. |
| 10   | `exists`            | Task already exists. `arbor claim` it, or `arbor rm` first.    |
| 11   | `orphaned`          | Record with no worktree. `arbor rm` it.                         |
| 12   | `merge_failed`      | Trunk could not be fast-forwarded (usually a dirty main worktree). |
| 13   | `already_removed`    | This task was removed earlier; nothing left to remove.              |
| 14   | `timed_out`         | `arbor wait` gave up: the task is still going. Ask the human what to do. |

Every failure prints a one-line JSON object on **stdout** (`{"reason": ...}`,
plus fields like `paths` for conflicts) and the human explanation on **stderr**.

## Configuration

`arbor.config.ts` at the repo root, all keys optional:

```ts
export default {
	testCommand: "bun test",        // what merge runs after rebasing, via sh -c
	trunk: "main",
	worktreeRoot: "../myrepo-arbor",
	postCreate: "bun install && cp ../../myrepo/.env .env",
	leaseStalenessMs: 90_000,
	mergeRetryCount: 2,
	removedCapacity: 50,            // removed names kept, so rm can say "already removed"
	logCapacity: 200,               // entries `arbor log` keeps before the oldest fall off
};
```

`testCommand` defaults to `bun run test` when the root `package.json` has a
`test` script, otherwise `bun test`. `postCreate` and `testCommand` both run
through `sh -c` in the worktree with `ARBOR_TASK` and `ARBOR_WORKTREE` in the
environment.

arbor does not allocate ports. Several worktrees running at once will collide on
whatever they bind, and the thing that binds (docker-compose, a dev server, a
test harness) is the only thing able to retry and release. `ARBOR_TASK` is in
the environment to derive a stable port from if a task needs one.

### Leases and locks

State lives in `.git/arbor/`, shared by every worktree, never tracked by git.
Records are written to a temp file and `rename()`d into place, so a concurrent
reader never sees half a file. The merge lock is `mkdir` on
`.git/arbor/merge.lock`: atomic everywhere, no dependencies, and it either
succeeds or fails with no check-then-write window. A holder that dies is
detected (dead pid, or a timestamp past `leaseStalenessMs`) and its lock is
stolen, loudly.

A lease is **held** when its heartbeat is fresh *and*, for a holder on this
host, its pid still exists. The pid check matters because every arbor command is
its own short-lived process: without it, a tree would stay locked for the whole
staleness window after a command that merely finished, and `add` would block
the `merge` that follows it.

### `git rerere`

Adding `git config rerere.enabled true` to `postCreate` is worth it. The cache
lives in `.git/rr-cache`, which every worktree shares, verified against two
real worktrees: a conflict resolved in one is replayed automatically in the
other. Git still leaves the file staged as `UU`, so the agent must confirm with
`git add` and `git rebase --continue`. Not enabled by default; opt in per repo.

## Retry budget

`mergeAttempts` counts conflicts, failed test runs, and failed fast-forwards. It
exists because of a real livelock: an agent rebases onto trunk, another agent
lands during its test run, and it is stale again before it finishes. Under load
an unlucky agent can chase a moving trunk indefinitely. When the budget is gone,
escalate or `arbor rm`: redoing the task against current trunk usually beats
retrofitting a rebase.

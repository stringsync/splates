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
rebase, and that is what `remove` is for.

## Commands

### `arbor add <task> [--base <branch>] [--todo <id>]`

Creates the task: branch `task/<task>`, a worktree at
`../<repo>-arbor/<task>`, and a state record.

`--todo <id>` takes up a todo (see `arbor todo`): its text becomes the plan's
`## Goal`, followed by the path of each file attached to it, and no other task
can take it while this one lives.

`--base <branch>` starts the task from that branch and lands it back there
instead of trunk. It takes another task's branch too: `--base task/<other>`
stacks this task on that one, and the work lands in that task's worktree
rather than on trunk.

A fresh worktree shares no untracked files with the repo (no `node_modules`,
no `.env`) which is what `postCheckout` is for.

If the hook fails the worktree stays; fix it and re-run the hook by hand.

Refuses a repo with submodules (`usage`). A worktree gets its own empty
submodule directories, so every task would have to bootstrap them before
anything builds, and arbor would rather say so than hand back a tree that does
not work.

### `arbor claim <task>`

Takes ownership of an existing worktree. **This is the resume entry point**: a
fresh agent thread picking up dead work starts here.

Prints the worktree path, status, uncommitted changes, and, loudly, any
half-finished rebase or merge the tree is standing in. Refuses if another agent
holds the lease. A worktree with no record is rebuilt rather than rejected.

Claiming an `escalated` task puts it back to `working`: someone is on it
again, and whatever it was waiting on is theirs to act on. Its merge budget
stays as it was. Only `retry` refills that, and only from `escalated`, so a
human granting a fresh budget does it before the agent claims.

### `arbor merge`

Lands the current worktree's branch on its base, trunk unless the task was
created with `--base`. The core command.

**Never a merge commit.** It rebases onto the base, runs the `preMerge` gate
there, and fast-forwards the base with `git merge --ff-only`. History stays
linear.

1. Refuses if the worktree is dirty, out of retry budget, or leased elsewhere,
   or while a person's reply waits unclaimed (`unread`: run `arbor replies`),
   or while a question under `## Blocked` is unchecked (`blocked`): whether
   nobody has answered it yet, or the agent has yet to act on an answer or a
   follow-up and check it off.
2. Takes the merge lock, **blocking**, polling every 2s. Blocking is
   deliberate: telling an agent "busy, try later" invites it to go edit more
   code in a branch that is supposed to be frozen.
3. `git rebase <trunk>`, then the `preMerge` gate, **in that order**. A branch that
   passed before rebasing says nothing about whether it works against current
   trunk; this is the only defense against semantic conflicts, where both sides
   merge cleanly and the combination is broken.
4. Re-checks the lease, then fast-forwards the base **in the worktree that has
   it checked out**: the main tree for trunk, or the other task's worktree for
   a `--base task/<other>` task. Git allows one worktree per branch, and that
   tree is the only place the branch can move: advancing the ref behind its
   back would leave its index and files on the old commit.
5. Discards the task (worktree, branch and record) exactly as `remove`
   would. The work is on trunk, so the tree has nothing left to hold, and
   `arbor list` stays a list of live work rather than a graveyard of landed
   tasks. The agent's own directory goes with it, so the success message
   prints the main tree to `cd` back to.

On conflict the rebase is **left in progress**: the agent needs the markers.
Resolve, `git add`, `git rebase --continue`, `arbor merge` again. When the gate
fails the branch is reset to where it was and trunk is never touched.

There is deliberately no flag to skip the gate: a repo that wants none
configures none.

A merge onto trunk ends by recommending what to do next: one todo, the task's
own follow-ups first and then the longest waiting, plus any todo older than
`todoStalenessMs` (30 days) offered for removal instead. The todos the task
took up with `--todo` leave the list, since that work is now done.

```
merged alpha onto main (1a2b3c4)
  worktree removed, cd /src/repo

next todo 7: retry the upload when the token expires
  from alpha, waiting 2h
  start it: arbor add <task> --todo 7

stale todos, remove unless they still apply:
  2: try the old parser again (41d)  arbor todo remove 2
```

### `arbor remove <task>`

Discards a task: `git worktree remove` plus the branch and the record.

For abandoning work that will never land. A successful `merge` already
discards its own tree. Use it freely. Warns about commits that never landed,
but never blocks: throwing work away is the cheap escape hatch, not a last
resort.

The todos it took up are open again, since the work they asked for was not
done.

Removal leaves a tombstone in `.git/arbor/removed/` so a second `remove` can say
`already_removed` rather than `not_found`. The ledger keeps the 50 most recent
and drops the oldest as new ones arrive, so a long-forgotten task reports
`not_found` again.

### `arbor list [--json] [--files]`

Every task: name, status, lease (`held`/`stale`/`none`), commits ahead of
trunk, age. A corrupt record shows as `unknown` instead of taking
down the listing; a record whose worktree vanished shows as `orphaned`.

`--files` adds, under each task, every path it has changed (committed or
not) and every path its `ARBOR.md` plans under `## Files` that it has not
touched yet. This is the overlap check an agent runs before starting: its own
list of files against everyone else's.

```
alpha
  changed  src/auth.ts
  planned  src/session.ts
```

### `arbor show <task> [--json]`

One task in full: the row `list` would print for it, plus the `ARBOR.md`
its agent keeps at the worktree root and the reason behind an `escalated`
status.

```
alpha working
  branch:    task/alpha
  worktree:  /src/repo-arbor/alpha
  lease:     held
  ahead:     3  +82 -14
  age:       2h

ARBOR.md
# alpha
...
```

`list` says a task exists; this says what it is doing. Like `path`, it takes no
lease, so reading another agent's tree cannot knock it off its own work the way
`claim` would. A task with no `ARBOR.md` is called out rather than passed over
in silence: it is the one thing that makes the work resumable.

A `ARBOR.md` that is there gets checked against the shape the agent skill
prescribes (`# <task>`, `## Goal`, `## Next` with something unchecked in it, a
`## Blocked` with `- [ ] Q1.` items once escalated, and none left open after),
and anything off is printed under it.
Warnings only, never a refusal: the agent that wrote the file is the one that
runs `show` on it, and a rough plan still beats none.

### `arbor wait <task> [--timeout-secs 900] [--answered]`

Blocks until a task stops moving, then prints where it stopped.

Moving means `working` or `merging`. Everything else is somewhere it stays
without a person: `escalated` (printed with its reason), `removed` (merged or
discarded, and `arbor log` says which), or one of the broken statuses.

This is for the agent whose own work overlaps a task already in flight and
would rather rebase onto its result than against it. The timeout is short by
design: fifteen minutes, and then a `timeout` refusal that hands the decision
back, rather than a session that blocks all afternoon on a tree nobody is
driving. Wait again, work alongside it, or ask the human.

Like `show` and `path`, it takes no lease, so watching a task cannot knock its
agent off it.

`--answered` waits for something else: until every open question under the
task's `## Blocked` has a reply (or none is open), then claims everything new
the way `arbor replies` does and prints it. This is how an agent that
escalated waits for its human, with the same timeout and the same `timeout`
refusal, which names the questions still unanswered. A reply someone has open
to edit does not count yet. A task that is gone ends the wait too, since
nothing is left to answer.

```
alpha has new
  Q2 🎨 Does the header wrap to two lines?
    → yes
```

### `arbor inbox [--replied] [--json]`

Every question waiting on a person, across all tasks: each unchecked
`- [ ] Q9.` item under a task's `## Blocked` with no reply yet, grouped by
task. A question leaves the inbox once it is answered. `--replied` brings back
the ones answered but not yet checked off by their agent, with the reply under
each, follow-ups too: one still waiting for its agent says so, and can be
changed on the page until the agent claims it. Takes no lease.

```
alpha
  Q3 🧹 Keep or drop the old flag?
      It has been off since March.

beta (in a live session: answer it there)
  Q1 🗄️ When should the migration run?
      (a) Now
      (b) After the backfill

1 replied, not yet acted on: arbor inbox --replied
```

A question's line is its subject. Lines indented under it are its body,
markdown with code blocks and images (`![shot](/abs/path.png)`, which the page
shows inline). Choices come last in the body: `- (a) ...` lines take one or
none, `- [a] ...` lines take any that apply.

```markdown
- [ ] Q3. 🔐 How should existing sessions move to the new tokens?
  Sessions are keyed by the old cookie.
  ![login screen](/abs/path/login.png)
  - (a) Sign everyone out once
  - (b) Migrate each session on its next request
- [ ] Q4. 🔔 Where should failures notify?
  - [a] Email
  - [b] Slack
  - [c] Push
```

### `arbor replies [task]`

How an agent reads what its human answered, and the only way it does. A
person answers from the page (`arbor dev`), never the CLI, so agents have no
way to answer each other: every answer an agent reads through arbor came from
a person. For anything no question asked, the person tells the agent in its
chat.

Claiming takes every reply waiting for the task, writes each into `ARBOR.md`,
and prints them with the questions still unanswered. The first answer to a
question goes on its line after ` → `, its picks spelled out so the line alone
says what was picked: ` → b (Migrate each session on its next request)`, or
` → a (Email), c (Push): and log it` with words after the picks. Once the
agent has read an answer, the person can follow it up; a follow-up goes on a
line of its own under the question, and unchecks it, whatever the agent did
about the answer before:

```markdown
- [ ] Q3. 🔐 How should existing sessions move to the new tokens? → b (Migrate each session on its next request)
  Sessions are keyed by the old cookie.
  → Sign out the admins, though.
```

The box stays unchecked: checking it off is the agent's word that it has
acted on everything under it. Once claimed, a reply can no longer change or be
taken back, so the agent never acts on words that change under it. A reply the
person has open to edit on the page is left for the next call. Run from a
task worktree, the task is that one.

```
alpha replied
  Q3 🧹 Keep or drop the old flag?
    → drop
  unanswered: Q4
```

Until claimed, a reply waits in `.git/arbor/replies/<task>/Q3.json`, its files
beside it in `Q3/`, and the claimed line names each file by absolute path so
the agent can open it from its own tree. They go when the task is merged or
removed.

A reply is refused (`lease_held`) while the task's agent is in a live
session: it is waiting in its chat, not reading its plan, so answer it there.

### `arbor log [--count 20] [--json]`

The last N things done here (`add`, `claim`, `merge`, `remove`, `escalate`,
`retry`, `replies`, `todo add`, `todo update`, `todo remove`, and from the
page `reply`, `withdraw`, `defer`, `skip` and `approve`), oldest first, each with the task and how it ended (`ok`, or
the refusal reason).

```
WHEN  ACTION    TASK   RESULT
2h    add       alpha  ok
1h    merge     alpha  tests_failed
1h    merge     alpha  ok
```

`list` is what still exists; this is what happened. Entries outlive their tasks:
a successful `merge` and a `remove` both take the record with them, so this is
the only thing that remembers a task landed at all. The last 1000 are kept
(`logCapacity`) in `.git/arbor/log.jsonl`.

### `arbor dev [--port 4269] [--allow-hosts <names>]`

The inbox, what you sent, the todos, and the tasks in a browser, on
`http://localhost:4269`, reloading themselves as anything changes. Built for a
phone first. The inbox holds only what waits on you: each unanswered question,
grouped by task, a task only when it has one. A task whose agent is in a live
session is left out, since that agent is answered in its chat. With a keyboard,
J opens the next question, and a hint under the list says so when the page
sees a mouse or trackpad.

Tapping a question opens it with its body, images full size on a tap, its
choices, a View button for its task, and a reply box that takes pasted or
picked files. Beside the box, **Defer** makes the question a todo, its images
carried along, and answers it "Deferred to todo 7: leave it out of this
task."; **Skip** answers "Skip this: go ahead without it.". A task escalated
with `arbor escalate --review` asks `✅ Ready to merge?` like any other
question, with **Approve** ("Approved: merge it.") beside a box to request
changes.

Once answered, a question moves to Sent, one line each with where it stands
in a word: Waiting (for its agent, still yours to change or withdraw),
Editing, Read (by its agent), or Done (checked off). Opening one still
waiting holds it, so its agent cannot claim it half-changed, and closing it
lets go; the hold also lapses on its own after five minutes. One its agent
has read shows what was said so far and a box to follow it up. Each stays
until its task lands or goes.

A line across the top always says something, so nothing under it moves: the
question you last replied to while its agent has yet to read it, with
Withdraw, or else how many questions need you and how many replies wait for
their agents.

Tasks lists every task with its progress through its plan, flagging only an
escalated or broken status; tapping one opens its details and whole plan.

Todos open to reword, attach files to, or remove. Typing `@` in a reply or a
todo offers the files and directories in the task's tree (the main tree's for
a todo), tracked or new but not ignored, and writes the one picked as
`@path/from/root`; picking a directory keeps the list open on what is inside.
On a phone the tabs sit along the bottom, in reach of a thumb; on anything
wider they run down a sidebar. If the server stops answering, the header says
it is offline, since what the page shows may be stale.

Answering is done here and nowhere else, so an agent with a shell cannot
answer another: see `arbor replies`. Todos are the CLI's too, through the same
functions (`arbor todo add`, `update` and `remove`). Merging, removing tasks
and claiming stay in the CLI, so a page that should not have been reachable
can at worst leave a reply and change todos. It takes no lease.

It listens on 127.0.0.1 only and refuses a request whose `Host` is not this
machine, and any write from another origin. To use it from another device,
put a tunnel in front of it (Cloudflare Tunnel, Tailscale, ngrok) and name the
tunnel's hostname in `--allow-hosts`:

```bash
arbor dev --allow-hosts myrepo-arbor.example.dev
```

arbor has no login of its own. Whoever can reach an allowed host can read the
repo's plans and reply, so the tunnel has to be the one asking who you are
(Cloudflare Access, a Tailscale tailnet). Never expose it through a tunnel
with no login in front.

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

### `arbor escalate <reason> [--task <name>] [--review]`

The explicit "this needs a human" exit. Records the reason, drops the lease, and
leaves the worktree **exactly** as it is so the human sees what the agent saw.

`--review` asks for approval to merge rather than for answers: it adds
`- [ ] Q5. ✅ Ready to merge?` under `## Blocked`, the reason indented under
it as what to look at, and the page shows the task as one card with Approve
and Request changes. Refused (`blocked`) while another question is unchecked,
so a review is the last thing standing between the task and trunk. The agent
waits with `arbor wait --answered`, then merges on "Approved: merge it." or
acts on the changes asked for.

This exists so an agent has a way out that is not "resolve the conflict badly to
finish the task". Agents are reliable at mechanical conflicts (both sides added
imports, a signature changed on one side and its callers on the other) and
unreliable when both sides restructured the same logic, because then there is no
correct merge, only a decision.

### `arbor todo add <text> [--file <path>]`, `arbor todo list [--json]`, `arbor todo update <id> [text] [--file <path>] [--remove-file <name>]`, `arbor todo remove <id>`

Work deferred for later. When something outside the task comes up (a bug next
door, a follow-up the reviewer asked for, a question that turns out to be its
own project), the agent notes it with `arbor todo add` and carries on instead
of growing the task. Run from a worktree, `add` records the task it came up
in, which is what lets `merge` recommend a task's own follow-ups first.

Todos live in `.git/arbor/todos/`, one file each, so every worktree sees a new
one at once, with nothing to commit and no two agents rewriting the same file.
Numbers are never reused. They are local to the clone: not in git history,
not on a fresh checkout.

`arbor add <task> --todo <id>` is how one gets picked up. `update` rewords
one and keeps its number; `remove` drops one done some other way or no longer
wanted.

`--file a.png,notes.md` attaches files of any kind, stored beside the todo in
`.git/arbor/todos/<id>/` the way a reply's are. `update --remove-file` drops
one, named by path or by its stored file name (`todo list` shows them). They
go when the todo does.

### `arbor retry <task>`

Grants an escalated task another `mergeRetryCount` merge attempts and puts it
back to `working`. The way out of `budget_exhausted` that is not `remove` and redo,
for the case where the task was one fix away rather than genuinely lost.

Only from `escalated`, and that is the whole design. The budget exists to make
an agent stop and hand the task over; an agent that could grant itself more
attempts would be back to grinding against a moving trunk forever. So the price
of a fresh budget is that a human has looked at the tree first.

It takes no lease: whoever picks the task up runs `arbor claim` as usual.

## Exit codes

The agent's control flow runs on these.

| Code | Reason              | Meaning and what to do                                            |
| ---- | ------------------- | ----------------------------------------------------------------- |
| 0    | none                | Success.                                                           |
| 1    | `usage`             | Bad task name, bad flags, a repo arbor does not support, or an unexpected git failure. |
| 2    | `conflict`          | Rebase conflicted. **Rebase is still in progress.** Resolve, `git add`, `git rebase --continue`, merge again. |
| 3    | `tests_failed`      | The gate (`postRewrite`, `preMerge`) failed after the rebase. Branch rolled back, trunk untouched. Fix and merge again. |
| 4    | `lease_lost`        | Another agent took the tree mid-merge. **Stop. Do not retry.**     |
| 5    | `budget_exhausted`  | Out of merge attempts. `arbor escalate`, and a human can grant another budget with `arbor retry`; or `arbor remove` and redo against current trunk. |
| 6    | `lease_held`        | Another agent is driving this tree. For a reply from the page: answer that agent in its chat. |
| 7    | `dirty`             | Uncommitted changes. Commit before merging.                       |
| 8    | `not_found`         | No such task, or not run from a task worktree; for a reply from the page, no such open question. |
| 9    | `hook_failed`       | `postCheckout` failed (worktree still exists; fix and re-run the hook), or `postMerge` failed (the branch already landed; nothing rolled back). |
| 10   | `exists`            | Task already exists. `arbor claim` it, or `arbor remove` first. |
| 11   | `orphaned`          | Record with no worktree. `arbor remove` it.                     |
| 12   | `merge_failed`      | The base could not be fast-forwarded (usually uncommitted changes in the worktree holding it). |
| 13   | `already_removed`    | This task was removed earlier; nothing left to remove.              |
| 14   | `timeout`           | `arbor wait` gave up: the task is still working or merging, or with `--answered`, a question is still unanswered. |
| 15   | `unread`            | `arbor merge` refused: a person's reply waits unclaimed. `arbor replies`, act on it, check it off, merge again. |
| 16   | `blocked`           | `arbor merge` refused: a question under `## Blocked` is unchecked, unanswered or not yet acted on. Also `escalate --review` while one is. |

Every failure prints a one-line JSON object on **stdout** (`{"reason": ...}`,
plus fields like `paths` for conflicts) and the human explanation on **stderr**.

## Configuration

`arbor.config.ts` at the repo root, all keys optional. `defineConfig` is an
identity function that exists for the types:

```ts
import { defineConfig } from "@webappwiz/arbor/config";

export default defineConfig({
	trunk: "main",
	worktreeRoot: "../myrepo-arbor",
	postCheckout: "bun install && cp ../../myrepo/.env .env",
	postRewrite: "bun install",     // after each rebase, before preMerge
	preMerge: "bun test",           // the last gate before the branch lands
	postMerge: "bun install",       // in the main tree, after the branch lands
	leaseStalenessMs: 90_000,
	mergeRetryCount: 2,
	removedCapacity: 50,            // removed names kept, so remove can say "already removed"
	logCapacity: 1000,              // entries `arbor log` keeps before the oldest fall off
	todoStalenessMs: 2_592_000_000, // 30 days: past this, merge offers a todo for removal
});
```

`trunk` is the one key worth leaving out: unset, arbor takes the branch
`refs/remotes/origin/HEAD` points at, so a repo on `master` needs no config at
all, and falls back to `main` when there is no such ref to read.

The hooks are named for the git events they sit around: `postCheckout` runs
once, when `add` checks the worktree out; `postRewrite` runs after every rebase
`merge` does; `preMerge` runs after that, and is the last thing between the
branch and the base. They all run through `sh -c` in the worktree with
`ARBOR_TASK` and `ARBOR_WORKTREE` in the environment. `postMerge` is the
exception: it runs in the main tree after the branch lands and the worktree is
gone (so only `ARBOR_TASK` is set), for keeping the main tree current the way
`postRewrite` keeps the worktree current. It reports failure but rolls nothing
back; the landing already happened.

Every hook is unset by default: arbor has no opinion about what a repo runs, or
whether it has tests at all. Configure `preMerge` and a nonzero exit rolls the
branch back and spends an attempt, leaving the base untouched; `postRewrite`
fails the same gate the same way. Configure neither and a task lands on a clean
rebase alone.

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

Adding `git config rerere.enabled true` to `postCheckout` is worth it. The cache
lives in `.git/rr-cache`, which every worktree shares, verified against two
real worktrees: a conflict resolved in one is replayed automatically in the
other. Git still leaves the file staged as `UU`, so the agent must confirm with
`git add` and `git rebase --continue`. Not enabled by default; opt in per repo.

## Retry budget

`mergeAttempts` counts conflicts, failed test runs, and failed fast-forwards. It
exists because of a real livelock: an agent rebases onto trunk, another agent
lands during its test run, and it is stale again before it finishes. Under load
an unlucky agent can chase a moving trunk indefinitely. When the budget is gone,
escalate or `arbor remove`: redoing the task against current trunk usually beats
retrofitting a rebase.

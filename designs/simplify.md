# One task, one queue

splates drops todos, lane orchestrators and handoffs for a simple, classic
execution model: **tasks** move through stages, a **queue** orders the ones
you queue by their dependencies, and **workers** take from it and start an
agent for each task. Agents never start agents. Everything else that happens
when a task changes is an **event** that a configured hook can handle.

Decisions marked *settled* were made with the user. A call this leaves open
is asked before the phase that needs it starts, never decided by an agent
alone.

## Why

Since ffb5a350 a todo and a task are already one numbered record, but most of
the code is still built around agents directing agents. Lane orchestrators,
`LaneRunner`, `HandedOut`, `splates handoff`, `add --agent`, parts and about
fifteen `[SPLATES …]` directives exist so one conversation can plan, start,
nudge and hear back from others. Once a queue orders the work and workers
start the agents, none of that is needed, and the skill an agent reads
shrinks to "take a task, work it, land it".

## Task (settled)

A task is a number and a `SPLATES.md`, from the moment it is created until it
ends. There is no todo: a task that nobody has started is just a task in an
early stage.

- **Stage**: `backlog → ready → queued → running`. Each stage is set by
  one thing, as the table below says. A task that merges or is removed
  leaves `tasks/`: no record of an ended task is kept as a stage.
- **Depends on**: the numbers of the tasks that must merge before this one
  can run. This replaces `blockedBy`. It never expresses priority.
  Whether a task is blocked is worked out from it, and is not a stage.
- **Lane**: at most one, for people to group work. A lane has a name and
  a place on the board and nothing else: it neither runs
  nor orders anything, and has no orchestrator.
- **Model**: the agent, model and effort that should run it, set by grooming.
- **Needs you**: worked out, not stored. A task needs you while its
  `## Blocked` has an open question, or it asks for a review.

| Stage | Means | Set by |
| --- | --- | --- |
| `backlog` | Created, not yet groomed | `splates task add`, the page |
| `ready` | Groomed: no duplicate, dependencies linked, lane and model chosen, hard-to-reverse questions asked | The groomer hook, or the agent that runs it when no groomer is set up |
| `queued` | In the queue, waiting for a worker | You, from `backlog` or `ready` (queueing is always manual) |
| `running` | An agent is working it in a worktree | A worker taking it, or `splates add`/`claim` from a session you started |

With no groomer set up, a task can be queued straight from `backlog`. The
agent that takes it grooms it first, as its first step, moving it to
`ready`: it checks for a duplicate, links dependencies, and asks any
hard-to-reverse question under `## Blocked`. When grooming links a
dependency that has not merged, the task goes back to `queued` and the agent
ends, so the queue holds it until that dependency lands.

One task is one unit of work. An agent no longer "takes up" several queued
tasks into one started task. When it finds that another task asks the same
thing, it drops that one as `superseded` by its own number and folds its
detail into its own `SPLATES.md`.

### On disk (settled)

Each task is one file, `.git/splates/tasks/<N>.md`. Its frontmatter holds
what splates reads: stage, depends on, lane, model, position, and, while it
runs, its branch, worktree, base, lease and merge counters. Its body is the
`SPLATES.md` itself: Goal, Next, Notes, Blocked. A running task's worktree
holds a copy as `SPLATES.md`, synced both ways as `PlanStore` does today, so
the plan an agent edits and the task the page shows are the same thing.

Numbers are never reused, as today.

## Queue (settled)

The queue is every `queued` task, in dependency order: a task always comes
after every task it depends on, and otherwise in the order you set
(`position`). It is worked out on every read rather than stored, so it
reorders itself whenever a task is queued, updated, linked or finished;
there is no reshuffle step to get wrong.

A worker takes the first task in it whose dependencies have all merged. A
task whose dependency is not queued (still in `backlog`, say) waits, and the
page says which task it waits on. A dependency that is removed leaves the
task needing you, as a lost blocker does today.

The queue replaces `LaneRunner.startable()`. `splates queue` is its command
(`list`, `add`, `remove`, `move`); the agents waiting for a worker slot,
which `splates queue` used to list, are `splates worker queue` now. The
Scheduler keeps its line of slot requests, for agents started any other
way, but the queue only starts as many tasks as the workers have room for
(`Scheduler.room()`), so a queued task never waits for a slot with its
worktree made.

## Workers (settled)

A worker is a machine with slots, as in [worker-pool.md](worker-pool.md),
and the only thing that starts agents. When it has a free slot, it takes
the next task from the queue, makes its worktree, and starts a conversation
on the task's model with `[SPLATES TASK #N]`. One worker runs many
conversations at once, one per slot.

A task keeps its slot from when a worker takes it until it merges or is
removed, including while it waits on you. A task waiting on you often
has a demo server running on its worker for you to try, so freeing its
slot would let the worker start more agents than it has room for, and the
task would have to resume on that same machine. While reviews wait, the
queue waits too: that is the signal to answer them or add a worker.

Agents do not start agents:

- `splates add --agent`, `splates handoff`, lane orchestrators, `LaneRunner`,
  `HandedOut` and parts go.
- An agent can still `splates task add` a follow-up. That creates a
  `backlog` task, which nothing runs until you queue it.
- A harness's own subagents (Claude Code's, say) are outside splates and
  stay allowed.
- You can still start a session yourself and `splates add` or `claim` a
  task, outside the queue. The worker is the automatic way in, not the only
  one.

## Events and hooks (settled)

splates emits an event each time a task changes stage, and when it is
edited:

`task.created`, `task.updated`, `task.ready`, `task.queued`,
`task.started`, `task.needs-you`, `task.done`, `task.dropped`.

Each carries the task's number, the stage it left and the one it entered.
They come from the journal (`log.jsonl`), which already records every one of
these changes, so an event is never lost to a restart: a handler that was
down catches up from where it left off.

A hook maps an event to a handler: a shell command, or an agent with a
model and a prompt. An agent hook runs in a worker slot like any task, which
is how a hook can start an agent without an agent starting one. With no hook
set up for an event, nothing happens.

Agent hooks are set per user and project, by the Setup page, and never
checked in, since each spends its user's tokens: a checked-in groomer would
run on the account of everyone who clones the repo. `splates.config.ts`
keeps only shell hooks.

## Grooming (settled)

Grooming is the first hook splates ships, on `task.created`, and the Setup
page gets a step for it that picks its agent and model. Grooming a task is a
light, exploratory pass that changes no code:

1. Look for a task that already asks it, and fold it into that one if so.
2. Link what it depends on.
3. Put it in a lane.
4. Choose its model and effort: the cheapest that covers the task as it
   stands.
5. Ask the user, under `## Blocked`, any question about a decision that is
   hard to reverse.

Then it moves the task to `ready`. A question it asked leaves the task
needing you; it can still be queued, and its agent will not merge it until
the question is answered.

## What goes

- **Server**: `tasks/lane-runner.ts`, `tasks/handed-out.ts`,
  `tasks/handoff.ts`, `tasks/dispatched.ts`, the lane parts of `board/`, the
  orchestrator prompts in `plans/prompts.ts`, the Scheduler's own queue.
- **CLI**: `splates lane run` and `pause`, `splates handoff`, `add --agent`,
  `task take`/`release`, `splates slots`.
- **Skill**: `references/lanes.md`, `handoff.md`, `parts.md`, most of
  `queue.md`, and the directives `LANE`, `HANDOFF`, `AUTO`, `REPORT`,
  `TASK DONE`, `TASK OPEN`, `TASK ADDED`, `IDLE`, `LANES DONE`. `GROOM`
  stays, for the groomer hook.
- **Web**: the lane orchestrator's plan card, handed-out views, and the
  "todo" name everywhere.

## Plan

Each phase lands on trunk on its own, and splates keeps working after each,
since splates is built with splates. The new path is built before the old
one is deleted.

1. **Model.** FORMAT 3: each task becomes `tasks/<N>.md`, its fields as
   front matter and its text as the body, and a queued task gains its
   `stage`: `ready` once its model is named (`assignee`, the Model above),
   as grooming does last, else `backlog`. Lanes keep their running state
   until phase 4 deletes the lane runner. Behaviour is otherwise unchanged.
   FORMAT 4 then folds `status` into `stage`: a started task is `running`,
   the stage it left kept as `startedFrom`, which ending its start without a
   merge puts it back in, and only a running task keeps a `status` (working,
   merging, escalated). There are no `done` or `dropped` stages: a merged or
   removed task leaves `tasks/`, as before, its last plan kept in
   `finished/`. The body growing into the task's `SPLATES.md` is still to
   come.
2. **Queue and workers.** The worked-out queue (`queue/`), `splates queue`,
   and `QueueRunner`, which `splates server` runs to start the next task
   whenever a worker has a slot free, on the model the task names or the
   roster's first agent. Lanes still run beside it. Since the queue starts
   tasks only into free slots, it never asks a provider for another worker;
   that waits on a later change.
3. **Events and hooks.** Events from the journal, hook config, the groomer
   as a hook, and its Setup step. Grooming by the agent that runs a task
   when no groomer is set up. `HookRunner` follows the journal from a cursor
   in `.git/splates/hooks-seen.json`, starting from now the first time, so
   no hook runs for the past. The person's hooks live in
   `.git/splates/hooks.json` (`splates hook`). The groomer is off for now:
   agents write their own tasks, and the agent that starts one grooms it
   first, as the queue's prompt and `references/queue.md` say. Bringing a
   groomer back, as a `task.created` hook set from Setup, is a task of its
   own.
4. **Delete.** Everything under What goes, and `SKILL.md` and the evals
   rewritten for the new model. Landed in steps. First, lanes stop running: `LaneRunner`,
   `HandedOut`, `lane run`/`pause`, `task take`/`release`, stuck marks,
   `agentsPerLane`, the orchestrator directives and reports, `lanes.md`, the
   lane eval scenarios and probes, and the page's lane plan card and Start
   lane controls. Old orchestrator conversations still read, their reports
   as plain words. Next, agents stop starting agents: `splates handoff`,
   `tell` and Auto go, `add --agent` is the queue's alone, refused from an
   agent, and the `tasks` grant no longer hands a task to another project,
   so work across projects is queued there. Old handoff and Auto
   conversations still read, their reports and directives as plain words.
   Then parts: an agent's `add --base task/<its task>` is refused, and a
   harness subagent works in its parent's tree and commits there. A person
   can still base a task on any branch, and parts open before still land
   on their parent's branch, nested under it on the page. The slot queue of
   `workers/scheduler.ts` (`splates worker queue`) stays for now: it still
   drives provisioning and wake-on-LAN, so it goes once the task queue does
   that.
5. **Web.** The board shows lanes of tasks by stage, beside a queue view;
   "todo" becomes "task".

Phase 1 moves `board/` into `tasks/`, so each phase checks `splates list
--files` and lands between the tasks that edit the files it takes in, as
CLAUDE.md says of module moves.

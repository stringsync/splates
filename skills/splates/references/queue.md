# Linking, placing and ordering tasks

An agent that adds a task checks that none already asks it, then only adds it:
it leaves the task untriaged, unless
the user names a lane, a position or what blocks it. Placing, linking and
ordering are for the user, the orchestrator of a lane, or the agent that
starts the task, which grooms it first (see Grooming a task you start).

## Grooming a task you start

A task is groomed once, by the agent that starts it, before any work on it:

1. **One that already asks it.** When an open task asks the same, fold what
   yours adds into that one's detail and `splates remove` yours, as below.
2. **Link what blocks it**, read from `splates list --files`: `splates task
   update N --blocked-by <id>` when it needs another task's code or data, or
   would change files another task changes, never for priority. When it
   links a task still open, `splates remove` yours, which puts it back, so
   it starts once that lands.
3. **Ask only what is hard to reverse**, under `## Blocked`, as Questions in
   `SKILL.md` says; make every other call yourself.

## One that already asks it

Before adding a task, scan `splates task list`, leaving off `--open`, by
subject alone: it prints one line per task and no detail. When one or two
subjects look like the same request, `splates task show` just those. Reuse
a list you read this task when little has happened since, rather than
reading it again.

- **Open, the same request**: add none. `splates task update` its detail with
  what you know, keeping what still holds, and name it as the task you meant.
- **Taken by another task**: add none, and note in `SPLATES.md` what you would
  have added, so that task's Goal in `splates list --files` can be checked
  against it.
- **Only near it**: add yours, and link it `--blocked-by` that one when it
  needs that one's code.

## Deferring

`[SPLATES DEFER]` asks you to make a request a task rather than do it.
`splates task add` it as Queueing tasks in the skill says, from your worktree when a
task is under way, its detail all the message gives and what you already
know of the code it touches, with no new investigation.

Sent alone, it defers work you may have begun: save it before you stop. Put
what you learned and did on that request since the message in the task's
detail, ticking off the `- [ ]` steps done. When you started a task for it,
commit what its worktree holds, write in the detail that it carries on there
with `splates claim <task>`, bring `SPLATES.md` up to date, and `splates
escalate "deferred to task #N"`.

Either way, take no further step toward the request and reply with nothing
beyond the line the page shows for the task; then, after a request, carry on
with any work under way, and, sent alone, end your turn.

## Links

When a task cannot start before another merges, it is blocked by that one:
say so with `--blocked-by` (`splates task add <subject> --blocked-by 12`, or
`splates task update 14 --blocked-by 12`), rather than in its detail. splates
then warns whoever takes it early, drops the link when 12 merges or is
removed, and shows it on the board. Once 12 merges, `splates task show 14`
names the commit it landed as; once it is removed without merging, 14 waits
for the user, and nothing starts it until they let 12 go with
`--remove-blocked-by 12`, which also undoes a link.
Link only for a real order (one needs the other's code or data), never for
priority, which is the position's job.

## Lanes

A lane is a queue of tasks that build on each other, landed top first by an
orchestrator (see [references/lanes.md](lanes.md)) that sets it running, which
starts every task nothing holds back at once: link a task `--blocked-by` the
one above it whenever it needs that one's code or changes its files, even in
the same lane. A lane has no model
of its own: each task names its own. Placing a task, read `splates lane
list`, then:

- **An existing lane** when it builds on that lane's work, needing its code,
  files, or context: `--lane <n>` puts it at the bottom.
- **A new lane** when it starts a chain that more tasks will follow:
  `splates lane add '<name>'`, named for what the chain adds up to, then
  `--lane <n>`.
- **Untriaged** otherwise, the default, for the user or an orchestrator of
  the untriaged lane to place.

`splates task update <id> --lane <n>` moves one that exists.

The order of the lanes, the board's columns left to right, is the user's to
set, like a task's position: only when they ask ("put Licensing first"),
`splates lane update <n> --position <p>`, 1 the first column, then read
`splates lane list` to check the order is the one asked for.

## Positions

Only the user's priorities decide a position, so a new task goes to the
bottom unless they say otherwise:

- "urgent", "next", "before anything else": `--position 1`.
- "fast follow", "right after this", "soon": just below the urgent tasks at
  the top. Read `splates task list` to find the spot.
- "deferred", "someday", "later", "nice to have", or nothing at all: the
  bottom, the default.

To move one that exists ("bump 12", "push the upload one down", "do 7 before
4"), read `splates task list` to turn the ask into a number, `splates task update
<id> --position <n>`, then read the list again to check the order is the one
asked for.

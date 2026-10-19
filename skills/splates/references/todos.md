# Linking, placing and ordering todos

An agent that adds a todo checks that none already asks it, then only adds it:
it leaves the todo untriaged, unless
the user names a lane, a position or what blocks it. Placing, linking and
ordering are for the user, the orchestrator of a lane, or the groomer
`splates server` starts for each todo added from a task (see
[groom.md](groom.md)).

## One that already asks it

Before adding a todo, scan `splates todo list`, leaving off `--open`, by
subject alone: it prints one line per todo and no detail. When one or two
subjects look like the same request, `splates todo show` just those. Reuse
a list you read this task when little has happened since, rather than
reading it again.

- **Open, the same request**: add none. `splates todo update` its detail with
  what you know, keeping what still holds, and name it as the todo you meant.
- **Taken by another task**: add none, and note in `SPLATES.md` what you would
  have added, so that task's Goal in `splates list --files` can be checked
  against it.
- **Only near it**: add yours, and link it `--blocked-by` that one when it
  needs that one's code.

## Deferring

`[SPLATES DEFER]` asks you to make a request a todo rather than do it.
`splates todo add` it as Todos in the skill says, from your worktree when a
task is under way, its detail all the message gives and what you already
know of the code it touches, with no new investigation.

Sent alone, it defers work you may have begun: save it before you stop. Put
what you learned and did on that request since the message in the todo's
detail, ticking off the `- [ ]` steps done. When you started a task for it,
commit what its worktree holds, write in the detail that it carries on there
with `splates claim <task>`, bring `SPLATES.md` up to date, and `splates
escalate "deferred to todo #N"`.

Either way, take no further step toward the request and reply with nothing
beyond the line the page shows for the todo; then, after a request, carry on
with any work under way, and, sent alone, end your turn.

## Links

When a todo cannot start before another merges, it is blocked by that one:
say so with `--blocked-by` (`splates todo add <subject> --blocked-by 12`, or
`splates todo update 14 --blocked-by 12`), rather than in its detail. splates
then warns whoever takes it early, drops the link when 12 merges or is
removed, and shows it on the board. Once 12 merges, `splates todo show 14`
names the commit it landed as; once it is removed without merging, 14 waits
for the user, and nothing starts it until they let 12 go with
`--remove-blocked-by 12`, which also undoes a link.
Link only for a real order (one needs the other's code or data), never for
priority, which is the position's job.

## Lanes

A lane is a queue of todos that build on each other, landed top first by an
orchestrator (see [references/lanes.md](lanes.md)) that sets it running, which
starts every todo nothing holds back at once: link a todo `--blocked-by` the
one above it whenever it needs that one's code or changes its files, even in
the same lane. A lane has no model
of its own: each todo names its own. Placing a todo, read `splates lane
list`, then:

- **An existing lane** when it builds on that lane's work, needing its code,
  files, or context: `--lane <n>` puts it at the bottom.
- **A new lane** when it starts a chain that more todos will follow:
  `splates lane add '<name>'`, named for what the chain adds up to, then
  `--lane <n>`.
- **Untriaged** otherwise, the default, for the user or an orchestrator of
  the untriaged lane to place.

`splates todo update <id> --lane <n>` moves one that exists.

The order of the lanes, the board's columns left to right, is the user's to
set, like a todo's position: only when they ask ("put Licensing first"),
`splates lane update <n> --position <p>`, 1 the first column, then read
`splates lane list` to check the order is the one asked for.

## Positions

Only the user's priorities decide a position, so a new todo goes to the
bottom unless they say otherwise:

- "urgent", "next", "before anything else": `--position 1`.
- "fast follow", "right after this", "soon": just below the urgent todos at
  the top. Read `splates todo list` to find the spot.
- "deferred", "someday", "later", "nice to have", or nothing at all: the
  bottom, the default.

To move one that exists ("bump 12", "push the upload one down", "do 7 before
4"), read `splates todo list` to turn the ask into a number, `splates todo update
<id> --position <n>`, then read the list again to check the order is the one
asked for.

# Grooming tasks

Grooming is optional, and a task is available to start without it. A task is
groomed once it sits in a lane: no other task asks it, what blocks it is
linked, and it is placed. Whoever writes a task grooms it as they add it with
`splates task add`, which puts it in a lane (Backlog by default), or,
knowing too little of it, `splates task defer`s it to Backlog, rough. An
ungroomed Backlog task is groomed later, by an automation the user set up for it or the agent that
starts it, which `splates task update N --lane <n>` places. Nothing records
that it was groomed, so a task can stop being groomed whenever the board or
the code changes; its lane is all there is. Linking and placing are in
[queue.md](queue.md); this file is what grooming checks, and who does it
when.

## Grooming a task you write

Leave the project's name out of its subject and slug. Write its detail as a goal, then details (see [queue.md](queue.md), Queueing tasks).

Before `splates task add`, check none already asks it (see One that already
asks it), give it `--blocked-by` for each task whose code it needs or whose
files it changes, read from `splates task list` and `splates list --files`.
Read `splates board list` and `splates lane list` and choose where the task
fits (see Lanes and Boards in [queue.md](queue.md)). Pass `--lane <n>` when
adding it. For a new lane, create it on the fitting board first, or use
`--lane new` and move the resulting lane there with
`splates lane update <n> --board <n>`. Use Backlog only when nothing fits.
When you need more context before you can groom the task, use
`splates task defer` and let the Backlog groomer pick it up.

For a new task you start with `splates add`, make the same board and lane
choice. Use the task number shown by `splates show <task>` and place it
promptly with `splates task update N --lane <n>`. Leave it in Backlog when
nothing fits.

## Grooming a task you start

A task in Backlog that no automation has groomed, which `splates task show N` shows as `groomed: no`,
is groomed once, by the agent that starts it, before any work on it. One in
a lane (`groomed: yes`) was groomed when it was written: start work on it.

1. **One that already asks it.** When an open task asks the same, fold what
   yours adds into that one's detail and `splates remove` yours, as below.
   When one asks the opposite, or yours would undo work already merged or
   go against a call the code made (`git log` on the files it touches),
   ask the user which stands before building either way.
2. **Link what blocks it**, read from `splates list --files` and
   `splates task list`: run `splates task update N --blocked-by <id>` when it
   needs another task's code or data, or would change a file another open or
   active task already changes (never for priority). Do **not** work alongside
   that task or edit code: place N with `--lane` and run
   `splates remove <task> --reason blocked --blocked-by <id> --why "<short reason>"`
   on the worktree you started, which puts N back on the board untaken so it
   starts once the blocker lands.
3. **Ask what the user's answer would change**, in your reply, as
   [questions.md](questions.md) says, each conflict from step 1 among them, and
   each question its detail holds under `#### Questions from grooming` or
   `#### Open questions` that it does not already answer; make every other
   call yourself.
4. **Place it** with `splates task update N --lane <n>`, or `--lane backlog`
   when no lane fits, which is what marks it groomed.

## One that already asks it

Before adding a task, scan `splates task list`, leaving off `--open`, by
subject alone: it prints one line per task and no detail. When one or two
subjects look like the same request, `splates task show` just those. Reuse
a list you read this task when little has happened since, rather than
reading it again.

- **Open, the same request**: add none. `splates task update` its detail with
  what you know, keeping what still holds, and name it as the task you meant.
- **Taken by another task**: add none, and note in `SPLATES.md` what you would
  have added, so that task's After in `splates list --files` can be checked
  against it.
- **Only near it**: add yours, and link it `--blocked-by` that one when it
  needs that one's code.

## Grooming a task an automation hands you

An automation on `task.created` (`[SPLATES EVENT task.created #N]`) can tell you to groom the task just added: task N waits in Backlog for you to organize. Each firing is one conversation about one task.

You organize the task and never do it. You work in the main tree, change no
code, and start, merge and queue nothing. It is a little reading and a
few `splates task` commands, then your turn ends.

1. **Look at it.** `splates task show N`. When it is gone or `groomed: yes`,
   it is in a lane and someone made its calls first: leave it. When it is
   taken, an agent is already on it, so change nothing about the task but its
   place: skip to step 5, place it on the right lane and board as there, and
   reply as usual. Should splates refuse that, or someone take it while you
   work, leave it. When its detail holds `#### Questions from grooming`, a groomer
   before you asked them: those the user has answered since, in this
   conversation or in its detail, fold into it and go on; while any is open,
   keep those questions in its detail and place it in a named lane below.
2. **One that already asks it.** Scan `splates task list` by subject, and
   `splates task show` those that look like the same request, as One that
   already asks it says. When an open one asks it,
   fold what N adds into that one's detail (`splates task update <id>
   '<detail>'` replaces it, so pass all of it), then `splates task remove
   N`, and you are done with N. One only near it gets what N knows that it
   lacks, and a link at step 5 when one needs the other's code.
3. **Split one too big** into tasks of the right size, each one coherent
   change a single task lands: `splates task add` each part with all N said
   of it, linking a part that needs another's code `--blocked-by` it, then
   `splates task remove N`, and groom each part as below. One you cannot
   split stays whole.
4. **Look into it lightly**: the searching whoever takes it would start
   with, and no further. Find the files and code it touches, with `rg` and
   reads, and the tasks it relates to and those that block it, from
   `splates list --files`. Note what you found in its detail under a
   `#### From grooming` heading, with paths and line numbers, or attach a
   longer note with `--file`, and say there that the notes date from
   grooming, on today's date, and may be stale by the time it starts, for
   its agent to check rather than trust. Where the detail has no clear goal in its first paragraph,
   draft one from what you found, one or two sentences on what is true when it
   is done, so the what reaches the user before any agent starts, the
   cheapest point to propose at. Leave Before and After to the agent that
   starts it. The grooming notes stay under their own
   heading below those. Only enough to judge what it
   relates to and what blocks it, and whether it conflicts with what is
   there: never a plan or a fix. Read `git log` for the files it touches,
   and the merged tasks they name, so you notice when it would undo work
   already landed or go against a call the code or a past task made.
5. **Link what blocks it and place it**, as Links and Lanes in
   [queue.md](queue.md) say: `--blocked-by <id>` for each task whose code
   it needs or whose files it changes, read from `splates list --files`,
   never for priority, and `--lane <n>` when it builds on a lane's work.
   When it shares a theme with another ungroomed Backlog task, `splates lane
   add` a lane for them and move that one into it too, so read the board
   first: `splates lane list`, then `splates task list` by subject. Place
   every lane you add on a board, as Boards in [queue.md](queue.md) says:
   `splates board list`, then `--board <n>` for the one that fits, or `splates
   board add` one. When no
   themed lane fits, create a named lane for the task, even if it is the
   only task in it. Never leave a processed task in Backlog.
6. **Place it**, last and in one `splates task update N '<detail>'
   --blocked-by <id> (repeated per id) --lane <n>`. Pick no agent, model or
   thinking level, which are triage, and leave its position, which is the
   user's.

### Conflicts and open questions

You make every call a revert would undo itself. It asks the user,
and records the questions while still placing it in a named lane, when N:

- asks the opposite of another task, open or under way;
- would undo work already merged, or go against a call the code or a past
  task made, which step 4 turns up;
- is too unclear to organize: you cannot tell what it asks, so not what it
  duplicates, splits into or touches.

Place it in a named lane (create one for clarification when its scope is
still unclear), and ask the user as numbered questions
in your reply, as [questions.md](questions.md) says, naming the task or commit
each conflict is with. You have no `SPLATES.md`, so write the same questions
into its detail under a `#### Questions from grooming` heading, keeping the
rest, so they outlive this conversation: a later groomer or the agent that
starts it, finds them there. Once the user answers, fold the answers into
its detail, drop that heading, and groom it.

A task clear enough to organize can still leave open what it should do: a
behavior or design the user will see, a default they may want another way.
Those are not yours to settle, and need not hold it ungroomed in Backlog: place it,
with each such question in its detail under `#### Open questions`,
for whoever takes it to ask the user before building on a guess.

### Pruning the board

Reading the board whole, as step 5 has you, shows what to prune:

1. **Empty lanes**: `splates lane remove <n>` each lane with no tasks
   in it (neither queued nor started), left over from work that landed
   or moved. Never Backlog, which is permanent, and never a lane that
   holds a task: removing one needs the user's remove-lane card.
2. **Obsolete tasks**: a task whose subject `git log` or the code shows
   already done, superseded, or against a call since made, is no longer
   needed. `splates task remove <id>` one that is plainly moot, saying why
   in your reply. When unsure, leave it and ask the user as a numbered
   question, as Conflicts and open questions says.

Change nothing else (no position, no task taken, no queue card, and never leave
a processed task in Backlog).

### Replying

Reply with exactly one short line per task on where it went, for example
`#12: in lane 3 Stats, blocked by #9`, `#13: folded into #8`, `#14: split
into #15 and #16`, `#17: in lane 6 Clarification, with the questions below`,
`#18 and #19: into new lane 4 Auto pick`, `lane 5 Old tests: removed, empty`,
or `#20: removed, already merged in a1b2c3d`, followed only by any numbered
questions for the user, and nothing else (no extra sentences explaining why
or repeating notes already saved in the task detail). End your turn; never
wait, sleep or poll for the next task.

# Grooming tasks

`[SPLATES GROOM #N]` comes from `splates server`: you are the project's
groomer, and task N waits in the backlog, deferred rough, for you to
organize. splates claimed it for you, and tells you of the next once your
turn ends, one directive a turn, in this same conversation until the backlog
holds no more, when splates archives it and stops you; the next run starts a
conversation of its own, with a fresh context.

You organize tasks and never do them. You work in the main tree, change no
code, and start, merge and queue nothing: splates refuses you `splates add`,
`merge`, `queue add` and `lane queue`. Each task is a little reading and a
few `splates task` commands, then your turn ends.

1. **Look at it.** `splates task show N`. When it is gone, taken, or
   `groomed: yes`, someone made its calls first: leave it. Should someone
   take it while you work, splates refuses your changes to it; leave it then
   too. When its detail holds `#### Questions from grooming`, a groomer
   before you asked them: those the user has answered since, in this
   conversation or in its detail, fold into it and go on; while any is open,
   leave it as it is.
2. **One that already asks it.** Scan `splates task list` by subject, and
   `splates task show` those that look like the same request, as One that
   already asks it in [queue.md](queue.md) says. When an open one asks it,
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
   its agent to check rather than trust. Only enough to judge what it
   relates to and what blocks it, and whether it conflicts with what is
   there: never a plan or a fix. Read `git log` for the files it touches,
   and the merged tasks they name, so you notice when it would undo work
   already landed or go against a call the code or a past task made.
5. **Link what blocks it and place it**, as Links and Lanes in
   [queue.md](queue.md) say: `--blocked-by <id>` for each task whose code
   it needs or whose files it changes, read from `splates list --files`,
   never for priority, and `--lane <n>` when it builds on a lane's work.
6. **Mark it ready**, last and in one `splates task update N '<detail>'
   --blocked-by <ids> --lane <n> --ready`. Pick no agent, model or
   thinking level, which are triage, and leave its position, which is the
   user's.

## Conflicts and open questions

Make every call a revert would undo yourself. Ask the user, rather than
mark it ready, when N:

- asks the opposite of another task, open or under way;
- would undo work already merged, or go against a call the code or a past
  task made, which step 4 turns up;
- is too unclear to organize: you cannot tell what it asks, so not what it
  duplicates, splits into or touches.

Leave it in the backlog, unmarked, and ask the user as numbered questions
in your reply, as Questions in `SKILL.md` says, naming the task or commit
each conflict is with. You have no `SPLATES.md`, so write the same questions
into its detail under a `#### Questions from grooming` heading, keeping the
rest, so they outlive this conversation: a later groomer, or the agent that
starts it, finds them there. Once the user answers, fold the answers into
its detail, drop that heading, and groom it.

A task clear enough to organize can still leave open what it should do: a
behavior or design the user will see, a default they may want another way.
Those are not yours to settle, and need not hold it in the backlog: mark it
ready, with each such question in its detail under `#### Open questions`,
for whoever takes it to ask the user before building on a guess.

## Replying

Reply with one line per task on where it went, such as `#12: ready in lane 3
Stats, blocked by #9`, `#13: folded into #8`, `#14: split into #15 and
#16` or `#17: left in the backlog on the questions below`, then those
questions, and nothing more, then end your turn. Never wait, sleep or poll for
the next task: splates tells you.

# Working a lane

A lane is a named, ordered queue of tasks that build on each other, landed
top first, each in a worktree of its own, as many at once as their code allows. Lanes are the columns of the `splates server`
board; a task in none is untriaged. The groomer places the tasks agents
add (see [groom.md](groom.md)), and the user rearranges them. Each has a
number, which commands and the prompt use, and a name, which says what its
tasks are for: `splates lane show N` prints them.

`[SPLATES LANE N]`, copied from the `splates server` page, makes you lane N's
orchestrator, and your job is to plan it: `splates server` runs it. You do none
of its tasks and hand none out yourself. You make the lane say what can go
at once and what must wait, name the model each task goes to, set it
running with `splates lane run N`, and end your turn. From then on `splates
server` starts each task that no open one blocks, in a worktree of its own, on
the agent and model it names, as many at once as `agentsPerLane` in
`splates.config.ts` allows, and the next as each lands. Each agent is the
user's, not yours: it works its task as any other (see Workflow),
answers to the user, asks them its questions, and merges itself. You never
relay for it, and it never reports to you. Each lane you are sent adds more
to plan. The lane is splates's, not the prompt's, so read it from splates
each time.

Once you have first read the lanes you were sent, before setting any
running, say so in a message of its own, which the `splates server` page shows as a
card, and beside the thread until your finished report: a `## 🌱 Started lanes` title with the
lanes' names as the board shows them, a blank line, and one or two lines on
what they add up to. A lane you are sent later gets a Started card of its
own; placing the untriaged tasks, start the lanes you placed them in.

```markdown
## 🌱 Started lanes Stats, Licensing

Make the Stats page say what to act on, then renew licenses on their own.
```

The page shows your plan in your latest working report, live from splates:
a board of each lane's tasks to do, those under way with how each agent
stands, and those landed. So you change the plan by changing the lanes:
`splates task update <id> --position <n>`, `--blocked-by <id>` or `--lane
<n>` (see [references/queue.md](queue.md)), never by writing it out.

## Planning a lane

A running lane holds back only what is linked: its order alone holds
nothing back, so a task no open task blocks starts at once, beside
everything else that can. The plan is the links, and you make them before
the lane runs.

1. `splates lane show N` prints the steps, who is on each, whether it runs,
   and which tasks name no agent. When it says the lane is done or gone,
   done by agents of the lane or by ones it never started, say so in your
   next report. Once every lane you work is, end on a finished report (see
   Reporting on lanes), so the `splates server` page shows you as done.
2. Read each open task with `splates task show <id>`, and `splates list
   --files` for the tasks under way. Link a task `--blocked-by` another,
   in any lane, whenever it must wait for it:
   - **A real order:** it needs the other's code or data, whether a link,
     its detail or what it changes says so. A lane's tasks build on each
     other, so read each one's detail for what it needs, not only its links.
   - **The same files:** it would change files the other changes, or a task
     out changes, which would cost both a hard rebase. Link the later one
     in the lane's order by the earlier, and one that waits on a task out
     by the queued task that one took.

   Never link for priority, which is the position's job. When two tasks ask
   for opposite things, ask the user which wins, as numbered questions in
   your report, and link the one waiting on the answer by the other
   meanwhile.
3. Name the agent and model of each task that names none, picked as for a
   task you queue (see Queueing tasks in the skill): `splates task update <id> --agent <a> --model
   <m>`, with `--effort <level>` when it needs a thinking level other than
   the agent's own. The lane starts no task that names no agent.
4. Add to a task's detail what it does not say and the lane taught you:
   names chosen, files moved, answers the user gave, what the tasks out
   beside it are changing. `splates task update <id> '<detail>'` replaces
   the whole detail, so pass all of it.
5. `splates lane run N`, unless it already runs. A task out already is
   left to its agent: splates tells it to carry on should it sit idle.
6. End your turn on a working report (see Reporting on lanes). Never wait,
   sleep or poll for the lane's agents, and never hand one of its tasks
   out yourself, even when it waits on room: each that lands frees one,
   and splates wakes you only for what needs you.

## What wakes you

The lane's agents never report to you, and what lands needs nothing from
you: the lane starts what it held back. splates wakes you, as a message
from the user would, once per change, only for what needs a plan.

`[SPLATES TASK ADDED #N]` means task N came into a running lane you work,
added there or moved in. Read `splates task show N`, then plan it as steps
2 to 4 of Planning a lane say: link what it needs and what needs it, and
name its model, so the lane starts it in its turn.

In a running lane, splates tells an agent that goes idle to carry on
itself, once. `[SPLATES IDLE <task>]` comes only once it stops again, its
task marked stuck on the board, without escalating, merging or removing
its task, and the user has not taken it in hand since. Read `splates show
<task>`. When it is gone, it landed or was removed: nothing more to do.
Otherwise, when its agent stopped on something the plan can fix, such as
work a task out beside it has yet to land, fix the links and `splates
tell` it what changed. Failing that, ask the user in your next report what
becomes of it:

```markdown
1. What should become of <task>, which keeps stopping on <what>?
   - (a) Hand it to another model: remove the started task and name another model on it (chosen)
   - (b) Leave it for you to take up in its conversation
   - (c) Remove the started task and leave it queued for later
```

A task that escalates wakes you for nothing: it waits on the user, who
answers it in its own conversation, and what it blocks waits too.

`[SPLATES TASK DONE #N]` and `[SPLATES TASK OPEN #N]` come only for a lane
that does not run, which the user paused: task N left the queue, or the task that took it
let it go. Read `splates lane show N`, and while it still does not run,
leave it as they left it, starting nothing, and say in your next report
that it is paused.

A task you handed to another project holds no task in your lanes, so its
agent reports instead: `[SPLATES REPORT <slug>/<task>]` means it stopped,
escalated, merged or removed. Read `splates --project <slug> show <task>`,
once per stop, running each command on it as `splates --project <slug>
<command> <task>`; when it is gone, link nothing to it any more.

`[SPLATES LANES DONE]` means no lane you work is left on the board: its
last task landed, by an agent of the lane, another conversation or an external one,
while your last report still said it was under way. Read `splates lane list`
and `splates list` to be sure, then end on your finished report (see Reporting
on lanes), so the page shows you as done.

Never answer an agent's questions, or tell it anything the user said to it:
it is theirs. A task the user moved, linked or edited while you worked
shows in the next `lane show`.

## Changing course

The user may tell you to change course on a lane or several: drop a task,
take another approach, undo what landed. You know the body of work, so act
on it with what fits:

- `splates lane pause N` stops a lane starting more while you change its
  plan, and `splates lane run N` sets it going again once its links say
  what is next.
- `splates tell <task> --stop '<what changed>'` stops an agent's turn and
  tells it the new plan, as the user would.
- `splates remove <task> --reason <why>`, run once its agent is stopped,
  drops a started task, putting it back in the queue, which a running lane starts again;
  `splates task remove <id>` drops it from the queue too.
- Work that already merged comes back out with a revert: add it as a task
  in the lane, planned as any other.

Then update the lanes so the plan says what is next, and end on a working
report.

## Without splates server

`splates server` runs a lane and starts the agents a task names, and sets
`$SPLATES_CONVERSATION` in yours; without it, nothing will start one, and
`splates lane run` sets going nothing. Plan the lane as above, then land it
through subagents of your own harness: hand each task no open task blocks
to one, on the model it names, with `splates add <task> --task <id>` and no
`--agent`, told to `splates claim <task>` and work it as the skill says.
When your harness cannot run that model, work it yourself, saying so as
for any task that names another model. A subagent of your harness answers
to you, so its questions come back to you: ask the user them in your
report, and send their answers back in a message to it. Nothing wakes you
for it, so `splates wait <task>` on it in place of its report, stop it once
its task is gone, and hand out what that landing unblocked.

Before a finished report, read `splates list` for any task of your lanes
still there, and see it to its end, or ask the user what becomes of it.

Never plan or run a lane you were not sent.

## Reporting on lanes

A lane orchestrator reports on its lanes in the reply that ends each turn:
the user reads its agents' own questions in their conversations, so this
says only where the plan stands.

Whenever it ends a turn with a lane it works not yet done, it ends on a
working report: `## ⏳ Working lanes`, the names of the lanes it works,
and after a colon, the tasks out, once the lane has started any, then a `####`
line, one sentence on what landed since its last report and what lands
next, and a `- ` line per lane on what it waits on, naming any task that
waits on the user. The page shows each task beside it, so say only what the
plan does not: why something waits, a conflict you held back, a lane the
user paused, a change of course. Say nothing before it in the turn, neither
what landed nor what went out.

The models it picks, the lanes it names and the links it adds show on the
board, so the report says none of them. Its own questions, such as what becomes of a task that keeps stopping, end it, as
an escalation ends with them.

```markdown
## ⏳ Working lanes Stats, Licensing: on stats-breakdowns-clear, licensing-renew

#### #154 merged as stats-totals-first, so the lane started the breakdown tables.

- Stats: #160 waits on #155, out as stats-breakdowns-clear, which waits on you.
- Licensing: #172 out as licensing-renew; #173 holds back, as it renames the same files.
```

Once every lane it works is done, it ends on one report for them all, the page's sign that it is
done: `## 🏁 Finished lanes` and the lanes' names as the board shows them,
then one sentence on what they added up to, and a `- ` line per lane on what
became of each task, including those another agent took and landed.

```markdown
## 🏁 Finished lanes Stats, Licensing

The Stats page leads with what to act on, and licenses renew on their own.

- Stats: #155 merged as stats-action-oriented; #152 and #160 landed by another conversation.
- Licensing: #171 and #172 merged; #173 removed as moot.
```

Make it the last thing in your turn, and end the turn there: as the turn
ends on it, `splates server` archives the lane, your conversation with the
agents you started, unless one of them still holds a task, which leaves it
to the user.

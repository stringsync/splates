# Working a lane

A lane is a named, ordered queue of todos that build on each other, landed
top first, one task per todo, as many at once as their code allows. Lanes are the columns of the `arbor dev`
board; a todo in none is untriaged. Agents place the todos they add (see
Lanes in [references/todos.md](todos.md)), and the user rearranges them. Each has a
number, which commands and the prompt use, and a name, which says what its
todos are for: `arbor lane list` shows both.

`[ARBOR LANE N]`, copied from the `arbor dev` page, makes you lane N's
orchestrator, and your job is to burn it down: every todo in it landed, as
soon as the order of their code allows. Its agents set the pace, so keeping
them moving comes before anything else: whenever one stops, settle what it
needs at once, from what you know or can find out, rather than pass it along.
Do the lane's todos yourself, and hand out only those that can run beside
the one you are doing, each to an agent on the model it names, carrying what
each one learned to the next (see Doing a todo yourself). Each lane you
are sent adds more to work side by side. The lane is arbor's, not the
prompt's, so read it from arbor each time:

Once you have first read the lanes you were sent, before handing anything
out, say so in a message of its own, which the `arbor dev` page shows as a
card, as a task's Added card is (see Saying what you added), and beside the
thread until your finished report: a `## 🌱 Started lanes` title with the
lanes' names as the board shows them, a blank line, and one or two lines on
what they add up to. A lane you are sent later gets a Started card of its
own; placing the untriaged todos, start the lanes you placed them in.

```markdown
## 🌱 Started lanes Stats, Licensing

Make the Stats page say what to act on, then renew licenses on their own.
```

1. `arbor lane show N` prints the steps and what to do next. When it says
   the lane is done or gone, done by you or by agents you never started, say
   so in a line. Once every lane you work is, end on a finished report (see
   Reporting), so the `arbor dev` page shows you as done.
2. When its next todo is blocked by a todo in another lane, it waits for
   that one. A blocker you handed out wakes you with its report, as in step
   5; for any other, `arbor todo wait <id>`, again on `timeout`. When the
   other task is escalated, that todo waits on that task, as in step 5.
   Meanwhile, go on with the todos below it that it does not hold up, as in
   step 4, and with your other lanes.
3. Do the next todo yourself when you are doing none; otherwise hand it
   out (see Doing a todo yourself). To hand it out,
   `arbor todo show <id>` names its agent and model; when it names none,
   pick one as for a todo you add (see Todos), and say which in your report
   as `- Assumed: <what>`. Then `arbor add <task> --todo <id> --agent <a>
   --model <m> --prompt '<what>'`, where `<what>` holds all the agent needs
   that the todo's detail does not, so it never has to ask you: names
   chosen, files moved, answers the user gave, what the tasks out beside it
   are changing. The agent works it as a task of its own (see Workflow),
   merging it itself, but reports to you, not the user (see Reporting to an
   orchestrator): its questions and its review come to you. It proposes no
   next todo, since you hand that out.
4. Then `arbor lane show N` again: its next is the first todo no task has
   taken. Hand that one out too, in step 3, unless it has to wait: when
   `arbor todo show` links it `--blocked-by` an open todo, when its detail
   says it needs the code of one still out, or when it would change the
   same files as a task out on the lane (`arbor list --files`), which would
   cost both a hard rebase. One that has to wait goes out once what it waits
   on lands. A lane's todos build on each other, so read each one's detail
   for what it needs, not only its links.
5. Once nothing more can go out on any lane you work and you are doing no
   todo yourself, end your turn on a
   working report (see Reporting on lanes) saying what each lane waits on, rather
   than block in `arbor wait`: your agents work on their own, and each wakes
   you as it stops. Never end a turn with work out and no report on it.

`[ARBOR REPORT <task>]`, which arrives as a message from the user would,
means a task you handed out stopped: escalated, merged or removed. Read
`arbor show <task>`, once per stop: one you have already acted on needs
nothing more. When it is gone, read in `git log` what landed, say so in a
line, and go back to step 1 for its lane without waiting for the user. When
it is escalated, what needs that task waits on it: answer what you can and
bring the rest to the user at once (see Relaying for a lane's agents), while
every other agent carries on. Each report you end a turn on after
one is a fresh word on every lane, so the user sees each step as it lands.

`[ARBOR IDLE <task>]` means the agent you handed `<task>` out to ended a
turn, failed, or was stopped by a restart, without escalating, merging or
removing it: it stopped without a word to you, and nothing more will come
unless you act. Read
`arbor show <task>`. When it is gone, treat it as a report of its landing
or removal. Otherwise, when its `ARBOR.md` has open questions under
`## Blocked`, relay them as for an escalation (see Relaying for a lane's
agents); when it has none, `arbor tell <task>` it to carry on as the arbor
skill says, ending in `arbor escalate`, `arbor merge` or `arbor remove`. The
second time a task comes back idle with nothing changed, stop telling it:
`arbor claim <task>` and finish it yourself, as for a todo you do (see Doing
a todo yourself), carrying on from its `ARBOR.md`. Only when it cannot go on
without the user, ask in a waiting report what becomes of it, with the
choices `[ARBOR STOPPED <task>]` asks.

`[ARBOR STOPPED <task>]` means the user terminated the agent you handed
`<task>` to, from its conversation, leaving the task as it stood. The lane
waits on the user: ask, in a waiting report, what becomes of it:

```markdown
1. What should become of <task>, whose agent you terminated?
   - (a) Resume its agent where it stopped (chosen)
   - (b) Remove the task and hand its todo out again
   - (c) Remove the task and leave its todo for later
```

For (a), `arbor tell <task>` it to carry on, which wakes it; for (b) and
(c), `arbor remove <task> --reason redo`, then for (b) hand the todo out as
in step 3.

`arbor dev` starts the agent you name, and sets `$ARBOR_CONVERSATION` in
yours; without it, nothing will start one. Hand the todo to a subagent of
your own harness on the model it names instead, told to `arbor claim <task>`
and work it as above, or, when your harness cannot run that model, work it
yourself, saying so as for any todo that names another model.

Groom what you hand out as you go, so none of it piles up in arbor or the
conversation view: every task you hand out ends merged or removed, never
left behind. `arbor dev` archives an agent's conversation once its task is
gone, with yours, so unarchiving yours brings it back. A subagent of your
own harness is yours to put away: stop it once its task is gone. Before a
finished report, read `arbor list` for any task you handed out still there,
and see each to its end, or ask the user what becomes of it.

Never hand out a todo from a lane you were not sent, or one step 4 holds
back; when the user moves todos while you work, the next `lane show` has
them.

## Doing a todo yourself

You do the lane's todos, one after another; an agent only adds a hand. Never
leave a lone agent at work while you wait on it: it spends minutes reading
code you could have kept in view, and the user watches you sit idle. So a
lane whose todos each build on the last is yours from start to end, however
long each one is, and a todo goes out only when it can run beside one you
are doing. When several can go at once, keep for yourself the one that
leans most on what the lane taught you, and hand out the rest.

`arbor add <task> --todo <id>`, with no `--agent`, and work it as any task
(see Workflow): its Added card, its `ARBOR.md`, and its merge report, which
proposes the lane's next todo; then go back to step 1. Work one that names
another model all the same, saying so in its Added card. Hand out what can
go out first, so agents work while you do.

Your agents still come first. Their reports reach you as messages while you
work: at each step, act on every `[ARBOR REPORT]`, `[ARBOR IDLE]` or
`[ARBOR STOPPED]` that came in before going on, so none of them waits on
your work. When your task needs the user, escalate it as any task, and say
so in your waiting report as a lane line.

## Relaying for a lane's agents

The user talks to you, never to the agents you hand tasks to: the `arbor
dev` page offers no composer on their conversations, only a line pointing
to yours. So when one escalates, you carry its questions up and the answers
down, with `arbor tell <task> '<text>'`, which says `<text>` in its
conversation as the user would.

1. Read `arbor show <task>`: its open questions under `## Blocked`, or, for
   a review, its `### Review` under `## Notes`.
2. Answer each question that the lane's earlier steps, the user's answers
   to them, or a look at the code settle, as the user would from the page: its
   line quoted in bold, then the choice picked (see Keeping Blocked
   current), and a line saying you answered it from the lane and why, so it
   keeps it as an assumption. Say each in your report as an assumption the
   user can challenge: `- Assumed for <task>: <what you answered>`. Never
   answer one that is a close call or goes against what the user said.
3. Bring the rest to the user in a report that ends your turn (see
   Reporting), straight away, though your other lanes go on: each open
   question in a numbered list, exactly as the agent wrote it, with its
   choices and screenshots, and, relaying for more than one task, a body
   line that starts `For <task>:`. A review you relay as a Ready to merge
   card of its own, the agent's `### Review` as it wrote it.
4. When the user answers, `arbor tell` each task the quotes and words that
   answer its questions, as they came, and its challenges to an assumption
   you made. "Merge" or `[ARBOR MERGE]` on a review you relayed goes down as
   `[ARBOR MERGE]`; changes asked for go down as they came. Questions they
   left open stay open: ask them again in your next report, first. Then go
   back to step 1 of Working a lane for that lane.

Never ask the user to go to the agent's conversation, or to send you on:
whatever they say to you is yours to pass down.

`arbor tell` needs `arbor dev`. With a subagent of your own harness, its
reply comes back to you: relay the same way, and send its answers in a
message to that subagent, and `arbor wait <task>` on it in place of its
report, since nothing wakes you.

The page leaves the agents' conversations read-only, yours to manage:
archiving yours takes theirs with it, stopping any at work, and their
permission asks, which only the user can answer, show above your composer.

## Reporting on lanes

A lane orchestrator reports on its lanes, beyond the reports of a todo it
does itself. Whenever a task it handed out needs the user, it ends its turn on one report for every lane
waiting on one: `## ⏸️ Waiting lanes`, the names of the lanes that wait,
and after a colon, the tasks they wait on, then one sentence on what the
user has to answer, a `- ` line per lane it works on where it stands, then
the questions it relays (see Relaying for a lane's agents), as an
escalation ends with them. A review it relays comes before it, as a Ready
to merge card of its own.

Whenever it ends a turn with a task it handed out still at work, and no
lane waits on the user, it ends on a working report: `## ⏳ Working lanes`,
the names of the lanes it works, and after a colon, the tasks out, then one
sentence on what lands next, and a `- ` line per lane on what it waits on.
The user hears nothing is asked of them, and each report that wakes it
brings a fresh one.

Like a task agent's assumptions, each call it makes is said once, in the
report that ends the turn it made it in, after the lane lines: a
`- Assumed: <what>` line for each model it picked for a todo
that named none and each lane it named, and a `- Assumed for <task>: <what>`
line for each answer it gave from the lane.

```markdown
## ⏳ Working lanes Stats, Licensing: on stats-breakdowns-clear, licensing-renew

Both lanes have a todo out; the breakdown tables land first.

- Stats: #155 out as stats-breakdowns-clear (Sonnet); #160 is next.
- Licensing: #172 out as licensing-renew (Haiku); #173 is next.
- Assumed: Haiku for #172, which named no model, as a mechanical rename.
```

```markdown
## ⏸️ Waiting lanes Stats: on stats-breakdowns-clear

Answer stats-breakdowns-clear's question on the breakdown tables.

- Stats: waits on stats-breakdowns-clear, escalated on what reads wrong.
- Licensing: #172 under way as licensing-renew.
- Assumed for stats-breakdowns-clear: kept the column order of #155.

1. Which breakdown should lead the table?
   - (a) By project (chosen)
   - (b) By agent
```

Once every lane it works is done, it ends on one report for them all, the page's sign that it is
done: `## 🏁 Finished lanes` and the lanes' names as the board shows them,
then one sentence on what they added up to, and a `- ` line per lane on what
became of each todo, including those another agent took and landed. It ends
with the proposed todos, as a merge report does.

```markdown
## 🏁 Finished lanes Stats, Licensing

The Stats page leads with what to act on, and licenses renew on their own.

- Stats: #155 merged as stats-action-oriented; #152 and #160 landed by another conversation.
- Licensing: #171 and #172 merged; #173 removed as moot.
```

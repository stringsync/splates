# Handing off your task

When the user asks for another agent to carry your task on, such as one of
another model family, or sends `[SPLATES HANDOFF TO <agent> <model>]` from the
`splates server` page's Hand off action, naming the agent and any model to pass
to `--agent` and `--model`, hand the whole task over rather than a part: the
other agent takes over your tree, your branch and your `SPLATES.md`, and
answers to the user as you did. Only the agent at work on a task hands it
off. A lane's orchestrator that handed you yours goes on hearing of the
task from the agent it goes to.

1. Commit each step you finished, and check it off under `## Next`.
2. Bring `SPLATES.md` up to date as for a checkpoint, then write a `###
   Handoff` under `## Notes`: why you hand it on, where it stands, what to
   do next, and what you learned that the rest of `SPLATES.md` does not say.
   The new agent never sees this conversation: this is all it gets.
3. Read `splates agents`, then `splates handoff <task> --agent <id> --model
   <m>`, taking the agent, model and any thinking level the user names, else
   the ones whose strengths fit what is left at the lowest cost it is worth
   (see Picking a thinking level). `splates server`
   starts it in your tree, sent `[SPLATES HANDOFF <task>]` and any `--prompt`,
   and moves this conversation back to the main tree.
4. End your turn, saying nothing of the handoff: the `splates server` page shows
   it as splates's own line, "Handed off" on the task, with the agent and
   model it went to on hover, and the `### Handoff` holds why and where it
   stands. The task is the other agent's from then on: run nothing on it
   again, and when the user asks you about it, point them to its
   conversation.

Outside `splates server`, nothing starts the agent until it runs: say so in a
line, so the user can start `splates server` or give another agent `[SPLATES
HANDOFF <task>]` themselves.

`[SPLATES HANDOFF <task>]` sent to you means another agent handed you `<task>`:
`splates claim <task>`, read its `SPLATES.md`, the `### Handoff` under `## Notes`
first, and carry on from where it stands, as the task's agent from then on.
Start with the work, or with a question its `### Handoff` leaves open.

## Handing on work another model fits better

Whoever started you picked your model before anyone knew the work, and
mostly picked well enough: keep the task by default. Hand it on only for a
reason this task has given you, one you can name in a sentence and the user
could check against `SPLATES.md` or the tree:

- **Up**, when your own work on it has shown it is beyond you: the same
  step failed twice after you changed course, or the plan hinges on a call
  you could not settle with confidence after investigating, and `splates
  agents` names a model whose strengths cover it.
- **Down**, when most of the task is still ahead, every step of it is spelled
  out under `## Next`, and it is long and mechanical enough that a cheaper
  model saves more than it costs to read `SPLATES.md` and the tree afresh,
  such as the same edit across dozens of files.

None of these is a reason: the request sounds hard or easy, your model
seems too big or too small for it, or a cheaper model could probably do
it. When you are unsure, keep it. A conversation Auto started is the
exception, since its pick never saw the code: see Sizing an Auto pick.

Keep the task when the user named your model for it, or asked you to do it
yourself.

1. Do steps 1 and 2 of Handing off your task, the `### Handoff` stating
   the reason: what failed or what is left, with the steps or files that
   show it.
2. `splates handoff <task> --agent <id> --model <m>`, the cheapest model
   that fits, with `--effort` as Picking a thinking level says. `splates
   server` starts it in your tree, and moves this conversation back to the
   main tree. The agent answers to the user, who talks to it directly.
3. End your turn on one line saying who it went to and why, such as
   `Handed to Sonnet 5.5: forty files need the same rename.`, so the user
   can judge it.

## Picking a thinking level

`splates handoff`, `splates add --agent` and `splates task add` take
`--effort <level>`, the thinking level the agent works at, one of those
`splates agents` lists under THINKING for it; left off, the agent works at
its own. Pick the model first, then the level for what is left on it:

- **low**, when every step is spelled out under `## Next` and only needs
  doing: a rename, one edit across many files, a value to change;
- **high**, when what is left hinges on a call you could not settle, or a
  bug whose cause you could not place;
- otherwise leave it off: most work fits the agent's own.

A higher level on a cheaper model can beat the next model up for work that
is narrow but tricky; a lower one never makes up for a model too weak for
the work.

## Sizing an Auto pick

`[SPLATES AUTO] <request>` means the person started this conversation from
the New menu's Auto item: a router read only their words and picked your
agent, model and thinking level, and the conversation already shows
splates's line `Auto picked <model>, <effort>: <what it found>`, so say
nothing of what you run as. You are a probe: you see the code the router
never saw, so it is yours to judge whether the work fits you, and that
judgment is the reason the section above asks for.

1. A request that only needs an answer, you answer, with no task.
2. Otherwise, `splates add` as always, and investigate in its worktree
   until you can size the work: the files it touches, the calls it needs,
   how much of it is mechanical. Write what you learn in `SPLATES.md` as
   you go.
3. Keep it when it fits your weight, or when you are unsure, and carry on
   as for any task. Hand it on only when the code shows the work a tier off
   from what the pick assumed, for a reason you can name in a sentence the
   person could check against the tree:
   - **up**, when it is bigger or more tangled than its words: a design
     call, a change across systems, a bug whose cause you cannot place;
   - **down**, when a strong pick finds a mechanical change: a rename, one
     edit across many files, a value to change, each step one you can spell
     out under `## Next`.
4. To hand it on, read `splates agents`, pick the cheapest model whose
   strengths cover the work, and do steps 1 and 2 of Handing off your task,
   the `### Handoff` holding everything you learned. Then `splates handoff
   <task> --agent <id> --model <m> --effort <level>`. Auto picked a level from the words alone, so pick one again from what
   you found, as Picking a thinking level says.
5. End your turn on one line saying who it went to and why, such as
   `Handed to Sonnet 5.5: one constant to rename across 30 files.`, so
   the person, who never asked for a handoff, sees why Auto's pick moved.

# Handing off your task

When the user asks for another agent to carry your task on, such as one of
another model family, or sends `[SPLATES HANDOFF TO <agent> <model>]` from the
`splates server` page's Hand off action, naming the agent and any model to pass
to `--agent` and `--model`, hand the whole task over rather than a part: the
other agent takes over your tree, your branch and your `SPLATES.md`, and
answers to the user as you did. Only the agent at work on a task hands it
off. When another agent handed you yours with `--relay`, so you answer to
it, `splates handoff` refuses: escalate instead, naming the agent you would
hand it to, since the task is that one's to place. A lane's orchestrator
that handed you yours goes on hearing of the task from the agent it goes
to.

1. Commit each step you finished, and move it to `## Done`.
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
yourself. An agent that answers to another escalates instead, as above.

You stay the one the user talks to: the other agent answers to you.

1. Do steps 1 and 2 of Handing off your task, the `### Handoff` stating
   the reason: what failed or what is left, with the steps or files that
   show it.
2. `splates handoff <task> --relay --agent <id> --model <m>`, the cheapest
   model that fits, with `--effort` as Picking a thinking level says. `splates server` starts it in your tree, and moves this
   conversation back to the main tree. Outside `splates server`, `--relay`
   refuses: keep the task, or hand it to a subagent of your own harness on
   that model, told to `splates claim <task>` and work it as the skill says,
   reporting to you, and `splates wait <task>` on it in place of its reports.
3. End your turn on a working report: `## ⏳ Working <task>`, after a colon
   the agent and model it went to as `splates agents` names them, then one
   sentence stating the reason, so the user can judge it and tell you to
   take it back.

```markdown
## ⏳ Working <task>: on Claude Sonnet 5.5

Forty files still need the same rename, each listed under `## Next`, so a cheaper model takes them.
```

From then on, splates wakes you whenever it stops, and you carry its
questions up to the user and their answers down:

- `[SPLATES REPORT <task>]`: read `splates show <task>`. When it is gone, read
  in `git log` what landed and end on the report the task would have ended
  on, `## ✅ Merged <task> onto <base>` or `## 🛑 Removed <task>: <why>`,
  with the next todo (see The next todo), since the other agent proposes
  none. When it escalated, relay its questions or its review (see Relaying
  below), under a `## ⚠️ Escalated <task>: <what it needs>` or a Ready to
  merge card.
- `[SPLATES IDLE <task>]`: it stopped without a word to you. When its
  `SPLATES.md` has open questions under `## Blocked`, relay them; when it
  has none, `splates tell <task>` it to carry on as the splates skill says,
  ending in `splates escalate`, `splates merge` or `splates remove`. The second
  time it comes back idle with nothing changed, ask the user whether to
  take it back.
- `[SPLATES STOPPED <task>]`: the user terminated its agent. Ask what becomes
  of it, with "take it back" as a choice: once the user picks it, `splates
  claim <task>` and carry on yourself.
- `[SPLATES HEARTBEAT]`: you have sat idle ten minutes while it works, so the
  user has heard nothing for that long. Read `splates show <task>`, act on it
  as for `[SPLATES IDLE <task>]` when it has not moved, and end on a fresh
  working report.
- When the user asks for the task back while its agent works, ask them to
  terminate that agent from its conversation, then claim it on the
  `[SPLATES STOPPED <task>]` that follows.

### Relaying

The user talks to you, never to the agent: the `splates server` page offers no
composer on its conversation, only a line pointing to yours, and its
permission asks show above your composer. So you carry its questions up
and the answers down, with `splates tell <task> '<text>'`, which says
`<text>` in its conversation as the user would.

1. Read `splates show <task>`: its open questions under `## Blocked`, or, for
   a review, its `### Review` under `## Notes`.
2. Answer each question that what you know of the task, the user's earlier
   answers, or a look at the code settle, as the user would from the page:
   its line quoted in bold, then the choice picked (see Keeping Blocked
   current), and a line saying you answered it and why. Never answer one
   that is a close call or goes against what the user said.
3. Ask the user the rest, each open question in a numbered list exactly as
   the agent wrote it, with its choices and screenshots. A review you relay
   as a Ready to merge card of its own, the agent's `### Review` as it
   wrote it.
4. The user's answers reach you as messages. `splates tell` the task the
   quotes and words that answer its questions, as they came. "Merge" or `[SPLATES MERGE]` on a
   review you relayed goes down as `[SPLATES MERGE]`; changes asked for go
   down as they came. Questions they left open are asked again first in
   your next report.

Never ask the user to go to the agent's conversation, or to send you on:
whatever they say to you is yours to pass down.

## Picking a thinking level

`splates handoff`, `splates add --agent` and `splates todo add` take
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
   <task> --agent <id> --model <m> --effort <level>`, without `--relay`:
   the person picked Auto, not you, so the agent it goes to answers to them.
   Auto picked a level from the words alone, so pick one again from what
   you found, as Picking a thinking level says.
5. End your turn on one line saying who it went to and why, such as
   `Handed to Sonnet 5.5: one constant to rename across 30 files.`, so
   the person, who never asked for a handoff, sees why Auto's pick moved.

When `$SPLATES_CALLER` is set, `splates handoff` refuses: escalate instead,
naming the model the work fits, as above.

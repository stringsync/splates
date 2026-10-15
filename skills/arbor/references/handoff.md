# Handing off your task

When the user asks for another agent to carry your task on, such as one of
another model family, or sends `[ARBOR HANDOFF TO <agent> <model>]` from the
`arbor dev` page's Hand off action, naming the agent and any model to pass
to `--agent` and `--model`, hand the whole task over rather than a part: the
other agent takes over your tree, your branch and your `ARBOR.md`, and
answers to the user as you did. Only the agent at work on a task hands it
off. When an orchestrator handed you yours, `arbor handoff` refuses:
escalate instead, naming the agent you would hand it to, since the lane is
the orchestrator's.

1. Commit each step you finished, and move it to `## Done`.
2. Bring `ARBOR.md` up to date as for a checkpoint, then write a `###
   Handoff` under `## Notes`: why you hand it on, where it stands, what to
   do next, and what you learned that the rest of `ARBOR.md` does not say.
   The new agent never sees this conversation: this is all it gets.
3. Read `arbor agents`, then `arbor handoff <task> --agent <id> --model
   <m>`, taking the agent and model the user names, else the ones whose
   strengths fit what is left at the lowest cost it is worth. `arbor dev`
   starts it in your tree, sent `[ARBOR HANDOFF <task>]` and any `--prompt`,
   and moves this conversation back to the main tree.
4. Report it in a block of its own, the 🤝 card the skill's Reporting
   shows, and end your turn. The task is the other agent's from then on:
   run nothing on it again, and when the user asks you about it, point them
   to its conversation.

Outside `arbor dev`, nothing starts the agent until it runs: say so in the
report, so the user can start `arbor dev` or give another agent `[ARBOR
HANDOFF <task>]` themselves.

`[ARBOR HANDOFF <task>]` sent to you means another agent handed you `<task>`:
`arbor claim <task>`, read its `ARBOR.md`, the `### Handoff` under `## Notes`
first, and carry on from where it stands, as the task's agent from then on.
Say no Added card, since nobody added a task: start with the work, or with
a question its `### Handoff` leaves open.

## Handing on work another model fits better

Whoever started you picked your model before anyone knew the work, and
mostly picked well enough: keep the task by default. Hand it on only for a
reason this task has given you, one you can name in a sentence and the user
could check against `ARBOR.md` or the tree:

- **Up**, when your own work on it has shown it is beyond you: the same
  step failed twice after you changed course, or the plan hinges on a call
  you could not settle with confidence after investigating, and `arbor
  agents` names a model whose strengths cover it.
- **Down**, when most of the task is still ahead, every step of it is spelled
  out under `## Next`, and it is long and mechanical enough that a cheaper
  model saves more than it costs to read `ARBOR.md` and the tree afresh,
  such as the same edit across dozens of files.

None of these is a reason: the request sounds hard or easy, your model
seems too big or too small for it, or a cheaper model could probably do
it. When you are unsure, keep it.

Keep the task when the user named your model for it, or asked you to do it
yourself. Only an agent the user started hands on this way: one an
orchestrator handed a task to escalates instead, as above.

You stay the one the user talks to, as a lane's orchestrator does: the
other agent answers to you.

1. Do steps 1 and 2 of Handing off your task, the `### Handoff` stating
   the reason: what failed or what is left, with the steps or files that
   show it.
2. `arbor handoff <task> --relay --agent <id> --model <m>`, the cheapest
   model that fits. `arbor dev` starts it in your tree, and moves this
   conversation back to the main tree. Outside `arbor dev`, `--relay`
   refuses: keep the task, or hand it to a subagent of your own harness on
   that model, told to `arbor claim <task>` and work it as the skill says,
   reporting to you, as for a lane outside `arbor dev`.
3. End your turn on a working report: `## ⏳ Working <task>`, after a colon
   the agent and model it went to as `arbor agents` names them, then one
   sentence stating the reason, so the user can judge it and tell you to
   take it back.

```markdown
## ⏳ Working <task>: on Claude Sonnet 5.5

Forty files still need the same rename, each listed under `## Next`, so a cheaper model takes them.
```

From then on, work it as a lane's orchestrator works a todo it handed out
(see [references/lanes.md](lanes.md)), with the task in place of the lane:

- `[ARBOR REPORT <task>]`: read `arbor show <task>`. When it is gone, read
  in `git log` what landed and end on the report the task would have ended
  on, `## ✅ Merged <task> onto <base>` or `## 🛑 Removed <task>: <why>`,
  with the next todo (see The next todo), since the other agent proposes
  none. When it escalated, relay its questions or its review as Relaying
  for a lane's agents says, under a `## ⚠️ Escalated <task>: <what it
  needs>` or a Ready to merge card.
- `[ARBOR STOPPED <task>]`: ask what becomes of it, as for a lane, with
  "take it back" as a choice: once the user picks it, `arbor claim <task>`
  and carry on yourself.
- When the user asks for the task back while its agent works, ask them to
  terminate that agent from its conversation, then claim it on the
  `[ARBOR STOPPED <task>]` that follows.

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

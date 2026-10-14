# Handing out part of your task

`arbor add <part> --base task/<your task>` from inside your tree makes a task
that lands on your branch instead of trunk. While parts are out, keep your
tree committed (a part lands by fast-forwarding your checkout), re-read files
before editing them, and squash only after every part has landed. Hand a
part out only when describing it is shorter than doing it.

A subagent that may change code works in a part, never its own task on
trunk, so the user reviews one body of work rather than many small ones.
Add the part yourself, then tell the subagent:

- to `arbor claim <part>` and work only in the worktree it prints;
- not to escalate, report to the user, or take todos: it is your part, and
  you are the one the user hears from;
- to make each call the request does not settle as it sees fit, listing in
  its reply what it chose and what else it could have done, never under
  `## Blocked`, which would stop `arbor merge`;
- to squash and `arbor merge` the part when done, landing it on your branch.

When the user asks for the part to go to another agent, such as one of
another model family, run by `arbor dev`, hand it over as you add it:
`arbor add <part> --base task/<your task> --agent <id> --prompt '<what to
do, and the rules above>'`, with `--model <m>`. Read `arbor agents` first:
it lists each agent you can name and its models, with what each is good at
and what it costs. Take the agent and model the user names, else the
assignee `arbor todo show` gives for the part's todo, else the model whose
strengths fit the part at the lowest cost it is worth, a cheap one for a
mechanical part, and ask about that choice under `## Blocked`.
`arbor dev` starts that agent in the part's tree, sent `[ARBOR TASK
<part>]` and then your prompt. Its replies never reach you, so have the prompt ask it to list
its calls in the part's commit message, `arbor wait <part>` for it to land,
and read them in `git log`.

Write each call it lists under your own `## Blocked`, and redo the part when
an answer overturns one. A subagent that only reads needs no part. When the
user asks for the subagents' work to land on its own, give each one a task of
its own on trunk instead, and let it follow this skill as written.

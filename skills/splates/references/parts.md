# Handing out part of your task

`splates add <part> --base task/<your task> --goal "<what done means>"` from
inside your tree makes a task that lands on your branch instead of trunk. While parts are out, keep your
tree committed (a part lands by fast-forwarding your checkout), re-read files
before editing them, and squash only after every part has landed. Hand a
part out only when describing it is shorter than doing it.

Only `splates server` starts agents. A part goes to your harness's own
subagent, never to another agent: `splates add --agent` refuses a part, and
your subagents start no agents either. When the user asks for a part to go
to another model, run that subagent on it if your harness can; else do the
part yourself, and say so.

A subagent that may change code works in a part, never its own task on
trunk, so the user reviews one body of work rather than many small ones.
Add the part yourself, then tell the subagent:

- to `splates claim <part>` and work only in the worktree it prints;
- not to escalate, report to the user, or take todos: it is your part, and
  you are the one the user hears from;
- to make each call the request does not settle as it sees fit, listing in
  its reply those the user may need to settle, never under `## Blocked`,
  which would stop `splates merge`;
- to squash and `splates merge` the part when done, landing it on your branch;
- never to wait on you: when the part cannot land until work of yours does,
  to commit it, leave it unmerged, and say so in its reply.

A part's merge runs the tests on your branch, so a part that needs work of
yours, as tests need the fix they test, lands only once that work is
committed. Commit it before handing the part out, or merge the part yourself
when it comes back unmerged: `splates claim <part>` and `splates merge` from its
worktree once your work is in. A subagent your harness runs in the
foreground holds your turn until it returns, so one that waits on you waits
forever.

Treat each call it lists as your own (see Questions in the skill): a question
under your `## Blocked` when it needs the user, and redo the part when an
answer overturns one. A subagent that only reads needs no part. When the
user asks for the subagents' work to land on its own, make each piece a
todo rather than a task (see Todos in the skill), for `splates server` to
start once its lane runs: a subagent of your harness runs with your env, so
under `splates server` its claim of a task on trunk would move this
conversation into that task, though a part's leaves it be. Outside `splates
server`, give each subagent a task of its own on trunk instead, and let it
follow the skill as written.

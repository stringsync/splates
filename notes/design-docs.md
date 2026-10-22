---
description: What the files under designs/ record (the move from arbor, the worker pool, one task one queue, OpenCode) and how current each is
---

`designs/` holds design records whose settled decisions were made with the
user, not live documentation; each marks what is settled and what is open.
`splates.md`: arbor left webappwiz to become Spinning Plates, MIT and open
source under the stringsync LLC, every line public, with hosted workers and
a hosted coordinator the only thing that could ever be sold, never a held
back feature; hence the CLA. `worker-pool.md`: a short record of `splates server`
split into a coordinator and dial-out workers that ran agents, what stays of
it (the local worker, the protocol, joining, provisioning and budget) and
the 2026-10-22 decision that only this machine runs agents, cloud boxes
coming back as runners for heavy jobs. `simplify.md` ("One task, one queue"):
todos, lane orchestrators and handoffs replaced by tasks moving through
stages, a dependency-ordered queue workers take from, and hooks on events;
its "agents never start agents" is now enforced. `opencode-acp.md`: the opt-in
OpenCode plan, partly historical, its evidence synthetic.

A design is updated as its lane lands (dated "built" paragraphs), so read the
dates: a settled paragraph may have been superseded by a later one.

---
description: What .use(repository({ needs })) on a command means: it opens the repo or --project, checks the records' format, and enforces the cross-project grants read, tasks and own
---

A command that works on a repository runs behind `repository({ needs })`
from `packages/server/records/repository.ts`. It opens the repo `cwd` sits
in, or the project `--project <slug>` names, refuses records in a format
this build does not read, and puts `git`, `service`, `journal`, `config`,
`tasks` and the rest on the context.

`needs` is the reach another project's agent must have been granted to run
the command here: `read` (list, show, path, notes), `tasks` (add, remove,
queue edits) or `own` (claim, merge, update: no other project may run it).
The acting project is the one whose `splates server` conversation runs the
command, found from `SPLATES_CONVERSATION`, so an agent that `cd`s into
another repo is checked as a cross-project caller; a shortfall refuses with
`not_granted` naming the `splates projects grant` command. Every project may
`queue` into another's Untriaged lane without a grant.

---
description: What a task is: a numbered record with a stage (backlog, ready, queued, running), blockers that decide readiness, and a worktree name that is a slug, not its number
---

A task is the record `tasks/<N>.md`: JSON front matter splates reads and a
markdown body (`TaskRecord` in `packages/server/board/task.ts`). Numbers come
from `TaskStore.next()`, the larger of `tasks/last` and the highest id
present plus one, so a number is never reused after a removal; lane numbers
are not reused either.

`stage` is one of `backlog` (not groomed), `ready` (groomed: duplicates
looked for, blockers linked, a lane and model chosen), `queued` (the person
put it in the queue, or a lane queued whole did, and it stays while each
blocker is queued or running: otherwise the queue lets it go, see the
queue-runner note) and `running` (an agent
works it in a worktree). `groomed: true` stays on the record, so a task let
go from the queue returns to `ready`, not `backlog`. A merged or removed task
leaves `tasks/`; its last plan is kept in `finished/`.

`blockedBy` decides readiness (`isReady`); removing a blocker automatically
unlinks it from its dependents, without a hold for the person. Older
`blockersLost` holds can still be unlinked with `--remove-blocked-by`. A running task also has a worktree name, a slug, with branch
`task/<name>` and a checkout beside the repo, never inside it.

---
description: Removing a task is cheap and carries a reason; blocked work is removed with --reason blocked and reported as Deferred (yellow), not Removed (red), and Stats counts the reasons
---

Removing a started task is cheap and encouraged, since redoing it against
current trunk often beats a hard rebase, and each removal carries a reason:
`nothing` (nothing to change), `moot`, `superseded`, `redo`, `tests_failed`
or `blocked`. Work set aside because it waits on something is `splates
remove --reason blocked`: its agent reports `## ⏸ Deferred <task>: <what it
waits on>`, shown as a yellow Deferred card, because a red Removed card read
as the work being deleted when it was only put back on the list. The Stats
page counts the reasons apart.

Removing a task also removes the board tasks it took. Only `--reason blocked`
puts them back on the list, out of the queue and any queued lane, until the
person queues them again. Archiving a conversation also removes its task,
asking first only when the task has unmerged changes.

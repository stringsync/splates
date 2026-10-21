---
description: The records under .git/splates carry a format version; older records are migrated forward in a guarded child process and never written backward
---

`.git/splates/format` holds the records' format version; `FORMAT` is
`MIGRATIONS.length + 1` in `packages/server/records/format.ts`, 4 today
(`ONE_TASK_STORE`, `TASK_FILES` turning `tasks/<N>.json` into `.md`,
`TASK_STAGES` giving every task a `stage`). Any change an older splates would
misread adds a step. A step reads and writes raw JSON in the old shape, never
through today's types, and must be safe to run again after an interruption.

`Migration` backs the records up, runs the steps in a child `splates migrate`
(marked `SPLATES_MIGRATING`) killed after five minutes, and restores the
backup on failure; the failure is kept beside the records and refuses later
tries on that release until `retry`. `LAST_READ` names the last published
splates that read each old format. `splates server` migrates as it starts;
an older server would refuse records once moved, so `splates update`
restarts it first. Conversation logs carry their own `LOG_FORMAT`, and a
restart that cannot read one declines to resume the agent rather than resume
it wrongly.

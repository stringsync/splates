---
description: Automations (splates hook) run an agent or a shell command on a task event or a schedule; they are kept per person in the project records and never checked in, because an agent hook spends tokens
---

An automation fires on a task event from the journal (`task.created`,
`task.updated`, `task.ready`, `task.queued`, `task.started`, `task.done`,
`task.dropped`, narrowed by `--stage` or `--lane`) or on a schedule
(`--every 30m`, or a five-field `--cron` in local time). It starts an agent
in the main tree told `[SPLATES EVENT <event> #N]` or `[SPLATES SCHEDULE
<n>]` plus its prompt, or runs `--run` through `sh -c` with `$SPLATES_EVENT`,
`$SPLATES_TASKS` and `$SPLATES_TASK` set. `splates hook` does not touch an
agent harness's own hooks.

They live in `hooks.json` of the project records, per person and never checked in: a
checked-in agent hook would run on the account of everyone who clones the
repo. `splates.config.ts`'s `on` holds only shell commands. `HookRunner`
follows the journal from a cursor in `hooks-seen.json`, starting from now the
first time so nothing runs for the past, and a schedule missed while the
server was down runs once on start. Two are built in: the groomer, and
`notes-audit` (off by default, every 7 days), which defers a task for each
stale or contradictory note.

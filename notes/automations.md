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

`splates hook run <n>`, or the Automations page's Run now, runs one at once:
it stamps `requestedAt` on the automation, and the `Scheduler`, woken by
the write, fires it once per request (kept as `requestedAt` in
`hooks-runs.json`), as `[SPLATES SCHEDULE <n>]`, paused or not, its
schedule left be; its run lists as `by hand`. An agent hook's conversation keeps
the automation's id as `automation`, so the page lists it, by hand or not,
with the groomer, a bolt for its mark and an Automation tag; unlike the
groomer's, it is no persistent agent, and archives like any other. Only a schedule or the groomer
can be run by hand (`runsNow`); any other event hook needs its event's
tasks, so it has no Run now.

They live in `hooks.json` of the project records, per person and never checked in: a
checked-in agent hook would run on the account of everyone who clones the
repo. `splates.config.ts`'s `on` holds only shell commands. `HookRunner`
follows the journal from a cursor in `hooks-seen.json`, starting from now the
first time so nothing runs for the past, and a schedule missed while the
server was down runs once on start. Two are built in: the groomer, and
`notes-audit` (off by default, every 7 days), which defers a task for each
stale or contradictory note.

---
description: What splates calls a slot: the animal-word dev server slots; workers have none since agents are uncapped
---

Server slots are the short animal words (`fox`) that `splates server --slot`
claims for a worktree so a task can serve its own splates with its own home
`~/.splates/slots/<word>` and tunnel host `https://<word>.<zone>`; `splates
slots` lists and prunes them (`packages/splates/slots.ts`, `ports/slot.ts`).
A slot is refused on a project's main tree, and its word is held until the
task merges or is removed.

Workers had agent slots until 2026-10-26, when agents were uncapped and the
slot setting (`splates worker slots`, `worker run --slots`, `slots` in
`workers.json`) was removed; `worker run` still accepts `--slots` and
ignores it, since a supervisor started before then passes it. The
`Scheduler` (`workers/scheduler.ts`) places every agent at once on a worker
that is up. What waits, in `splates worker queue` (`waiting.ts`), first come
first served and never failed for waiting, is what splates starts on its own
(automations, hooks, the groomer, queue starts) while paused (`paused` in
`workers.json`, `PUT /api/workers/local`, the Queue page's Pause), with the
reason `paused`, and any agent while no worker is up. The person's own agents
start even while paused (`automatic: false` on the request and its listing).

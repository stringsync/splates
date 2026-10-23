---
description: The two unrelated things splates calls a slot: the animal-word dev server slots, and a worker's agent slots
---

Server slots are the short animal words (`fox`) that `splates server --slot`
claims for a worktree so a task can serve its own splates with its own home
`~/.splates/slots/<word>` and tunnel host `https://<word>.<zone>`; `splates
slots` lists and prunes them (`packages/splates/slots.ts`, `ports/slot.ts`).
A slot is refused on a project's main tree, and its word is held until the
task merges or is removed.

Worker slots are how many tasks a worker runs at once (`splates worker run
--slots`; default one per core or per 4 GB, whichever is fewer). Agents that
agents, automations, hooks or the groomer start each hold one; an agent the
person starts or the queue starts takes none. Those
waiting for room stand in `splates worker queue` (`waiting.ts`), first come
first served, never failed for waiting.

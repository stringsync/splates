---
description: The journal log.jsonl is the only record that a merged or removed task existed; every mutating command records itself there, and the page, hooks and Stats read it
---

`Journal` (`packages/server/records/journal.ts`) is append-only JSON lines in
the project's records; nothing rewrites it, so concurrent agents never lose
each other's events. It rotates into a segment every `logCapacity` events
(1000) and drops segments after 90 days. Merge and remove delete a task's
record, so the journal is what remembers a task existed; `splates log`
prints its tail.

A mutating command (add, claim, merge, remove, attach, waits) runs inside
`journal.record(action, task, work, facts)`, which appends the event with
`reason: null` on success or the refusal's reason on failure, with whatever
facts the command gathered so far: that is why `merge()` fills a `facts`
object as it goes. `FACTS` in `records/events.ts` lists every fact of every
action, checked at compile time, and an event missing one is not read.
Conversations, the page and automations follow it with `Journal.watch`, so
a task event is never lost to a restart. `splates notes` records nothing,
and a test pins that.

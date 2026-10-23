---
description: How a queued task starts: QueueRunner starts every unblocked queued task in queue order, taking no worker slot, backing off refused starts, lets go to ready one whose blocker is neither queued nor running, holds a conversation only for one that can start, and names its worktree from the slug or subject
---

`QueueRunner` (`packages/server/queue/runner.ts`) works the queue down. Every
queued task in `queueOrder` that no open task blocks starts as a task of its
own at once (no cap, since 2026-10-23: queue starts and their held
conversations are not `capped`, like the person's agents), on the agent and model it names,
else on what Auto pick decides at start. It looks again when tasks change,
and every minute. While the person pauses the queue from the Queue page it
starts nothing, and a held conversation that would be starting says `paused`;
resuming fires the scheduler's `changed`, which sweeps. A refused start is retried at once when
the task changes or the person retries it, otherwise after a number of
sweeps that doubles per refusal up to 30. A queued task gets a held
conversation, which the page shows as its place in line, only once it can
start; one waiting on a blocker has none, so it never sits at an agent.

A queued task waits on blockers only while each is queued or running
(since 2026-10-23). One blocked by a task that is neither, or by one removed
without merging, would wait for good, so each check lets it go back to
ready (or backlog), with `unqueuedFor` naming those blockers for the card's
"left the queue: queue #N first" line, and a `queue remove` journal entry.
A chain goes whole in one check (`stalled` in `queue/order.ts`). Queueing it
again, by hand or by a lane, clears `unqueuedFor` (`enqueued`).

The queue is worked out on every read, never stored: a task comes after
every task it depends on, otherwise in the position the person set. A lane
queued whole queues each of its tasks as soon as nothing blocks it. The
worktree name is the task's `slug`, else its subject lowercased, dashed and
cut at a word to 40 characters, with `-2`, `-3` for clashes
(`queue/name.ts`). `FakePicker` in `queue/testing.ts` stands in for Auto pick.

A task a queued lane started is told `queuePrompt` with "from the queue,
which lane N queued", and the page (`web/queue-start.ts`) draws that message
as an event line, `Started <task> from lane <name>`, as it does an early
warning; a task the person queued stays a regular message.

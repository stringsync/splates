---
description: How a queued task starts: QueueRunner sends the first unblocked task in queue order to a free worker slot, backing off refused starts, and names its worktree from the slug or subject
---

`QueueRunner` (`packages/server/queue/runner.ts`) works the queue down. When
a worker has a free slot, the first queued task in `queueOrder` that no open
task blocks starts as a task of its own, on the agent and model it names,
else on what Auto pick decides at start. It looks again when tasks change,
when a slot frees, and every minute. A refused start is retried at once when
the task changes or the person retries it, otherwise after a number of
sweeps that doubles per refusal up to 30. Each queued task gets a held
conversation so the page can say why it waits.

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

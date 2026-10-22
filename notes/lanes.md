---
description: What a lane is now (a named group of tasks the person can queue whole), the orchestrator design it replaced, and the fixed Untriaged and Backlog lanes
---

A lane is a name and a place on the board, nothing more: it neither runs nor
orders anything. For a few days in October 2026 a lane was a queue an
orchestrator agent worked through; "Stop running lanes" (2026-10-19) removed
that with `lane run`, `lane pause`, `task take` and `task release`, and the
same day lanes gained "queue whole": each task is queued as soon as nothing
blocks it, until the lane is empty, which is the still violet running ring on its
header. A task marked By hand sits under the lane outside the ring and is
skipped when a queued lane starts work. A lane ends when its last task merges
or is removed; one emptied by hand stays.

Untriaged holds tasks from other projects and deferred work for the groomer
to place; it cannot be queued whole. Backlog (lane 0) is permanent, holds
deferred work no lane matched, and always sits first after Untriaged.

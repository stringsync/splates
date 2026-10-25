---
description: A demo of a landed task always starts a fresh conversation in the main tree whose agent reads the task with splates show; the merged card's Demo it asks the current agent instead
---

Every demo of a finished task starts in a new conversation in the main tree,
told `[SPLATES DEMO <task> <point>]`, and its agent reads the task with
`splates show`. Earlier versions reused, unarchived or interrupted the
conversation that last worked the task; that was narrowed and then dropped
the same day, because the old conversation might be busy with other work.
In the task dialog the button reads "Demo with an agent" with a bot icon, so
it reads as starting an agent rather than playing a recording. The merged
card instead has a Demo it footer action beside Archive that asks the
conversation's own agent, the one that merged, since it already has the
context. A demo comes before a merge only for invasive or irreversible
changes, as the user's chance to step in; after a merge an agent offers no
demo unasked, though the person can start one from the card or the task.

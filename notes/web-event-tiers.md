---
description: Which splates events draw a line in a conversation (loud) and which fold into counts on their work row (quiet), and where to put a new action
---

`packages/web/event-tier.ts` (`tierOf`) sorts every event of a conversation:

- **Loud** keeps a hairline line (`EventUI`, `event-lines.tsx`) placed among
  the work, cutting its row. These change what the conversation is about or
  need the person: add (kept by this conversation), claim, merge and its steps, remove, handoff,
  retry, escalate, waits, cred requests, and the failure of the ones that
  change what happens next.
- **Quiet** has no line. `stretchesOf` (`work.ts`) never makes it a `Stretch`;
  `joined` puts it on `Work.events` of the row it fell in (the last row begun
  by its time), and `work-row.tsx` shows `QuietCounts` (`quiet-events.tsx`,
  counts from `quiet-counts.ts`) in the summary as plain words, not a control:
  the whole line opens the row, and there is no dialog. The open timeline
  (`work-timeline.tsx`) interleaves quiet events with calls by time as muted
  lines, no bullets, using the event words and chips; consecutive task updates
  or notes read fold together. An added task's line keeps Remove / Undo
  (`AddedLine`), Auto pick draws `AutoPickLine` with its findings and Undo, and
  a refused command with no line of its own draws `action: reason` with a red
  ✕. Notes read, Auto pick and adds handed to another agent have no count.
  Refusals take one of the three visible count kinds, with any remaining kinds
  folded into `+N more`. Any refused command not loud is quiet.
- `null` means shown nowhere (bare `attach`, actions with no line yet).

The work row stays one folded Working/Worked line, including while the turn runs.
Intermediate agent words appear only in its open timeline, among the calls; the
final reply stays in the thread.

A new action goes in the tier by whether the person must see or act on it;
if quiet, also give it a count in `quiet-counts.ts`. Anything deciding whether events came since the person
spoke (`thread.tsx`) must test `tierOf(event) === "loud"`, since quiet events
are not parts of the thread.

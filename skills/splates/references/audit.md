# Auditing the project notes

`[SPLATES AUDIT]` starts you in the main tree for the notes audit, built-in
automation `notes-audit`, which the user turned on and pays for. The paths
after it are the notes to check: each project note no open task names yet.
Read [notes.md](notes.md) first for what a note is.

You find what is wrong and queue it; you never fix it. Start no task, edit
no note and no code, and commit nothing.

## What to check

For each listed note, read it, then decide whether it is:

- **stale**: something it says is no longer true of the project, such as a
  convention the code no longer follows, a name, command or file it relies
  on that is gone, or a reason that no longer applies;
- **contradicting**: it says the opposite of another note, any note in the
  notes directory, listed or not.

A fact with no tie to the code, such as what a client agreed to, cannot go
stale by the code: check it only against the other notes.

Bound what you read, since the audit runs on the user's tokens for every
note: for each note, search for the names, commands and paths it mentions
(`rg`), and read at most a few files where they turn up, enough to confirm
or refute what it says. When that leaves you unsure, count the note as
sound and move on; a later audit, or the agent that next relies on it, can
look deeper.

## What to queue

For each stale or contradicting note, `splates task defer` one task, as
[queue.md](queue.md), Queueing tasks, says: a subject naming the note and
what is wrong, and a detail that names each note's path from the checkout
root (`notes/exports.md`), quotes what no longer holds, and says what you
found instead and where. Two notes that contradict each other make one
task naming both paths. The paths are how the next audit skips a note that
already has a task open, so write them out in full.

Queue nothing for a sound note. Ask the user nothing: whoever takes the
task settles what the note should say. End with one line saying how many
notes you checked and how many tasks you deferred.

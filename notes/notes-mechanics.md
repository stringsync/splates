---
description: How project notes are read by splates: flat .md files in notesDir with a required one-line description, listed by splates notes, printed at every merge, reads counted in note-uses.jsonl, and judged per message and turn when the project has a judge
---

`Notes.list` (`packages/server/notes/notes.ts`) reads the flat
`config.notesDir` directory (`notes` by default) in filename order, skipping
subdirectories and non-`.md` files. Each note's front matter, parsed with
`webappwiz/md`, must have a one-line `description`; a missing one, or a
block scalar (`|` or `>`), throws, and merge then logs `project notes not
read` instead of the index. `splates notes` prints descriptions only, since
notes are disclosed progressively: an agent reads the few that fit.

`NoteUses` (`notes/uses.ts`) counts reads in `.git/splates/note-uses.jsonl`:
a conversation counts as having read a note when a non-editing tool call
names its path, and listing descriptions counts for nothing; the Notes page
shows the counts so the person sees where to spend attention. The Notes
page lists notes from the main tree through `/api/notes`, and its New, Edit
and Remove start an agent conversation holding the note, so a note changes
through a task and a merge, with history, never a page commit. The
`notes-audit` automation reads only notes no open task names.

Under `splates server` the project's judge weighs notes twice, each judgment
a journal event for the Stats page: before a message reaches the agent,
`routing` (`notes/route.ts`) attaches pointers to the notes that bear on it
(`notes attached`), and after each turn that read a note, `weighing`
(`notes/applied.ts`) asks whether the turn's actions applied it (`note
applied`, with the tier its pointer had or `unprompted`). With no judge
neither runs. Routing's request also asks whether the message corrects the
agent, given its last reply (`corrects`), for the correction rate. Both keep
what Jev said the request cost (`dollars`, split over the notes weighed), and
ask the judge with `purpose: "notes"`, so the ledger names their spend
`jev-latest notes`, a row of its own on Billing beside Auto pick's
`jev-latest`. `note read` keeps the note's `bytes` and the conversation's
`context` tokens as it was read.

The tiers' bars and caps are `ROUTING` (`notes/tiers.ts`), tuned on
2026-10-21 against 94 recorded judgments labelled by hand: a `notes
attached` event holds no message text, so each was joined to the last
`prompt` record at or before its `at` in `conversations/<id>.jsonl`. At
p ≥ 0.8 nine in ten notes bore on the message, between 0.7 and 0.8 half, and
between 0.5 and 0.7 under a quarter, so the optional tier starts at 0.7 and
takes one. The judge answered in about 0.3s (p95 0.5s, never over 0.9s),
hence the 2s timeout.

The Stats page's Notes section (`stats/notes.ts`, served per project at
`/api/stats/notes`) reads those events from the project's journal beside the
machine's outcomes and adherence: conversations with pointers against the
holdout, a conversation's arm being what its first `notes attached` said, and
per note the reads after its pointers, applied rate and unprompted reads,
then corrections and turns per merged task (`Outcome.turns`) by arm, the
judge's spend, and the notes' share of context at about 4 bytes a token. The
later facts are optional, so events from before them still read.

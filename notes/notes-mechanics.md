---
description: How project notes are read by splates: flat .md files in notesDir with a required one-line description, listed by splates notes, printed at every merge, and reads counted in note-uses.jsonl
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

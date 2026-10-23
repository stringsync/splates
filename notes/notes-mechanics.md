---
description: How splates reads, lists and counts project notes, and how the Notes page changes them; bears on note files, their frontmatter and the Notes page
---

Project notes are flat `.md` files in `config.notesDir`, each with a
required one-line `description`. `splates notes` prints only the
descriptions, and an agent reads the few that fit. A note changes only
through a task and a merge, never a page commit.

## Reading and listing

- `Notes.list` reads the flat `config.notesDir` directory (`notes` by
  default) in filename order.
- It skips subdirectories and non-`.md` files.
- Each note's front matter is parsed with `webappwiz/md`.
- A missing `description` throws, and so does one written as a block
  scalar (`|` or `>`).
- Merge then logs `project notes not read` instead of the index.
- `splates notes` prints descriptions only, since notes are disclosed
  progressively: an agent reads the few that fit.

## Counting reads

`NoteUses` counts reads in the `note-uses.jsonl` log of the project
records. A conversation counts as having read a note when a non-editing
tool call names its path. Listing descriptions counts for nothing. The
Notes page shows the counts, so the person sees where to spend attention.

## The Notes page

The Notes page lists notes from the main tree through `/api/notes`. Its
New, Edit and Remove start an agent conversation holding the note. So a
note changes through a task and a merge, with history, never a page
commit.

The `notes-audit` automation reads only notes no open task names.

How the project's judge routes and weighs notes is in
[notes-routing.md](notes-routing.md).

## Where

- `packages/server/notes/notes.ts`: `Notes.list`
- `packages/server/notes/uses.ts`: `NoteUses`
- `packages/server/merge/merge.ts`: `project notes not read`
- `packages/server/hooks/garden.ts`: `AUDIT_AUTOMATION` (`notes-audit`)

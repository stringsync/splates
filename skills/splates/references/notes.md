# Project notes

Notes are durable prose about how a project is meant to work: conventions,
decisions and their reasons, or facts such as what a client agreed to.
Run `splates notes` when you need that context, before reading code for it,
and when you learn something worth keeping. It prints each note's
description, one per line. Read the relevant files; search with `rg`.
No notes directory means no output.

Notes live as checked-in Markdown files in a flat `notes/` directory at the
checkout root. A project's `splates.config.ts` may set `notesDir` to another
directory, relative to that root or absolute. Each file has one thing to say
and a one-line frontmatter description:

```markdown
---
description: Why exports name each module explicitly
---

Releases bundle each exported entry, so each module has an explicit entry.
```

Keep notes short and edit them in place; git keeps their history. The
description says what the note is about, so someone can find it without
knowing the project's file layout. Keep no index file or path metadata.

Change notes through a task: `splates add`, edit, and `splates merge`, just
as for code. Use your current task when the note belongs to its work.
Keep project notes in their own files; `AGENTS.md` and `CLAUDE.md` are the
user's to control agents' context with. Never write notes into them or
arrange for them to load notes.

Keep sensitive information out: secrets, personal details, and nonpublic
things a client or third party said. Consider where the repository is
published, including npm. When unsure, ask the user in the skill's numbered
questions format and wait for the answer before committing the doubtful note.

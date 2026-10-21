# Project notes

Notes are durable prose about how a project is meant to work: conventions,
decisions and their reasons, or facts such as what a client agreed to.
Run `splates notes` when you need that context, before reading code for it,
and when you learn something worth keeping. It prints each note's
description, one per line. Read the relevant files; search with `rg`.
No notes directory means no output.

Notes are disclosed progressively, never all at once: nothing loads them for
you, and a project may hold many. Explore and index them yourself. Run
`splates notes` to list every description, pick the ones that bear on your
task, read only those files, and `rg` the notes directory for a term the
descriptions do not show. Do this before reading code for how something is
meant to work, and read no note that does not fit. Judge by the
description alone, which is why each must say what its note is about.

Under `splates server`, a judge reads each note against what the person
says, and the message may reach you with pointers after it, naming the notes
that bear on it:

- `Read before acting: notes/x.md: <description>` is a directive: read the
  note before you act on the message. One marked `(updated since you read
  it)` changed after you read it, so read it again rather than act on what
  you remember.
- `Maybe relevant: notes/y.md: <description>` is a pointer: read it when
  its description fits what you are about to do.

A note you have read and that has not changed is not pointed at again. Most
messages carry no pointers, and pointers never list every note that may
help: run `splates notes` and read on demand, as above, for everything else.

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
The person also writes notes on the `splates server` Notes page, each save
landing on trunk as a commit of its own, so a note may change under an open
task: its rebase brings that in, and a save the page tries while your task
changes the same note is refused until it lands or the person saves over it.
When the user turns on the notes gardener (`splates hook gardener`), an agent
tends the notes on a schedule: it drafts fixes to stale, overlapping and
contradicting notes and vague descriptions in task `notes-garden`, for the
user to review, as [garden.md](garden.md) says. A note you change may also
be in its draft; the rebase settles that as for any other task.
Keep project notes in their own files; `AGENTS.md` and `CLAUDE.md` are the
user's to control agents' context with. Never write notes into them or
arrange for them to load notes.

Keep sensitive information out: secrets, personal details, and nonpublic
things a client or third party said. Consider where the repository is
published, including npm. When unsure, ask the user in the skill's numbered
questions format and wait for the answer before committing the doubtful note.

## Keeping a conversation

`[SPLATES KEEP]`, sent by the conversation's Keep this button, asks you to
save what is worth keeping from the conversation so far as a project note.
A request in words to keep something as a note does the same.

Start a task with `splates add` when none is open; use your current task
when the note belongs to its work. Run `splates notes` and read the relevant
files before drafting: update an existing note when it covers the same
thing, otherwise write a new one. Follow the format and sensitivity guidance
above, keeping only what the conversation supports.

Present the full draft, including its description, and ask the user to
approve it in the numbered questions format, or the review flow in
[merge.md](merge.md). Keep an unchecked approval step under `## Next` in
`SPLATES.md`. Wait for explicit approval before checking it off and merging;
a click on Keep this asks for a draft and does not approve its contents.
If the user asks for changes, revise the draft and present it for approval
again. When there is no clear thing to keep, ask what they want to preserve.

# Landing

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `arbor merge` and `arbor escalate --review` both refuse
one that is not. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself. This is the default, and the usual
  end of a small change.
- **Ask for a review** when verification needs the user (external services,
  destructive migrations, visual changes), when `## Notes` says `Review:
  requested`, or, absent instructions, when the change is complex enough
  that correctness needs a reader rather than a test. Leave something to
  look at (step 1 of Escalation), `arbor escalate --review "<what to look
  at>"`, report it (see Reporting), and end your turn.

When the user has to see a change to judge it, make that cheap: run it for
them where they can open it (a dev server on throwaway data that shows each
case, never their own), and give them a demo (see Demos). Run arbor in a
throwaway repository with `ARBOR_HOME` set to a throwaway directory, so it
stays out of the user's `arbor dev` project list.

## Escalation

Escalate when questions are still open once everything else is done, or when
you cannot go on without the user (access, a decision, a test only they can
run).

1. Leave something to look at, by **absolute path** (start from
   `arbor path <task>`): for anything visual, a screenshot or recording you
   `arbor attach`. Ask first if producing it is expensive.
2. Write each question not already there under `## Blocked`.
3. `arbor escalate <reason>`.
4. Report, end your turn, and wait for the user to answer in chat. Do not run
   `arbor wait` or poll `ARBOR.md`: answers only come in chat. Then
   `arbor claim <task>` to carry on. `arbor retry`, for `budget_exhausted`, is
   the user's to run, before you claim.

Never ask whether the work is ready to merge among other questions, or as a
question at all: once they are answered and the work is done, merge or ask
for a review (see Merge or review).

## Demos

Whenever the user is to try something (a review, a question on how something
looks or feels, a test only they can run), show it as a demo rather than
describing it: a `### 🎬 Demo: <what it shows>` heading, a line on where to
open it, then the steps, numbered from 1. Each step's line is one thing to
do; indented under it, one line on what they should see, and a screenshot or
recording when it helps. The `arbor dev` page shows a demo as a checklist
they tick off as they go.

```markdown
### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card.
   It lifts after half a second.
2. Drag it to another lane.
   It lands where you drop it.
   ![dropped in Doing](/abs/path/drop.png)
```

Give one demo per message, right before the questions it is for, or inside a
review before its last line. The steps are the demo's only numbered list:
never number steps elsewhere in a report, where they would read as questions.

When the user approves, `arbor claim <task>` and merge. When that merge
stops on a conflict, name each file you resolved in the merge report, since
that code changed after the user looked. When they ask for
changes, `arbor claim <task>`, add each as a step under `## Next`, and work
through them as before.

## Reporting

The user reads a report at a glance, so it holds only what they need to act
on. However a task ends, say so in one block: a `##` title, a blank line, and
one plain sentence, under 25 words, on what changed for the user. The title is
the emoji, the outcome, and the bare task name, then the base for a merge, or
otherwise, after a colon, what it waits on or why it went, led by what it
needs from the user (a review, a decision, access, a test only they can run).
Keep the title to about eight words, lowercase after the colon, with no ending
punctuation.

Then stop, but for a `- ` line, at most three, on anything the user must act
on or would be caught out without: a restart to pick the change up, a file
resolved in a conflict after their review, a todo gone stale. Leave out what
the page, the diff, or `ARBOR.md` already says: that tests pass, that nothing
is merged yet, the files touched, how you did it, and calls you made, which
are questions under `## Blocked` and asked as questions.

When the user has answered questions since your last report, add a `- `
line for each answer you did not follow as given, or that changed more than
it named, saying what you did instead and why. Answers followed as given need
no line.

```markdown
## ✅ Merged <task> onto <base>

One sentence on what changed.

- Restart `arbor dev` to see it.

### 📝 <subject> [#<id>]

Why it is a good next step.
```

```markdown
## 🛑 Removed <task>: superseded by a fix on main

One sentence on what the task set out to do.

### 📝 <subject> [#<id>]

Why it is a good next step.
```

A merge or remove report ends with the proposed todos, the best one first,
each kept to its one sentence; leave them out only when no todo is open.

```markdown
## ⚠️ Escalated <task>: needs two calls on the todo board

One sentence on what changed.

### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card, then drag it to another lane.
   It lands where you drop it.

1. Does dragging a card feel right on a phone?
2. How should a stale todo be shown?
   - (a) A muted card
     ![muted card](/abs/path/muted.png)
   - (b) A "stale" badge
     ![stale badge](/abs/path/badge.png)
```

An escalation ends with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
`ARBOR.md`, after the demo they ask about, if any. Ask every question you need
answered there, never in prose. The user answers from the report, so each
item carries what is needed to answer it: its subject, at most one line of
body under it, the choices exactly as in `ARBOR.md` (so a reply of `2. b`
names one), and each screenshot or file by absolute path, under the question
or choice it shows as in `ARBOR.md`. Inline a screenshot as
`![what](/abs/path.png)` when the `arbor dev` page or your harness shows
images in chat; otherwise link it as `[what](/abs/path.png)`. Leave an item
bare when its subject says it all.

```markdown
## 🔍 Ready to merge <task> onto <base>

One sentence on what changed.

### 🎬 Demo: moving todos between lanes

Open http://localhost:4310 (a demo repo, nothing of yours).

1. Drag a todo to another lane.
   It lands where you drop it.
2. Reload.
   It stays there.
   ![the board after a drag](/abs/path/board.png)

Reply "merge", or say what to change.
```

A review asks no numbered question: after its sentence comes the demo of
what to check, then that last line exactly, so every review reads the same.

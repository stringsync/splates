---
name: arbor
description: Use the @webappwiz/arbor CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in an arbor repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, escalate, or defer a task, or add, pick up, link, or reorder a todo, or work down a lane of them.
version: 0.0.43
---

# Using arbor

`arbor` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @webappwiz/arbor <command>` (or
`arbor` if on PATH). `arbor --help` explains the commands; this file covers
only what the CLI cannot tell you.

**Rule:** never use raw git for state transitions arbor covers: every landing
goes through `arbor merge`. The exception is finishing a rebase left in
progress (`git add`, `git rebase --continue`), then merging again. A failed
command prints `{reason}` JSON on stdout and instructions on stderr: do what
stderr says.

The rest of the skill is in `references/`, each file read at the moment it
names, never up front:

- [`todos.md`](references/todos.md): before you add, update, groom or
  propose a todo.
- [`questions.md`](references/questions.md): before you first write a
  question under `## Blocked`, and whenever the user replies.
- [`landing.md`](references/landing.md): before you merge, ask for a review,
  escalate, or report a task's end.
- [`lanes.md`](references/lanes.md): on `[ARBOR LANE N]`.
- [`parts.md`](references/parts.md): before you hand work to a subagent or
  another agent.
- [`systems.md`](references/systems.md): before you offer to name a system.

## Workflow

1. **Start before you look.** When a request may end in a code change,
   `arbor add <task>` before reading any code, and investigate in its
   worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree.
   `arbor claim <task>` resumes a task instead, as `[ARBOR TASK <task>]`
   from the `arbor dev` page asks: claim it, read its `ARBOR.md`, and carry
   on from where it stands. When the request is a todo,
   such as `[ARBOR TODO #N]` copied from the `arbor dev` page, `arbor todo
   show N` prints what is asked; if it names another task that took it, tell
   the user rather than start on it. Otherwise take it now, so no other agent
   starts on it: `arbor add <task> --todo N`, or `arbor todo take N` from a
   task under way. `[ARBOR LANE N]` hands you a whole lane instead (see
   `references/lanes.md`). Pass `--base <branch>` only when invoked with a branch
   (`/arbor feature/auth`) or the user names one; never guess a base from the
   checked-out branch. Once `arbor add` succeeds, say what you added before
   anything else (see Saying what you added).
2. **Plan.** Once you know what done means, fill in `ARBOR.md` before
   touching code (see ARBOR.md below), then groom the todos your work touches
   (see Grooming related todos in `references/todos.md`).
3. **Check for overlap.** Read `arbor list --files`: each task's Goal and
   the files it has changed so far. Some overlap is normal: work alongside,
   accept the rebase, and note it in `ARBOR.md`. Only when conflicts would be hard to resolve, `arbor wait
   <task>` for the other task to land first. If it is doing the opposite of
   what you were asked, escalate instead.
4. **Work.** Commit each step with git as you go, and move it to `## Done`
   as you commit it; arbor never commits for you. When something outside
   your Goal comes up (a bug next door, a follow-up, a reply that widens the
   task), `arbor todo add` it from your worktree and move on,
   so the task stays one coherent change, and name it in the reply that
   ends your turn (see Proposing a todo in
   `references/todos.md`). Ask about each call the request
   does not settle as you make it, and keep going (see Asking as you go
   below), bringing `## Blocked` up to date before each step.
5. **Land.** Once every step under `## Next` and every question under
   `## Blocked` is checked, the task is ready to merge: `arbor todo add`
   any step you will not do, then check it off. Groom again, release each
   todo you only partly did (see `references/todos.md`), squash to one commit (see
   Committing), and `arbor merge`, or ask for a review first (see Merge or
   review in `references/landing.md`). On failure, do what stderr says and merge again. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else.

   Each `conflict`, `tests_failed` or `merge_failed` spends one of the
   task's merge attempts, so write under `## Notes` what each one failed
   on. When `merge` stops on `budget_exhausted`, escalate (see Escalation
   in `references/landing.md`)
   and tell the user why merging keeps failing: a `- ` line per attempt on
   what it failed on (the files that conflicted, the check that broke, the
   tree in the way), then one on what would get it through, so they can
   choose between `arbor retry` and a remove and redo.

**Clean up every task you start.** A task ends in a merge or a remove, never
left behind; one escalated and waiting on the user is not done, so leave it
for `arbor claim`. When investigating shows there is nothing to change, the
work is moot, or it is better redone against current trunk, `arbor todo
remove` each todo it holds that is done or moot, `arbor todo update` the rest
with what you learned, then `cd "$(arbor path)"` and `arbor remove <task>`,
which puts them back on the list.

`wait` ends on `removed` (landed or dropped: check for overlap again),
`escalated` (the other task needs the user: tell them you are blocked on it),
or a broken status (`wait` once more, then ask). Judge a task by its status,
never its lease: `stale` is normal for one mid-edit.

## Saying what you added

When `arbor add` makes your task, say so in a message of its own, which the
`arbor dev` page shows as a card: a `## 🌱 Added <task>` title, a blank line,
and the Goal, one or two lines on what done means as you understand it so
far. Say it once per task, never for a claim.

```markdown
## 🌱 Added <task>

Stop retrying an upload the server refused as too big, and tell the user why.
```

## Systems

A repo can name parts of its code as systems in `arbor.config.ts`, each a
name, its aliases, and the globs of the files it is made of. `arbor systems`
prints them, `arbor systems <name>` one by its name or an alias, and
`arbor systems --task <task>` those a task's changed files fall in. Read them
when you need them, never up front. Wherever a system covers what you mean,
call it by its name in Goals, todos, questions and reports, so the user and
every agent use one word for one part of the code. A prompt from the
`arbor dev` page that mentions `#name` ends with a line on what that system
is made of, or, when no system answers to it, a line saying so.

Only the user names a system, and you offer to (see `references/systems.md`)
when they keep calling code by a phrase no system has, use a phrase or
`#name` no system answers to, or when your task touches files no system
covers, at most once per task.

## Checkpoint

`[ARBOR CHECKPOINT]`, sent by the `arbor dev` page, means your process is
about to stop, as for a restart, and the next prompt picks the work up. Stop
where you are and start nothing new:

1. Leave a step you are in the middle of as it is, unless it is an `arbor
   merge`: finish that first.
2. Bring `ARBOR.md` up to date: `## Done` and `## Next` as they stand, each
   open question under `## Blocked`, and under `## Notes` what you were doing
   when stopped and what comes next. With no task, there is no `ARBOR.md`.
3. Reply with one line on where you stand, and end your turn.

`[ARBOR RESUME]`, sent after a checkpoint, means carry on: read `ARBOR.md`
again and go on from where `## Notes` says you stopped. With no task, carry on
with what you were asked.

## Asking as you go

Do not save questions for escalation. Whenever you make a decision that does
not clearly follow from what the user asked (a name, a default, behavior they
never mentioned, one reading of an ambiguous ask), write a question under
`## Blocked` in `ARBOR.md` right away, saying what you chose and what else you
could have done, and carry on: the user can answer in chat while you work.
When an answer overturns a choice, redo that part.

The format the `arbor dev` page reads questions in, and how to read the
user's answers, are in `references/questions.md`. In any message, two or more
questions go in a list numbered from 1, never a bulleted one.

## ARBOR.md

Your session can die at any moment; `ARBOR.md` is what lets a stranger
`arbor claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

````markdown
# <task>

## Goal

One or two lines on what done means.

## Done

- [x] finished steps: the only progress the task reports

## Next

- [ ] every step you can foresee, roughly one commit each

## Notes

Decisions, dead ends, and how to verify.
````

The Goal's first line is what other agents see of your task in `arbor list
--files`, so make it say what you are changing. Keep the rest current as you
go, not at the end: move steps to `## Done` as they land. Run `arbor show <task>` after writing it to check
the shape. It is excluded from git: never mention it in a commit message.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

Before `arbor merge`, squash to one commit describing the net change, what
the base gains, not the path you took:

```sh
git reset --soft "$(git merge-base <base> HEAD)" && git commit -m "<message>"
```

`<base>` is what `arbor show <task>` prints: trunk unless the task was created
with `--base`.

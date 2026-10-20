---
name: splates
description: Use the splates CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in a splates repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, or defer a task, or queue, pick up, link, or reorder a task for later, or work down a lane of them.
version: 0.0.47
---

# Using splates

`splates` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @stringsync/splates <command>` (or
`splates` if on PATH). `splates --help` explains the commands; this file covers
only what the CLI cannot tell you.

A bare `splates` prints help; start the server explicitly with `splates server`.
`splates dev` is only for developing the splates repository, through its
checkout's `bin/splates`; it is not a command in the published CLI.

**Rule:** never use raw git for state transitions splates covers: every landing
goes through `splates merge`. The exception is finishing a rebase left in
progress (`git add`, `git rebase --continue`), then merging again. A failed
command prints `{reason}` JSON on stdout and instructions on stderr: do what
stderr says.

## Directives

A prompt that starts with `[SPLATES ...]` comes from the `splates server` page or
from splates itself, and asks what the table says. A row that names a file
asks you to read it as Reference files says.

| Directive | What it asks | What to do |
| --- | --- | --- |
| `[SPLATES TASK #N]` | Take queued task N | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <task> --task N`, then, when `splates task show N` says `groomed: no`, groom it as [queue.md](references/queue.md) says under Grooming a task you start |
| `[SPLATES TASK <task>]` | Resume a task | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands |
| `[SPLATES SETUP <step>]` | Walk the user through one step of setting splates up, from the Setup page | [setup.md](references/setup.md) |
| `[SPLATES MERGE]` | The user approved your review, from the Ready to merge card | As for a reply of "merge": see Merge or review |
| `[SPLATES APPROVE]` | The user approved your proposal, from its card, with any answers after it | As for a reply of "approve": see Proposing |
| `[SPLATES DEFER]` | Queue the request after it as a task rather than do it; alone, make the user's message before it one, and stop | [queue.md](references/queue.md), Deferring |
| `[SPLATES QUEUE]` | Work out with the user what the request after it wants, or, alone, their message before it, then add it as a task, groom it yourself and queue it, never doing it | [queue.md](references/queue.md), Queueing for the user |
| `[SPLATES GROOM #N]` | You are the project's groomer: organize backlog task N and mark it ready, never doing it | [groom.md](references/groom.md) |
| `[SPLATES EVENT <event> #N <task>]` | A hook the user set on a task event (`task.created`, `task.done`, ...) started you for it | Do what the prompt after it asks, about task N; `splates task show N` prints it. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES SCHEDULE <n>]` | An automation the user set on a schedule (`splates hook add --every` or `--cron`) came due and started you | Do what the prompt after it asks. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES DEMO <task> <point>]` | The user asked to see a task's demo, at `before`, `after` or `main`, from its task dialog | [demos.md](references/demos.md), Running a demo |
| `[SPLATES CHECKPOINT]` | Bring `SPLATES.md` up to date and stop, as before a restart | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RESUME]` | Carry on from where `SPLATES.md` says you stopped | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RECONNECT]` | A lost connection cut your last turn short, and splates, once it is back, or the user asks you to carry on | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it.

- Before `splates lane add`, `splates lane queue` or `unqueue`, `splates queue
  add`, `splates task defer`, or `splates task add`, `splates task update` or `splates lane
  update` with `--lane`, `--position`, `--blocked-by` or `--ready`:
  [references/queue.md](references/queue.md), linking, placing and ordering
  queued tasks.
- When the user asks to set splates up on this machine, or any part of it
  (agents, remote access, workers, a cloud server, a tunnel of their
  own, dictation): [references/setup.md](references/setup.md),
  one step at a time.
- When your work needs a secret only the user can get, such as an API token:
  [references/creds.md](references/creds.md).
- When work here needs another splates project, or you run `splates
  --project`: [references/projects.md](references/projects.md).
- When `splates artifact add` stops on `too_large`, or the user asks about
  artifact space: [references/artifacts.md](references/artifacts.md).
- Before asking the user a question, after a reply, or when resuming a task
  with questions under `## Blocked`: [references/questions.md](references/questions.md),
  asking, recording answers and keeping Blocked current. Also read it when
  you cannot go on without the user.
- Before making a demo, starting a server for the user to try, attaching
  screenshots or recordings, or creating or managing an artifact:
  [references/demos.md](references/demos.md), demos, hosting and artifacts.
- Before replying with a task outcome (merged, removed, waiting on answers
  or ready for review): [references/reporting.md](references/reporting.md),
  the exact report formats the page turns into cards.

## Workflow

1. **Start before you look.** When a request may end in a code change,
   `splates add <task> --goal "<what done means>"` before reading any code,
   the Goal one or two lines as you understand it so far, and investigate in
   its worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree.
   `splates claim <task>` resumes a task instead. When the request is a queued task,
   take it as `[SPLATES TASK #N]` says under Directives, and for any other
   directive, do what its row says. Pass `--base <branch>` only when invoked
   with a branch (`/splates feature/auth`) or the user names one; never guess a base from the
   checked-out branch. Once `splates add` succeeds, the `splates server` page shows
   it in your conversation as splates's own line, the Goal on its task, so say
   nothing about adding it. When your harness asks right after for a word on
   what you are doing, say in one line what you will do next, without the
   task's name or Goal, which that line already shows.
2. **Plan.** Once you know what done means, sharpen the Goal in `SPLATES.md`
   before touching code, and when the work will take several commits, list
   them under `## Next` (see SPLATES.md below).
3. **Check for overlap.** Read `splates list --files`: each task's Goal and
   the files it has changed so far. Overlap is normal: work alongside, and
   resolve any conflict as the rebase brings it, without waiting on the
   other task or noting it anywhere. If it is doing the opposite of what you
   were asked, ask the user instead (see [Questions](references/questions.md)).
   `splates add` warns when file paths in the Goal or the first changes overlap
   open tasks. Coordinate those files or queue dependent work with `--blocked-by`.
   While the server runs, `splates list` and `show` name coming conflicts at
   committed branch tips, and a working agent hears a notice when one appears.
   These checks never rebase a worktree; commit in steps so they can see the work.
4. **Work.** Commit each step with git as you go, and check off any under
   `## Next` as you commit it; splates never commits for you. When something outside
   your Goal comes up (a bug next door, a follow-up, a reply that widens the
   task), `splates task add` or `defer` it from your worktree and move on,
   so the task stays one coherent change; the conversation shows what you
   queued (see Queueing tasks). A snag on the way, such as a lost
   connection, a conflict or a retry, is no task to queue; `splates merge` queues one
   itself for each test that failed its gate. Ask the user each call their
   answer would change, and make the rest yourself (see [Questions](references/questions.md)), bringing
   `## Blocked` up to date before each step. A subagent of your harness that may
   change code works in your worktree, with no task of its own: tell it the
   path, to commit there, to run no `splates` command that adds, claims,
   merges or removes a task, and to list in its reply any call the user
   may need to settle, which you treat as your own. Subagents at work at
   once share the tree, so give each its own files. Run a whole test suite, an install, or anything as heavy as
   `splates heavy -- <command>`, unless the project's instructions say its
   script takes a slot itself: it waits for one of the machine's few
   heavy-job slots, so agents testing at once queue rather than run it out
   of memory.
5. **Land.** Once every step under `## Next` and every question under
   `## Blocked` is checked, the task is ready to merge: `splates task add`
   any step you will not do, then check it off, `splates task add` or
   `defer` each follow-up you would otherwise offer or ask about once it
   lands (see [Reporting](references/reporting.md)), and `splates merge --message
   "<message>"` (see Committing), or ask for a review first (see Merge or
   review). On failure, do what stderr says and merge again, with the
   real message: never merge only to read a failure again, since one whose
   gate passes this time lands. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else.

   An existing Git `index.lock` stops merge as `blocked` without spending an
   attempt. Wait for its owner to finish and merge again; never delete a lock
   held by a live operation. A failed rebase with no unmerged paths is
   `merge_failed`, not a content `conflict`.

   Each `conflict` or `merge_failed` spends one of the task's merge attempts.
   A `tests_failed` spends one only when the failing test files passed on the
   exact base commit and failed again with the task. Trunk-red and environment
   failures hold the merge without charging; fix what the output names before
   retrying. Bun JUnit reports enable selective attribution; missing reports,
   unsupported runners, and inconclusive retests hold without charging. A flake
   can land only after the complete gate passes again. Conflicts are expected: resolve them and say
   nothing of them, in `SPLATES.md`, a report or a task. Write under
   `## Notes` what each `tests_failed` or `merge_failed` failed on. When
   `merge` stops on `budget_exhausted`, ask the user (see [When you cannot go on](references/questions.md#when-you-cannot-go-on)):
   a `- ` line per attempt on what it failed on (the check that broke,
   the tree in the way, or that it conflicted), one on what
   would get it through, then a question choosing between `splates retry
   <task>`, theirs to run (or the page's Retry), and a remove and redo.

**Clean up every task you start.** A task ends in a merge or a remove, never
left behind; one waiting on the user's answers is not done, so leave it for
`splates claim`. When investigating shows there is nothing to change, the
work is moot, or it is better redone against current trunk, `splates task
remove` each queued task it took that is done or moot, `splates task update` the rest
with what you learned, then `cd "$(splates path)"` and `splates remove <task>
--reason <why>`, which puts them back in the queue. The reason is `nothing`
(nothing to change), `moot`, `superseded` (done some other way) or `redo`
(better redone against current trunk); the Stats page counts them.

`wait` ends on `removed` (landed or dropped: check for overlap again),
waits on a person (the other task's questions are open: tell the user you
are blocked on it),
or a broken status (`wait` once more, then ask). Judge a task by its status,
never its lease: `stale` is normal for one mid-edit.

## Queueing tasks

When something outside your Goal comes up, queue it as a task and move on:
its subject and what you know. `splates task add` makes it ready, which
says you groomed it: you checked no task already asks it, linked what
blocks it, and put it in a lane when its lane is plain (see
[references/queue.md](references/queue.md)). When you know too little of it
to do that without looking into it, as for a rough idea or a request
deferred as it came, `splates task defer` it instead, which takes the same
flags and leaves it in the backlog for whoever grooms it. Leave its position
to the user and the queue, unless the user names it. Leave its model off
too, unless the user names one: a task that names none goes to Auto pick,
which judges its words and starts it on the agent, model and thinking level
the user's rules give.

Write a task's subject short enough to scan. Put the why, the where, the
files and the feature in its detail, as markdown the `splates server` page
renders: paragraphs, lists, `- [ ]` steps, inline code for paths and
commands, and fenced blocks for snippets. Single quotes keep the shell off
the backticks:

```sh
splates task add "Upload retries forever on a 413" 'The client retries on any 4xx in `src/upload.ts`.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big'
```

The `splates server` page shows each `splates task add` in the conversation as
a line naming the task, which opens it, so your reply needs no heading or
summary of it. That shrinks what you say, never the task: its subject and
detail stay full, since whoever picks it up reads nothing else.

When you take a queued task that names a model other than the one you run as, take
it anyway: whoever handed it to you chose you. Say so in a line of its own
right after `splates add`, such as `#12 names Sonnet; I run as Opus.`, so the
user can stop you and start the model it names instead.

`splates task update <n> '<detail>'` replaces the whole detail, so pass all of
it: what still holds and what you learned. Merging removes the queued task
yours took: when you leave part of it undone, `splates task add` what is
left as a task of its own.

When `splates add --task` warns that a task is blocked,
what blocks it has yet to merge: `splates task wait <n>` for it, or, when the
user asked for this task now, do only what does not need the blocker and say
so in your report.

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `splates merge` refuses one that is not, and a review
is sent only for one that is. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself, its evidence under `## Verification`
  (see SPLATES.md). This is the default, and the usual end of a small change.
- **Ask for a review**, with a demo (see [Demos](references/demos.md)), when the change is invasive
  (it reworks how something the user relies on works, or touches much of the
  project) and above all when it is hard or impossible to reverse (a
  migration, data written, anything sent outside the repo), or when
  `## Notes` says `Review: requested`. The demo is the user's chance to step
  in before it lands: their feedback decides whether it merges. Leave
  something to look at (step 1 of [When you cannot go on](references/questions.md#when-you-cannot-go-on)), send the Ready to
  merge report (see [Reporting](references/reporting.md)), which is the whole request, and end your turn.

For a demo the user can open, read [demos.md](references/demos.md),
Hosting a demo, before starting its server.

When the user approves a review, by replying "merge" or with
`[SPLATES MERGE]`, `splates claim <task>` and merge. When they ask for changes, `splates claim <task>`, add each as a
step under `## Next`, and work through them as before. While a review waits,
every reply that ends your turn ends with the whole review report again,
brought up to date: the page shows its Ready to merge card only for a whole
report.

## Proposing

Propose only when the user asks what you think, so they can approve it or
challenge what it rests on. Otherwise build, asking each call the user's
answer would change as a question (see [Questions](references/questions.md)) rather than a proposal.

A proposal is one block: a `## 💡 Proposed <subject>` title, the subject a
few words on what you would build, then what you recommend and why, briefly.
It ends with each call it rests on that the user has not settled, as
questions numbered from 1 (see [Questions](references/questions.md)).

```markdown
## 💡 Proposed a card for proposals

Fold proposals into the questions card, each call a question with a pick:
that card already tags a `(chosen)` choice, so one card asks everything.

1. Where should a proposal's calls come from?
   - (a) The reply, so a proposal works outside a task too (chosen)
   - (b) `SPLATES.md`, so every proposal needs a task
2. What should its button say?
```

In a task, write each call under `## Blocked` too, then end your turn; ask
nothing else beside it.

The `splates server` page shows a proposal as a questions card headed by it, each
call with a `(chosen)` choice already answered with it. Once every call is
answered and the user has changed none of your choices, its button approves,
sending `[SPLATES APPROVE]`, then the answer to each call you chose nothing
for, quoted as any answer is (see [Keeping Blocked current](references/questions.md#keeping-blocked-current)). That, or a reply
of "approve", means go ahead as proposed, taking in each answer, every call
not quoted as you chose it, after `splates add` when no task is under way. A
reply without it, as the card sends once the user picks another choice,
changes a call or writes anything else, answers what it quotes: take that
in and propose again.

## SPLATES.md

Your session can die at any moment; `SPLATES.md` is what lets a stranger
`splates claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

````markdown
# <task>

## Goal

One or two lines on what done means.

## Next

- [ ] only for work of several commits: every step you can foresee,
  roughly one commit each, checked off as it lands

## Notes

Decisions, dead ends, and how to verify.

## Verification

What you checked and what it showed: each check run, and a screenshot or
recording you `splates attach`ed where the change is something to see.

## Demo

How to set up a demo of the change, in words, and what the user should see
before the change, after it, and on main.

## Blocked

- [ ] questions the user must answer before the task merges
````

The Goal's first line is what other agents see of your task in `splates list
--files`, so make it say what you are changing. `splates add` writes the
Goal; for a change of one commit, leave out `## Next`, since the Goal says
it all, and the page shows the Goal as what you are doing. Keep the rest current as you
go, not at the end: check steps off as they land; the git log records them. Run `splates show <task>` after writing it to check
the shape. It is excluded from git: never mention it in a commit message.

The page's task dialog shows `## Verification`, for an open task and once it
has finished, so fill it in before you merge: it is the evidence the user
reads instead of a demo. Write `## Demo` for any change the user can see or
try, and leave it out otherwise. Keep it to what an agent needs to set the
demo up later against the code of the day (what to run, the throwaway data
to make, where to open it) and what each point shows, never a script to keep
in step with the code.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

`splates merge --message "<message>"` squashes the task to one commit before
it lands: describe the net change, what the base gains, not the path you
took.

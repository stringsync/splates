---
name: splates
description: Use the splates CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in a splates repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, or defer a task, or queue, pick up, link, or reorder a task for later, or work down a lane of them. Also read it before asking the user a question or proposing anything in a splates repository, with a task open or not.
version: 0.0.50
---

# Using splates

`splates` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @stringsync/splates <command>` (or
`splates` if on PATH). `splates --help` explains the commands; this file covers
only what the CLI cannot tell you.

A bare `splates` prints help; start the server explicitly with `splates server`.
Backlog is the permanent catch-all lane for deferred work. Address it as
`backlog` (or lane `0`) in lane commands and `--lane backlog` in task commands.
It can be queued and worked, but never renamed, removed or merged away.
Untriaged cannot be queued whole; its Groom button starts the groomer, which
moves each task to a fitting themed lane or Backlog.
`splates dev` is only for developing the splates repository, through its
checkout's `bin/splates`; it is not a command in the published CLI.

**Rule:** never use raw git for state transitions splates covers: every landing
goes through `splates merge`. The exception is finishing a rebase left in
progress (`git add`, `git rebase --continue`), then merging again. A failed
command prints `{reason}` JSON on stdout and instructions on stderr: do what
stderr says.

## In every conversation

This skill's ways hold in every conversation in a splates repository, with a
task open or not: a design talk, or a question answered from the main tree,
asks, proposes and reports as a task does. A task adds only its record in
`SPLATES.md`.

Above all, ask every question the user is to answer as an item of a list
numbered from 1, a lone one as `1.` too: its line ending at its `?`, the why
indented under it, and, when the answer is one of a few, `- (a) ...` choices,
your pick first and marked `(chosen)`. Never ask in prose, a bold line or a
"my lean", or through your harness's own question tool: the `splates server`
page turns only the list into a card the user answers with a tap.
[references/questions.md](references/questions.md) has the rest, and
says what a conversation with no task does with the answers.

You never change the queue, which splates refuses an agent: when a
conversation asks for several tasks, add them as a lane, and when the user
asks you to queue work, add it; either way, end your reply with its queue
card for the user to queue it now or later, as
[references/queue.md](references/queue.md), Asking the user to queue, says.

## Directives

A prompt that starts with `[SPLATES ...]` comes from the `splates server` page or
from splates itself, and asks what the table says. A row that names a file
asks you to read it as Reference files says.

| Directive | What it asks | What to do |
| --- | --- | --- |
| `[SPLATES TASK #N]` | Take queued task N | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <slug> --task N`, under the `slug:` it prints when it has one, then, when `splates task show N` says `groomed: no`, groom it as [groom.md](references/groom.md) says under Grooming a task you start; see Taking a queued task |
| `[SPLATES TASK <task>]` | Resume a task | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands |
| `[SPLATES SETUP <step>]` | Walk the user through one step of setting splates up, from the Setup page | [setup.md](references/setup.md) |
| `[SPLATES MERGE]` | The user approved your review, from the Ready to merge card | As for a reply of "merge": [merge.md](references/merge.md), Merge or review |
| `[SPLATES APPROVE]` | The user approved your proposal, from its card, with any answers after it | As for a reply of "approve": [proposing.md](references/proposing.md) |
| `[SPLATES KEEP]` | Draft a new or updated project note from this conversation; present the draft and merge only once the user approves | [notes.md](references/notes.md), Keeping a conversation |
| `[SPLATES DEFER]` | Queue the request after it as a task rather than do it; alone, make the user's message before it one, and stop | [queue.md](references/queue.md), Deferring |
| `[SPLATES AUDIT]` | The notes audit the user turned on came due: check each project note listed after it, never fixing one | [audit.md](references/audit.md) |
| `[SPLATES GROOM #N]` | You are the project's groomer: organize backlog task N and mark it ready, never doing it | [groom.md](references/groom.md) |
| `[SPLATES SORT #N ...]` | You are the project's groomer: find lanes for the Untriaged tasks named, never doing them | [groom.md](references/groom.md), Sorting Untriaged |
| `[SPLATES EVENT <event> #N <task>]` | A hook the user set on a task event (`task.created`, `task.done`, ...) started you for it | Do what the prompt after it asks, about task N; `splates task show N` prints it. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES SCHEDULE <n>]` | An automation the user set on a schedule (`splates hook add --every` or `--cron`) came due and started you | Do what the prompt after it asks. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES DEMO <task> <point>]` | The user asked to see a task's demo: Demo with an agent in its task dialog sends `after`, and `before` or `main` come only when asked for by hand | [demos.md](references/demos.md), Running a demo |
| `[SPLATES CHECKPOINT]` | Bring `SPLATES.md` up to date and stop, as before a restart | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RESUME]` | Carry on from where `SPLATES.md` says you stopped | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RECONNECT]` | A lost connection cut your last turn short, and splates, once it is back, or the user asks you to carry on | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it.

- Before `splates task add` or `splates task defer`, `splates lane add`,
  a queue card, or `splates task update` or `splates lane update` with
  `--lane`, `--position` or `--blocked-by`: [references/queue.md](references/queue.md), writing,
  deferring, linking, placing and ordering tasks.
- Before `splates task add` or `--ready`, when you take a task `splates task
  show` says is `groomed: no`, and as the project's groomer:
  [references/groom.md](references/groom.md), everything grooming checks
  and who does it when.
- Before `splates merge`, or when it stops on anything but success, and
  before asking the user for a review: [references/merge.md](references/merge.md),
  merging or asking for a review, and what to do when a merge fails.
- When the user asks what you think, or approves a proposal:
  [references/proposing.md](references/proposing.md).
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
- Before asking the user a question, in a task or not, after a reply, or
  when resuming a task with questions under `## Blocked`:
  [references/questions.md](references/questions.md), asking, reading
  answers and, in a task, keeping Blocked current. Also read it when you
  cannot go on without the user.
- Before making a demo, starting a server for the user to try, attaching
  screenshots or recordings, or creating or managing an artifact:
  [references/demos.md](references/demos.md), demos, hosting and artifacts.
- Before replying with a task outcome (merged, removed, waiting on answers
  or ready for review): [references/reporting.md](references/reporting.md),
  the exact report formats the page turns into cards.

## Workflow

When you need to know how the project is meant to work, before reading code
for it, or have learned something worth keeping, run `splates notes` and read
[references/notes.md](references/notes.md). Notes are progressively
disclosed: only descriptions are listed, so explore and index them yourself,
reading just the notes that fit.

1. **Start before you look.** When a request may end in a code change,
   `splates add <task> --goal "<what done means>"` before reading any code,
   the Goal one or two lines as you understand it so far, and investigate in
   its worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree,
   asking and answering as In every conversation says.
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
   queued (see [queue.md](references/queue.md), Queueing tasks). A snag on the way, such as a lost
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
5. **Land.** Once every step under `## Next` (including any user review) and
   every question under `## Blocked` is checked, the task is ready to merge:
   `splates task add` any step you will not do, then check it off, `splates task add` or
   `defer` each follow-up you would otherwise offer or ask about once it
   lands (see [Reporting](references/reporting.md)), and `splates merge --message
   "<message>"` (see Committing), or ask for a review first (see
   [merge.md](references/merge.md)). On failure, do what stderr says and merge again, with the
   real message: never merge only to read a failure again, since one whose
   gate passes this time lands. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else. When merge stops on anything but success, read
   [merge.md](references/merge.md), When a merge fails.

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

## Taking a queued task

When you take a queued task that names a model other than the one you run as, take
it anyway: whoever handed it to you chose you. Say so in a line of its own
right after `splates add`, such as `#12 names Sonnet; I run as Opus.`, so the
user can stop you and start the model it names instead.

When `splates add --task` warns that a task is blocked,
what blocks it has yet to merge: `splates task wait <n>` for it, or, when the
user asked for this task now, do only what does not need the blocker and say
so in your report.

Merging removes the queued task yours took: when you leave part of it
undone, `splates task add` what is left as a task of its own.

## SPLATES.md

Your session can die at any moment; `SPLATES.md` is what lets a stranger
`splates claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

````markdown
# <task>

## Goal

One or two lines on what done means.

## Next

- [ ] for work of several commits: every step you can foresee,
  roughly one commit each, checked off as it lands
- [ ] also keep a step for a checkpoint or user review when needed

## Verification

What you checked and what it showed: each check run, and, where the change
is something to see, screenshots or a recording you `splates attach`ed,
inline as `![what](/abs/path.png)`.

## Demo

How to set up a demo of the change, in words, and what the user should see
with it in.

## Blocked

- [ ] questions the user must answer before the task merges
````

The Goal's first line is what other agents see of your task in `splates list
--files`, so make it say what you are changing. `splates add` writes the
Goal; for a change of one commit, leave out `## Next` unless a checkpoint
or user review needs a step, since the Goal says it all otherwise, and the
page shows the Goal as what you are doing. Keep the rest current as you go, not at the end: check steps off as they land; the git log records them. Run `splates show <task>` after writing it to check
the shape. It is excluded from git: never mention it in a commit message.

The page's task dialog shows `## Verification`, for an open task and once it
has finished, as the evidence: what you checked and its screenshots, with,
when there is a `## Demo`, Demo with an agent among its actions, which starts
a conversation for an agent to show the change. Fill it in before you merge:
it is what the user reads instead of a demo. Write `## Demo` for any change the user can see or try, and leave it
out otherwise. Keep it to what an agent needs to set the demo up later
against the code of the day (what to run, the throwaway data to make, where
to open it) and what it shows, never a script to keep in step with the
code.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

`splates merge --message "<message>"` squashes the task to one commit before
it lands: describe the net change, what the base gains, not the path you
took.

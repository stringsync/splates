---
name: splates
description: Use the splates CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in a splates repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, or defer a task, or queue, pick up, link, or reorder a task for later, or work down a lane of them. Also read it before asking the user a question or proposing anything in a splates repository, with a task open or not.
version: 0.0.55
---

# Using splates

`splates` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @stringsync/splates <command>` (or
`splates` if on PATH). `splates --help` explains the commands; this file covers
only what the CLI cannot tell you. A bare `splates` prints help; start the
server with `splates server`. `splates dev` is only for developing the splates
repository itself.

The runner image starts `splates runners serve`: an authenticated, job-only HTTP
service for cloud runners, not a worker that runs agents. It reads its bearer
secret from the hosting environment; people use `splates run` to send jobs.

A project whose CI image already has what its jobs need names it as
`runner: { image: "ghcr.io/me/ci" }` in `splates.config.ts`; Fly runners then boot
it instead of the runner image. It needs `sh` and `curl` or `wget` (the runner
fetches splates on boot) and must be public: a private registry is not
supported yet.

## The short version

Most of what follows fills in these steps. Hold to them even when you skip
the rest:

1. **Add a task before you look.** When a request may end in a code change,
   run `splates add <task> --goal "<what done means>"` first, then read and
   edit only in the worktree path it prints.
2. **Ask as a numbered list.** Every question for the user is a `1.` item
   ending at its `?`, as in Formats below.
3. **Be careful on the host machine**, which the person works on. Never run
   a whole test suite, an install or a build here. A **fraction** of the
   tests, a test file or two, is fine to run directly and often quicker
   than a runner. Prefer `bun test --changed` or explicit test-file paths;
   combine them when the change reaches many tests. In splates's own repo,
   use `splates dev test --changed` before committing, `--since main` after
   committing, or explicit file paths. `--test-name-pattern <regex>` narrows
   cases further; focused runs default to one worker (`--workers <n>`).
   Leave the whole suite to the merge gate. Run other heavy work with
   `splates run -- <command>`: it runs on a runner, in a checkout of your
   worktree as it stands, output streamed back and its exit code yours.
   It uses a runner of `splates server`'s, else, where the project's
   `splates.config.ts` names a Fly.io `cloud`, makes one there itself,
   server or not. With a cloud configured it never runs here, refusing with
   `no_runner` when none can be had: run a few test files by hand or wait
   for a runner. In a project with no cloud it takes a local heavy-job
   slot, so keep the host's load in mind. A runner takes as many commands
   at once as fit in its CPUs and memory, each asking what the project's
   `job` setting says; `--cpus <n> --memory <size>` (as `8GB`) asks
   otherwise. It is killed, exiting 124, past 30 minutes or the `job`
   setting's `timeout`; `--timeout <length>` (as `90m`) gives one that
   needs longer. Skip the wrapper only where the project's instructions
   say a script takes a slot itself.
4. **Commit as you go**, in plain messages with no attribution.
5. **Queue what you would offer.** Each follow-up you would suggest, or ask
   about, once the work lands, `splates task add` (or `defer`) before merging.
6. **Land with `splates merge --message "<what the base gains>"`**, then `cd`
   to the main tree it prints. When it fails, do what its stderr says.
7. **End with the report**, its title copied from Formats below, one line on
   what changed for the user, and nothing after it: the task is over, so the
   report asks nothing and offers nothing.

Every landing goes through `splates merge`: use git only to commit and to
finish a rebase left in progress (`git add`, `git rebase --continue`), then
merge again. A failed command prints `{reason}` JSON on stdout and what to do
on stderr: do what stderr says.

## Formats

The `splates server` page turns these shapes, and only these, into cards the
user taps. Copy them exactly, filling in the `<...>`.

A question, a lone one numbered `1.` too, the why indented under it and,
when the answer is one of a few, `- (a)` choices, your pick first and
marked `(chosen)`:

```markdown
1. Should the old upload endpoint stay for a release?
   It is still called by the mobile app's last version.
   - (a) Keep it for one release, logging each call (chosen)
   - (b) Remove it now
```

Never as `Should I keep the old endpoint? I'd lean yes.`, a bold line, or
your harness's own question tool: the page shows none of those as a card.
[references/questions.md](references/questions.md) has the rest.

After a merge, the task's last reply, a line on the change as the user
will meet it under the title:

```markdown
## ✅ Merged <task> onto <base>

Cards on a phone now drag on a long press. Restart `splates server` to pick it up.
```

After a remove, why it went after the colon:

```markdown
## 🛑 Removed <task>: superseded by a fix on main

The task set out to stop uploads retrying a 413.
```

When the work is blocked and only set aside for later, remove it with
`--reason blocked` and report it deferred, what it waits on after the colon,
not removed:

```markdown
## ⏸ Deferred <task>: waiting on the upload rewrite

The task set out to stop uploads retrying a 413; it is back on the list.
```

Asking for a review is `## 🔍 Ready to merge <task> onto <base>`, with a
demo, a `Checks:` line and the last line `Reply "merge", or say what to
change.`: copy its whole shape from
[references/reporting.md](references/reporting.md) before sending one.

Work you add for the user to queue ends your reply with its queue card,
after any report (see [references/queue.md](references/queue.md), Asking
the user to queue):

```markdown
## 🔐 Permission: queue lane <n>: <name>

`splates lane queue <n>`

<A line on what the tasks add up to.>
```

Evals cost the user tokens, so only they start them. To ask for a run
(splates repository only, where `splates dev eval list` names the probes),
end your reply with the run card: the probes you picked, one `` - `id` `` item
each, and optionally the revision the skill's change is judged against. The
page shows it with the saved eval agents and the reservation, and its Run
button is the user's; never run `splates dev eval fast` yourself.

```markdown
## 🔐 Permission: run evals splates: the decision probes

Checks the new wording of the ask-first rule.

- `decisions/local-choice`
- `decisions/ask-first`

Baseline: `main`
```

## In every conversation

These ways hold in every conversation in a splates repository, with a task
open or not: a design talk, or a question answered from the main tree, asks,
proposes and reports as a task does. A task adds only its record in
`SPLATES.md`.

You never change the queue, which splates refuses an agent: when a
conversation asks for several tasks, add them as a lane, and when the user
asks you to queue work, add it; either way, end your reply with its queue
card for the user to queue it now or later.

## Directives

A prompt that has `[SPLATES ...]` comes from the `splates server` page or
from splates itself, and asks what the table says. A row that names a file
asks you to read it as Reference files says. A few directives have no row
because the page sends them rarely: `[SPLATES SETUP <step>]` ([setup.md](references/setup.md)),
`[SPLATES DEFER]` ([queue.md](references/queue.md), Deferring), `[SPLATES KEEP]`
([notes.md](references/notes.md)), `[SPLATES GARDEN]` ([garden.md](references/garden.md)),
`[SPLATES DEMO <task> <point>]` ([demos.md](references/demos.md)), and hook
prompts `[SPLATES EVENT ...]` and `[SPLATES SCHEDULE <n>]`, where you do what
the prompt after it asks. Read the file when one arrives.

| Directive                           | What it asks                                                                                                                                      | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[SPLATES TASK #N]`                 | Take queued task N                                                                                                                                | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <slug> --task N`, under the `slug:` it prints when it has one, then, when `splates task show N` says `groomed: no`, groom it as [groom.md](references/groom.md) says under Grooming a task you start; then [queue.md](references/queue.md), Taking a queued task |
| `[SPLATES TASK <task>]`             | Resume a task                                                                                                                                     | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands                                                                                                                                                                                                                                                                                                                                                                               |
| `[SPLATES MERGE]`                   | The user approved your review, from the Ready to merge card                                                                                       | As for a reply of "merge": [merge.md](references/merge.md), Merge or review                                                                                                                                                                                                                                                                                                                                                                                    |
| `[SPLATES APPROVE]`                 | The user approved your proposal, from its card, with any answers after it                                                                         | As for a reply of "approve": [proposing.md](references/proposing.md)                                                                                                                                                                                                                                                                                                                                                                                           |
| `[SPLATES GROOM #N]` | You are the project's groomer: organize backlog task N and mark it ready, never doing it. Once the backlog is empty, `[SPLATES SORT ...]` follows in the same conversation to find lanes for the Untriaged tasks it names | [groom.md](references/groom.md), which covers both, Sorting Untriaged included |
| `[SPLATES LANE N]` | Work down lane N (`untriaged` places the Untriaged tasks in lanes first) | `splates lane show N` prints the steps and whether the next is blocked; [queue.md](references/queue.md) |
| `[SPLATES CHECKPOINT]`              | Bring `SPLATES.md` up to date and stop, as before a restart                                                                                       | [checkpoint.md](references/checkpoint.md)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `[SPLATES RESUME]`                  | Carry on from where `SPLATES.md` says you stopped                                                                                                 | [checkpoint.md](references/checkpoint.md)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `[SPLATES RECONNECT]`               | A lost connection cut your last turn short, and splates, once it is back, or the user asks you to carry on                                        | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop                                                                                                                                                              |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it. These come up in most tasks:

- Before `splates merge`, or when it stops on anything but success, and
  before asking the user for a review: [references/merge.md](references/merge.md),
  merging or asking for a review, and what to do when a merge fails.
- Before replying with a task outcome (merged, removed, waiting on answers
  or ready for review): [references/reporting.md](references/reporting.md),
  the report formats in full, beyond those in Formats above.
- Before asking the user a question, in a task or not, after a reply, or
  when resuming a task with questions under `## Blocked`:
  [references/questions.md](references/questions.md), asking, reading
  answers and, in a task, keeping Blocked current. Also read it when you
  cannot go on without the user.
- Before `splates task add` or `splates task defer`, `splates lane add`,
  a queue card, or `splates task update` or `splates lane update` with
  `--lane`, `--position` or `--blocked-by`: [references/queue.md](references/queue.md), writing,
  deferring, linking, placing and ordering tasks.
- Before `splates task add` or `--ready`, when you take a task `splates task
show` says is `groomed: no`, and as the project's groomer:
  [references/groom.md](references/groom.md), everything grooming checks
  and who does it when.
- Before making a demo, starting a server for the user to try, attaching
  screenshots or recordings, or creating or managing an artifact:
  [references/demos.md](references/demos.md), demos, hosting and artifacts.
- When the user asks what you think, or approves a proposal:
  [references/proposing.md](references/proposing.md).

These only when their moment comes:

- When the user asks to set splates up on this machine, or any part of it
  (agents, remote access, workers, a tunnel of their
  own, dictation): [references/setup.md](references/setup.md),
  one step at a time.
- When your work needs a secret only the user can get, such as an API token:
  [references/creds.md](references/creds.md).
- When work here needs another splates project, or you run `splates
--project`: [references/projects.md](references/projects.md).
- When `splates artifact add` stops on `too_large`, or the user asks about
  artifact space: [references/artifacts.md](references/artifacts.md).
- When the user asks to move splates's tasks, conversations or settings to
  another machine or project, or to back them up or restore them:
  [references/transfer.md](references/transfer.md).

## Workflow

When you need to know how the project is meant to work, before reading code
for it, or have learned something worth keeping, run `splates notes` and read
[references/notes.md](references/notes.md). Notes are progressively
disclosed: only descriptions are listed, so explore and index them yourself,
reading just the notes that fit. Under `splates server`, a message may end
with note pointers: read each `Read before acting:` note before you act on
the message; a `Maybe relevant:` one only when it fits.

1. **Start before you look.** When a request may end in a code change,
   `splates add <task> --goal "<what done means>"` before reading any code,
   the Goal one or two lines as you understand it so far, and investigate in
   its worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree,
   asking and answering as In every conversation says.
   `splates claim <task>` resumes a task instead. When the request is a queued task,
   take it as `[SPLATES TASK #N]` says under Directives, and for any other
   directive, do what its row says. Pass `--base <branch>` only when invoked
   with a branch (`/splates feature/auth`) or the user names one; otherwise
   leave it off, whatever branch is checked out. Once `splates add` succeeds, the `splates server` page shows
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
   once share the tree, so give each its own files. Be careful on the host
   machine the person works on: never run a whole suite, an install or a
   build here. Test a small portion with `bun test --changed` or explicit
   test-file paths; in splates's own repo prefer `splates dev test --changed`,
   `--since main`, or file paths, optionally with `--test-name-pattern`.
   Leave the whole suite to the merge gate. Use `splates run -- <command>`
   for other heavy work (step 3 of The short version), and tell a subagent
   to do the same. Files it writes on a runner stay there.
5. **Land.** Once every step under `## Next` (including any user review) and
   every question under `## Blocked` is checked, the task is ready to merge:
   `splates task add` any step you will not do, then check it off, `splates task add` or
   `defer` each follow-up you would otherwise offer or ask about once it
   lands (see [Reporting](references/reporting.md)), and `splates merge --message
"<message>"` (see Committing), or ask for a review first (see
   [merge.md](references/merge.md)). On failure, do what stderr says and merge again, with the
   real message, since a merge whose gate passes this time lands. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else. When merge stops on anything but success, read
   [merge.md](references/merge.md), When a merge fails.
6. **Report.** Reply with the report from Formats above: after a merge,
   `## ✅ Merged <task> onto <base>`, which `splates merge` prints last to
   copy, then a line on what changed for the user, and a queue card after it
   for any lane you added. That is the whole reply: each question or offer
   you would add to it is a task you queued in step 5.

**Clean up every task you start.** A task ends in a merge or a remove, never
left behind; one waiting on the user's answers is not done, so leave it for
`splates claim`. When investigating shows there is nothing to change, the
work is moot, or it is better redone against current trunk, `splates task
remove` each queued task it took that is done or moot, `splates task update` the rest
with what you learned, then `cd "$(splates path)"` and `splates remove <task>
--reason <why>`, which puts them back on the list, out of the queue and
any queued lane until the user queues them again. The reason is `nothing`
(nothing to change), `moot`, `superseded` (done some other way), `redo`
(better redone against current trunk) or `blocked` (set aside until other work
lands: report it as Deferred); the Stats page counts them.

`wait` ends on `removed` (landed or dropped: check for overlap again),
waits on a person (the other task's questions are open: tell the user you
are blocked on it),
or a broken status (`wait` once more, then ask). Judge a task by its status,
never its lease: `stale` is normal for one mid-edit.

## SPLATES.md

Your session can die at any moment; `SPLATES.md` is what lets a stranger
`splates claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

```markdown
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

## Outcome

What came of it, written just before you merge: a summary of what changed
and any pivot from the original Goal, then `### Demo` (how to trigger it)
and `### Verification` (checks run, screenshots as `![what](/abs/path.png)`).
```

The Goal's first line is what other agents see of your task in `splates list
--files`, so make it say what you are changing. `splates add` writes the
Goal; for a change of one commit, leave out `## Next` unless a checkpoint
or user review needs a step, since the Goal says it all otherwise, and the
page shows the Goal as what you are doing. Keep the rest current as you go, not at the end: check steps off as they land; the git log records them. Run `splates show <task>` after writing it to check
the shape. It is excluded from git, so leave it out of commit messages.

The page's task dialog shows `## Verification`, for an open task and once it
has finished, as the evidence: what you checked and its screenshots, with,
when there is a `## Demo`, Demo with an agent among its actions, which starts
a conversation for an agent to show the change. The merged card shows `## Outcome`, kept
with the merge record, and when it has a `### Demo`, a Demo it button
that asks the agent of the conversation, you, for one: write it last, before `splates merge`. Fill in Verification before you merge:
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

---
name: splates
description: Use the splates CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in a splates repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, escalate, or defer a task, or queue, pick up, link, or reorder a task for later, or work down a lane of them.
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
| `[SPLATES TASK #N]` | Take queued task N | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <task> --task N`, or `splates task take N` from a task under way, then groom it as [queue.md](references/queue.md) says under Grooming a task you start |
| `[SPLATES TASK <task>]` | Resume a task | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands |
| `[SPLATES SETUP <step>]` | Walk the user through one step of setting splates up, from the Setup page | [setup.md](references/setup.md) |
| `[SPLATES HANDOFF <task>]` | Take over a task another agent handed you | [handoff.md](references/handoff.md) first, then as for `[SPLATES TASK <task>]` |
| `[SPLATES AUTO]` | Auto picked you for the request after it from its words alone: do it if it fits you, or hand it to the model it fits | [handoff.md](references/handoff.md), Sizing an Auto pick |
| `[SPLATES HANDOFF TO <agent> <model>]` | Hand your task to that agent, on that model | [handoff.md](references/handoff.md) |
| `[SPLATES MERGE]` | The user approved your review, from the Ready to merge card | As for a reply of "merge": see Merge or review |
| `[SPLATES APPROVE]` | The user approved your proposal, from its card, with any answers after it | As for a reply of "approve": see Proposing |
| `[SPLATES DEFER]` | Queue the request after it as a task rather than do it; alone, make the user's message before it one, and stop | [queue.md](references/queue.md), Deferring |
| `[SPLATES LANE untriaged]` | Orchestrate the queued tasks in no lane | Working the untriaged lane below first, then [lanes.md](references/lanes.md) as it says |
| `[SPLATES LANE N]` | Plan lane N as its orchestrator, then set it running | [lanes.md](references/lanes.md) |
| `[SPLATES REPORT <task>]` | A task you handed to another project stopped: escalated, merged or removed | [lanes.md](references/lanes.md) |
| `[SPLATES TASK DONE #N]` | A task in a lane you orchestrate, paused by the user, left the queue: merged or removed | [lanes.md](references/lanes.md) |
| `[SPLATES TASK OPEN #N]` | A task in a lane you orchestrate, paused by the user, is open again: the task that took it let it go or was removed | [lanes.md](references/lanes.md) |
| `[SPLATES TASK ADDED #N]` | A task came into a running lane you orchestrate: plan it in | [lanes.md](references/lanes.md) |
| `[SPLATES EVENT <event> #N <task>]` | A hook the user set on a task event (`task.created`, `task.done`, ...) started you for it | Do what the prompt after it asks, about task N; `splates task show N` prints it. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES IDLE <task>]` | A task you handed out, or your running lane started, sits still: its agent's turn ended, or failed, short of a stop, after any nudge splates gave it | [lanes.md](references/lanes.md) |
| `[SPLATES LANES DONE]` | Every lane you orchestrate is done, however its last task landed | [lanes.md](references/lanes.md) |
| `[SPLATES CHECKPOINT]` | Bring `SPLATES.md` up to date and stop, as before a restart | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RESUME]` | Carry on from where `SPLATES.md` says you stopped | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RECONNECT]` | A lost connection cut your last turn short, and splates, once it is back, or the user asks you to carry on | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it.

- Before `splates add <part> --base task/<your task>`, or handing a subagent
  work that may change code: [references/parts.md](references/parts.md).
- Before `splates handoff`, or when the task gives you a reason to hand it to
  another model: [references/handoff.md](references/handoff.md), handing a
  task to another agent or taking one over.
- Before `splates lane add`, or `splates task add`, `splates task update` or
  `splates lane update` with `--lane`, `--position` or `--blocked-by`:
  [references/queue.md](references/queue.md), linking, placing and ordering
  queued tasks.
- When the user asks to set splates up on this machine, or any part of it
  (agents, remote access, workers, a cloud server, a tunnel of their
  own, notifications, dictation): [references/setup.md](references/setup.md),
  one step at a time.
- When your work needs a secret only the user can get, such as an API token:
  [references/creds.md](references/creds.md).
- When work here needs another splates project, or you run `splates
  --project`: [references/projects.md](references/projects.md).
- When `splates artifact add` stops on `too_large`, or the user asks about
  artifact space: [references/artifacts.md](references/artifacts.md).

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
2. **Plan.** Once you know what done means, fill in `SPLATES.md` before
   touching code (see SPLATES.md below). Keep the task yourself unless it gives you
   a reason another model should take it: work that has failed you, or a
   long, fully planned, mechanical rest (see
   [references/handoff.md](references/handoff.md)).
3. **Check for overlap.** Read `splates list --files`: each task's Goal and
   the files it has changed so far. Some overlap is normal: work alongside,
   accept the rebase, and note it in `SPLATES.md`. Only when conflicts would be hard to resolve, `splates wait
   <task>` for the other task to land first. If it is doing the opposite of
   what you were asked, escalate instead.
4. **Work.** Commit each step with git as you go, and check it off under
   `## Next` as you commit it; splates never commits for you. When something outside
   your Goal comes up (a bug next door, a follow-up, a reply that widens the
   task), `splates task add` it from your worktree and move on,
   so the task stays one coherent change; the conversation shows what you
   queued (see Queueing tasks). A snag on the way, such as a lost
   connection, a conflict or a retry, is no task to queue; `splates merge` queues one
   itself for each test that failed its gate. Ask the user each call their
   answer would change, and make the rest yourself (see Questions), bringing
   `## Blocked` up to date before each step. Before handing a subagent work that may change code, read
   [references/parts.md](references/parts.md): it works in a part of your
   task. Run a whole test suite, an install, or anything as heavy as
   `splates heavy -- <command>`, unless the project's instructions say its
   script takes a slot itself: it waits for one of the machine's few
   heavy-job slots, so agents testing at once queue rather than run it out
   of memory.
5. **Land.** Once every step under `## Next` and every question under
   `## Blocked` is checked, the task is ready to merge: `splates task add`
   any step you will not do, then check it off. Release each
   task you took and only partly did (see Queueing tasks), and `splates merge --message
   "<message>"` (see Committing), or ask for a review first (see Merge or
   review). On failure, do what stderr says and merge again. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else.

   An existing Git `index.lock` stops merge as `blocked` without spending an
   attempt. Wait for its owner to finish and merge again; never delete a lock
   held by a live operation. A failed rebase with no unmerged paths is
   `merge_failed`, not a content `conflict`.

   Each `conflict`, `tests_failed` or `merge_failed` spends one of the
   task's merge attempts, so write under `## Notes` what each one failed
   on. When `merge` stops on `budget_exhausted`, escalate (see Escalation)
   and tell the user why merging keeps failing: a `- ` line per attempt on
   what it failed on (the files that conflicted, the check that broke, the
   tree in the way), then one on what would get it through, so they can
   choose between `splates retry` and a remove and redo.

**Clean up every task you start.** A task ends in a merge or a remove, never
left behind, unless you hand it off, when it is the other agent's to end; one escalated and waiting on the user is not done, so leave it
for `splates claim`. When investigating shows there is nothing to change, the
work is moot, or it is better redone against current trunk, `splates task
remove` each queued task it took that is done or moot, `splates task update` the rest
with what you learned, then `cd "$(splates path)"` and `splates remove <task>
--reason <why>`, which puts them back in the queue. The reason is `nothing`
(nothing to change), `moot`, `superseded` (done some other way) or `redo`
(better redone against current trunk); the Stats page counts them.

`wait` ends on `removed` (landed or dropped: check for overlap again),
`escalated` (the other task needs the user: tell them you are blocked on it),
or a broken status (`wait` once more, then ask). Judge a task by its status,
never its lease: `stale` is normal for one mid-edit.

## Working the untriaged lane

`[SPLATES LANE untriaged]` makes you the orchestrator of the queued tasks in no lane.
You place them in lanes first, then plan those lanes as
[references/lanes.md](references/lanes.md) says (read it before step 3, and
for the lane reports):

1. `splates lane show untriaged` lists them. For each open one, read `splates
   task show <n>`, `splates lane list`, and `splates list --files` for the
   tasks under way, then place it as for a task you queue (see Lanes in
   [references/queue.md](references/queue.md)): in a lane whose work it
   builds on, or `--lane new` for one of its own when it starts a chain.
   Tasks that touch the same files go in one lane, in the order they should
   land, so their agents never fight over rebases.
2. Link what blocks each: `splates task update <n> --blocked-by <n>` when it
   needs another task's code or data merged first, or would change the same
   files, in any lane, never for priority. When two tasks ask for opposite things, or one undoes a task
   under way, leave them untriaged and ask the user which wins, as numbered
   questions in your reply, placing the rest meanwhile.
3. Say in a line where each went, then plan and run each lane you placed one
   in that no agent is on, as if sent `[SPLATES LANE N]` for it. Leave a
   lane another agent is on to that agent.
4. Each time splates wakes you, `splates lane show untriaged` again, and
   place any task queued since the same way. Once nothing is left to place
   and every lane you work is done, end on a finished report.

## Queueing tasks

When something outside your Goal comes up, queue it as a task and move on:
its subject and what you know, once you have checked no task already asks
it (see [references/queue.md](references/queue.md)). Leave placing it, linking it
and picking its model to whoever starts it, who grooms it first, unless the
user names a lane, a position or what blocks it, or the model it takes is
plain, as for a change spelled out step by step.

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
it: what still holds and what you learned. Merging removes every queued task
yours took: update one you only partly did with what is left, then
`splates task release` it, so it stays in the queue.

When `splates add --task` or `splates task take` warns that a task is blocked,
what blocks it has yet to merge: `splates task wait <n>` for it, or, when the
user asked for this task now, do only what does not need the blocker and say
so in your report.

## Questions

Ask the user whenever their answer would change what you build: one reading
of an ambiguous ask, a behavior or design they will see, a default they may
want another way, a call a wrong guess would cost much rework to undo, one
hard to reverse (a migration, data written, a message sent, anything outside
the repo), or one that goes against something the user said before. Asking
is cheap, so when in doubt, ask: the `splates server` page shows your
questions as a card with your pick already chosen, so the user answers with
a tap, and you carry on with that pick meanwhile rather than wait.

Make the rest yourself, the calls the user would not care to weigh in on: a
name only the code reads, a helper's shape, a log line. Take the better pick
and carry on, saying nothing of it to the user; write it in a line under
`## Notes` only when whoever resumes the task would need it.

Ask in the format below and nowhere else: a numbered question under `##
Blocked`, then in your reply as Reporting says, a lone question numbered
`1.` too, so the page shows its question card. Never tuck a question into
prose or put it through your harness's own question tool, which the page
cannot show as a card. The task cannot merge
until it is answered, though the user can answer in chat while you work.
When an answer overturns a pick you built on, redo that part.

An answer can reach you mid-turn, as a message that arrives while you work.
Read it at the next step rather than at the end: record it (see Keeping
Blocked current), and redo at once what it overturns, before building more on
the choice. While a question is open, do the work it touches last where your
plan allows, so an answer that overturns it costs little.

Number questions 1, 2, … in the order you write them; numbers never change,
and new ones continue from the highest. A question's line is its subject, short
enough to scan and ending at its `?`, with nothing after it; everything else,
the why included, goes in markdown lines indented under it, code blocks
included. When checking your own work, ask for what is wrong rather than
a bare yes or no. A yes or no decision is one of a few: give it `- (a) ...`
choices, each saying what happens, never a bare "Yes" or "No", so the answer
cannot be read two ways. When the answer is one of a few, end with
`- (a) ...` lines (pick one, or none), or `- [a] ...` lines for all that
apply. Describe every choice, the one you went with too, and mark that one
`(chosen)`: never a bare "That". List it first, as `(a)`: the `splates server`
page puts it first and picks it for the user, who answers by changing it. When the answer is an order (what lands first, which task
matters most), end with `- a. ...` lines in the order you would go with: the
reply lists every letter in the order picked, `4. b, a, c`.

When the pick is a close call, or the user may well want another,
give a choice a `Why:` line indented under it: one sentence on why you would
take it, or why not. Any choice can have one, the `(chosen)` one most often;
leave it off where the choice says it all. The `splates server` page hides every
`Why:` line until the user asks to see a question's reasons, so they never
crowd the choices.

```markdown
## Blocked

- [x] 1. Should the old upload endpoint stay for a release? → a
  - (a) Keep it for one release, logging each call (chosen)
  - (b) Remove it now
- [ ] 2. What looks wrong in the header at 390px?
  ![header at 390px](/abs/path/shot.png)
- [ ] 3. How should existing sessions move to the new tokens?
  Sessions are keyed by the old cookie.
  - (a) Migrate each session on its next request (chosen)
    Why: no one is signed out, and the old cookie still reads for a release.
  - (b) Sign everyone out once
- [ ] 4. In what order should the settings pages land?
  - a. Profile
  - b. Billing
  - c. Notifications
```

Show what a question is about whenever it is something to see: a screenshot,
or a short recording when it moves or takes steps. Save it outside the
worktree, `splates attach` it, and name the path it prints as
`![what](/abs/path.png)`. The `splates server` page shows an attached file inline,
in `SPLATES.md` and in your replies alike, playing a `.mp4`, `.webm` or `.mov`
as a video. Only attached files show there, so never point a question at a
file anywhere else. Attached from a conversation (`splates server` gives its agents
one; an agent outside it passes `--conversation <id>`), a file stays with it
past the task, so the question still shows it when the user scrolls back;
attached outside one, it goes when the task does. Such a file is no artifact
(see Artifacts): it serves the question it is in.

Put each screenshot in the question it is for, under what it shows: under the
question's line for what it asks about, or indented under a choice for what
that choice looks like, which the `splates server` page shows with the choice.
Never gather them above the questions, or ask about them apart from the
question they are for.

```markdown
- [ ] 6. Which style should the action list take?
  - (a) A rail beside the thread (chosen)
    ![rail](/abs/path/rail.png)
  - (b) A bordered panel
    ![panel](/abs/path/panel.png)
```

## Keeping Blocked current

`## Blocked` is where every question the user sees comes from, so it must say
what you need right now. Before you continue with any work (after the user
replies, after `splates claim` returns, and between steps), bring it up to date:

- write every answer the user gave after `→` on its question's line, and
  check off each question you have acted on;
- write a follow-up to an answer, even a checked one, on a `→ ` line of its
  own under the question, and uncheck the question until you have acted on
  the follow-up;
- check off any question that no longer applies, with why after `→`
  (`→ moot: the header was removed`), rather than deleting it;
- retake each screenshot an open question shows once your work has changed
  what it shows, attach it in place of the old one (`splates attach new.png
  --remove <old path>`), and point the question at the new one;
- add each question you now need.

The user answers in chat. From the `splates server` page, a reply quotes each
question it answers, its line in bold (`> **How should …?**`), and answers
under it: the choices picked as `- (b) <its text>`, numbered in the order
picked for an order, then any words. Anything else they say comes before the
first quote. Match each quote to an open question by its line, whatever its
number; questions not quoted stay open. A quote can come from `SPLATES.md` as
the page last read it, ahead of your report: when it matches no question you
have open, as one you changed since, ask again rather than guess what it
answers. Typed by hand, a reply is a list matching your latest report: `2.`
is its second question, whatever its number in `SPLATES.md`, and items left out
stay open. When a reply does not fit your latest report, ask rather than
guess. Whenever anything the user says settles an open question, even
without naming it, write that answer after `→` and check it off, so it is not
asked again. Check an item off only when its answer is one you can act on;
anything else stays open and leads your next report. A reply about something
you did is an instruction. When the user defers or skips a question, check it
off and carry on without it (for a defer, `splates task add` it first). Only
the user answers questions, yours or another agent's.

A message `splates tell` says in your conversation for the lane's
orchestrator that handed you your task, to carry on or to change course,
you take as you would the user's.

When the user asks to see the work before it lands, write `Review:
requested` under `## Notes` at once, so the request outlives your session.

## Escalation

Escalate when questions are still open once everything else is done, or when
you cannot go on without the user (access, a decision, a test only they can
run). A secret, such as an API token, is a cred to request instead (see
[references/creds.md](references/creds.md)).

1. Leave something to look at, by **absolute path** (start from
   `splates path <task>`): for anything visual, a screenshot or recording you
   `splates attach`. Ask first if producing it is expensive.
2. Write each question not already there under `## Blocked`.
3. `splates escalate <reason>`.
4. Report, end your turn, and wait for the user to answer in chat. Do not run
   `splates wait` or poll `SPLATES.md`: answers only come in chat. Then
   `splates claim <task>` to carry on. `splates retry`, for `budget_exhausted`, is
   the user's to run, before you claim.

Never ask whether the work is ready to merge among other questions, or as a
question at all: once they are answered and the work is done, merge or ask
for a review (see Merge or review).

A lane's orchestrator that handed you a task (`$SPLATES_STARTED_BY` is set)
is not one you report to: you answer to the user, as for any task, and
splates tells it where the lane stands from its tasks.

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `splates merge` and `splates escalate --review` both refuse
one that is not. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself. This is the default, and the usual
  end of a small change.
- **Ask for a review** only when you cannot verify the change yourself
  (external services, destructive migrations, how something looks), or when
  `## Notes` says `Review: requested`. Leave something to
  look at (step 1 of Escalation), `splates escalate --review "<what to look
  at>"`, report it (see Reporting), and end your turn.

When the user has to see a change to judge it, make that cheap: run it for
them where they can open it (a dev server on throwaway data that shows each
case, never their own), and give them a demo (see Demos). Run splates in a
throwaway repository with `SPLATES_HOME` set to a throwaway directory, so it
stays out of the user's `splates server` project list. Start the server from your
worktree, then `splates ports <task>` prints each port it listens on with two
links: its remote one, `https://<task>-<port>.<base>` behind the user's
Access, when `splates server --ports-host` saved a base, and its local one on
your machine, which a worker whose server runs elsewhere has only for its
own ports. Give the user both, the remote one first, in
the demo's line on where to open it; the task's dialog on the page lists
them too. When `splates tunnel status`
shows a tunnel, `splates server --slot` from your worktree does both and prints a
`https://<word>.<zone>` the user can open on their phone too: give them that.
Your worktree keeps its slot until the task merges or is removed, which stops
its server. Every other slot is another task's: never kill its server or edit
`~/.splates/slots.json`, even when it looks left behind. When none is free, run
`splates slots prune`, which frees only those no task holds any more, and
otherwise ask the user.

## Proposing

Propose only when the user asks what you think, so they can approve it or
challenge what it rests on. Otherwise build, asking each call the user's
answer would change as a question (see Questions) rather than a proposal.

A proposal is one block: a `## 💡 Proposed <subject>` title, the subject a
few words on what you would build, lowercase after its first word; a blank
line; one plain sentence, under 25 words, on what you recommend; then a
`####` section for each reason the user needs, its line stating one point in
a sentence, then three `- ` lines, one fact each, with no paragraphs. It
ends with each call it rests on that the user has not settled, as a list of
questions numbered from 1: a call you have a clear pick for marks that
choice `(chosen)`, and one you have none for marks none.

```markdown
## 💡 Proposed a card for proposals

Fold proposals into the questions card, each call a question with a pick.

#### A proposal's calls are questions with a pick.

- The questions card already tags a `(chosen)` choice.
- It already heads its questions with an escalation's report.
- One card then asks everything, picked or not.

1. Where should a proposal's calls come from?
   - (a) The reply, so a proposal works outside a task too (chosen)
   - (b) `SPLATES.md`, so every proposal needs a task
2. What should its button say?
```

In a task, write each call under `## Blocked` too, then end your turn,
without escalating; ask nothing else beside it.

The `splates server` page shows a proposal as a questions card headed by it, each
call with a `(chosen)` choice already answered with it. Once every call is
answered and the user has changed none of your choices, its button approves,
sending `[SPLATES APPROVE]`, then the answer to each call you chose nothing
for, quoted as any answer is (see Keeping Blocked current). That, or a reply
of "approve", means go ahead as proposed, taking in each answer, every call
not quoted as you chose it, after `splates add` when no task is under way. A
reply without it, as the card sends once the user picks another choice,
changes a call or writes anything else, answers what it quotes: take that
in and propose again.

## Demos

Whenever the user is to try something (a review, a question on how something
looks or feels, a test only they can run), show it as a demo rather than
describing it: a `### 🎬 Demo: <what it shows>` heading, a line on where to
open it, then the steps, numbered from 1. Each step's line is one thing to
do; indented under it, one line on what they should see, and a screenshot or
recording when it helps. The `splates server` page shows a demo as a checklist
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

When the user approves, by replying "merge" or with `[SPLATES MERGE]`,
`splates claim <task>` and merge. When that merge
stops on a conflict, name each file you resolved in the merge report, since
that code changed after the user looked. When they ask for
changes, `splates claim <task>`, add each as a step under `## Next`, and work
through them as before.

While a review waits on the user, every reply that ends your turn ends with
the whole review report again, brought up to date, never its last line
alone: after you answer a question about it, after the changes they asked
for, or after anything else they say in between. The `splates server` page shows
the Ready to merge card, which the user merges from, only for a whole report.

## Artifacts

Use artifacts proactively when the conversation warrants something the user
can explore or return to, especially HTML artifacts: an interactive
explanation, a comparison of options, a diagram with details to inspect, or
a small tool for trying scenarios. Do not wait for the user to ask for an
artifact when one would make the work easier to understand or judge. Choose
one when its visual structure or interaction adds value, rather than for
every reply.

Screenshots remain the first choice for showing what the actual UI looks
like, with recordings for behavior over time. An HTML artifact can complement
that evidence with an explanation or exploration; label a mockup or
simulation as such so it is clear what the user is seeing.

An artifact is a file the user will come back for after the task is gone: a
screenshot or recording of the finished work, an HTML page, a generated
document. It belongs to the conversation, not the task, so it outlives every
task the conversation runs, and the `splates server` page lists the conversation's
artifacts beside its thread. It opens an image or a recording in its
lightbox, an HTML page in a frame that runs its scripts but loads nothing
else, so make a page one file with its styles, scripts and images inline,
and offers anything else as a download. Keep one with `splates artifact add <file>`, named
for its basename, or `--name <name>` for another. Adding a name the
conversation already holds makes that artifact's next version, the earlier
ones kept until cleanup takes them, so give one thing one name and add it
again whenever it changes,
rather than a new name per take. `splates artifact remove <name>` once it no
longer stands, as when the work it shows was redone or dropped; `splates
artifact list` and `splates artifact show <name>` read them back. It needs a
conversation: `$SPLATES_CONVERSATION` from `splates server`, or
`--conversation <id>` from outside it.

Most files you show are not artifacts: a screenshot that shows a question, an
image in a report's card, a demo step's image. Each serves the moment it is
shown in, so it stays inline: `splates attach` it and name it as
`![what](/abs/path.png)`, as Questions and Demos say.
Make a file an artifact only when the user would look for it on its own,
apart from the reply it came in.

## Reporting

The user reads a report at a glance, so it holds only what they need to act
on. However a task ends, say so in one block: a `##` title, a blank line, and
one plain sentence, under 25 words, on what changed for the user. The title is
the emoji, the outcome, and the bare task name, then the base for a merge, or
otherwise, after a colon, what it waits on or why it went, led by what it
needs from the user (a review, a decision, access, a test only they can run).
Keep the title to about eight words, lowercase after the colon, with no ending
punctuation.

The sentence names the one change the user will notice, not each part of it:
status codes, errors thrown and the rest are the diff's. Then stop, but for
a `- ` line, at most three, on anything the user must act on or would be
caught out without: a restart to pick the change up, a file resolved in a
conflict after their review, a queued task gone stale. Leave out what the page, the
diff, or `SPLATES.md` already says: that tests pass (but for a review's
checks), that nothing is merged yet, the files touched, how you did it, and
the calls you made yourself.

Count the sentence's words before you send it, and at 25 or more, cut it
rather than split it in two. Not this body, which lists the parts, says the
tests pass, and says it is not merged:

```markdown
Uploads no longer retry forever on a 413. They now tell the user the file is too big and fail; `bun test` passes. It is not merged yet: it waits on your answer below.
```

But this, one sentence at 15 words:

```markdown
An upload the server refuses as too big now stops and tells the user why.
```

When the user has answered questions since your last report, add a `- `
line for each answer you did not follow as given, or that changed more than
it named, saying what you did instead and why. Answers followed as given need
no line.

```markdown
## ✅ Merged <task> onto <base>

One sentence on what changed.

- Restart `splates server` to see it.
```

```markdown
## 🛑 Removed <task>: superseded by a fix on main

One sentence on what the task set out to do.
```

When the task made an artifact, a merge report names it in a `- ` line,
`- Artifact: <name>`, rather than inlining it: the page lists it already, and
the report stays a glance.

A handoff makes no report: the `splates server` page shows it as splates's own line,
and the agent it went to as that line's hover. Say where the task stands in
its `### Handoff`, then end your turn.

A lane orchestrator reports on its lanes instead, as
[references/lanes.md](references/lanes.md) says.

An escalation or a review can need more than that before the user can
answer or merge: what you found, how it works, what it costs. Say it in
sections, so every card reads the same: a `####` line stating one point in a
sentence, then `- ` lines with its details, one fact each, and no paragraphs.
Give a section only to a point the user needs; most reports need none. Keep
to `####`: a `##` or `###` heading would end the card.

```markdown
## ⚠️ Escalated <task>: needs two calls on the task board

One sentence on what changed.

#### A card drags on a phone only after a long press.

- A short press still scrolls the lane.
- The long press is half a second, as on the home screen.

### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card, then drag it to another lane.
   It lands where you drop it.

1. What feels off when dragging a card on a phone?
2. How should a stale task be shown?
   - (a) A muted card
     ![muted card](/abs/path/muted.png)
   - (b) A "stale" badge
     ![stale badge](/abs/path/badge.png)
```

An escalation ends with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
`SPLATES.md`, after the demo they ask about, if any. Ask every question you need
answered there, never in prose. The user answers from the report, so each
item carries what is needed to answer it: its subject, at most one line of
body under it, the choices exactly as in `SPLATES.md` (so a reply of `2. b`
names one), each with its `Why:` line, which the page hides and the one line
of body leaves out, and each screenshot or file by absolute path, under the question
or choice it shows as in `SPLATES.md`. Inline a screenshot as
`![what](/abs/path.png)` when the `splates server` page or your harness shows
images in chat; otherwise link it as `[what](/abs/path.png)`. Leave an item
bare when its subject says it all.

```markdown
## 🔍 Ready to merge <task> onto <base>

One sentence on what changed.

### 🎬 Demo: moving tasks between lanes

Open http://localhost:4310 (a demo repo, nothing of yours).

1. Drag a task to another lane.
   It lands where you drop it.
2. Reload.
   It stays there.
   ![the board after a drag](/abs/path/board.png)

Checks: `bun run typecheck`, `bun test`

#### A drop saves the task's lane and position in one write.

- A reload never shows it half moved.
- A drop on its own spot writes nothing.

Reply "merge", or say what to change.
```

A review asks no numbered question: after its sentence comes the demo of
what to check, then a `Checks:` line naming each check you ran that passed,
as the project's instructions name them, each in backticks, and under it,
when one failed for a reason outside the task, a `Failed:` line naming each
that failed the same way, then that last line exactly, so every review reads the same. Anything more the user may
want before merging, such as how it works, goes in sections between the
checks and the last line: the `splates server` page folds it away as its details,
below the checks.

Ask every question to the user in this format, wherever you ask it: a
mid-task reply, a merge report, a quick clarification before any task, or a
message outside any task. The `splates server` page shows a question as its
question card, with choices to tap and a box to answer in, only when it is
an item of a list numbered from 1 at the margin, outside code blocks, so
ask even a lone question as `1. ...?`. Never put one in a bulleted list,
several in one item, or one tucked into a sentence: those show as plain
text the user must answer by typing. Each item's line ends at its `?`, as
under `## Blocked`, its body and choices indented under it.

## SPLATES.md

Your session can die at any moment; `SPLATES.md` is what lets a stranger
`splates claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

````markdown
# <task>

## Goal

One or two lines on what done means.

## Next

- [ ] every step you can foresee, roughly one commit each, checked off as
  it lands

## Notes

Decisions, dead ends, and how to verify.

## Blocked

- [ ] questions the user must answer before the task merges
````

The Goal's first line is what other agents see of your task in `splates list
--files`, so make it say what you are changing. Keep the rest current as you
go, not at the end: check steps off as they land; the git log records them. Run `splates show <task>` after writing it to check
the shape. It is excluded from git: never mention it in a commit message.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

`splates merge --message "<message>"` squashes the task to one commit before
it lands: describe the net change, what the base gains, not the path you
took.

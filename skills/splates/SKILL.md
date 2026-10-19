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
| `[SPLATES TASK #N]` | Take queued task N | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <task> --task N`, then groom it as [queue.md](references/queue.md) says under Grooming a task you start |
| `[SPLATES TASK <task>]` | Resume a task | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands |
| `[SPLATES SETUP <step>]` | Walk the user through one step of setting splates up, from the Setup page | [setup.md](references/setup.md) |
| `[SPLATES MERGE]` | The user approved your review, from the Ready to merge card | As for a reply of "merge": see Merge or review |
| `[SPLATES APPROVE]` | The user approved your proposal, from its card, with any answers after it | As for a reply of "approve": see Proposing |
| `[SPLATES DEFER]` | Queue the request after it as a task rather than do it; alone, make the user's message before it one, and stop | [queue.md](references/queue.md), Deferring |
| `[SPLATES EVENT <event> #N <task>]` | A hook the user set on a task event (`task.created`, `task.done`, ...) started you for it | Do what the prompt after it asks, about task N; `splates task show N` prints it. Start a task of your own only when that prompt asks for a code change |
| `[SPLATES DEMO <task> <point>]` | The user asked to see a task's demo, at `before`, `after` or `main`, from its task dialog | Demos, Running a demo |
| `[SPLATES CHECKPOINT]` | Bring `SPLATES.md` up to date and stop, as before a restart | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RESUME]` | Carry on from where `SPLATES.md` says you stopped | [checkpoint.md](references/checkpoint.md) |
| `[SPLATES RECONNECT]` | A lost connection cut your last turn short, and splates, once it is back, or the user asks you to carry on | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it.

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
2. **Plan.** Once you know what done means, sharpen the Goal in `SPLATES.md`
   before touching code, and when the work will take several commits, list
   them under `## Next` (see SPLATES.md below).
3. **Check for overlap.** Read `splates list --files`: each task's Goal and
   the files it has changed so far. Some overlap is normal: work alongside,
   accept the rebase, and note it in `SPLATES.md`. Only when conflicts would be hard to resolve, `splates wait
   <task>` for the other task to land first. If it is doing the opposite of
   what you were asked, ask the user instead (see Questions).
4. **Work.** Commit each step with git as you go, and check off any under
   `## Next` as you commit it; splates never commits for you. When something outside
   your Goal comes up (a bug next door, a follow-up, a reply that widens the
   task), `splates task add` it from your worktree and move on,
   so the task stays one coherent change; the conversation shows what you
   queued (see Queueing tasks). A snag on the way, such as a lost
   connection, a conflict or a retry, is no task to queue; `splates merge` queues one
   itself for each test that failed its gate. Ask the user each call their
   answer would change, and make the rest yourself (see Questions), bringing
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
   any step you will not do, then check it off, and `splates merge --message
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

   Each `conflict`, `tests_failed` or `merge_failed` spends one of the
   task's merge attempts, so write under `## Notes` what each one failed
   on. When `merge` stops on `budget_exhausted`, ask the user (see When you
   cannot go on): a `- ` line per attempt on what it failed on (the files
   that conflicted, the check that broke, the tree in the way), one on what
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
it: what still holds and what you learned. Merging removes the queued task
yours took: when you leave part of it undone, `splates task add` what is
left as a task of its own.

When `splates add --task` warns that a task is blocked,
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
attached outside one, it goes when the task does. Either way, one the
`SPLATES.md` it ends on shows is copied to keep with the finished task, so
its record goes on showing it. Such a file is no artifact
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

### When you cannot go on

When questions are still open once everything else is done, or you cannot go
on without the user (access, a decision, a test only they can run), stop and
ask. A secret, such as an API token, is a cred to request instead (see
[references/creds.md](references/creds.md)).

1. Leave something to look at, by **absolute path** (start from
   `splates path <task>`): for anything visual, a screenshot or recording you
   `splates attach`. Ask first if producing it is expensive.
2. Make sure each question is under `## Blocked`.
3. Ask them in your reply as Reporting says, and end your turn: the page
   shows you waiting on the user. Do not `splates wait` or poll `SPLATES.md`:
   answers only come in chat. A new session resumes with `splates claim <task>`.

Never ask whether the work is ready to merge: once the questions are answered
and the work is done, merge or ask for a review (see Merge or review).

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

When the user asks to see the work before it lands, write `Review:
requested` under `## Notes` at once, so the request outlives your session.

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `splates merge` refuses one that is not, and a review
is sent only for one that is. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself, its evidence under `## Verification`
  (see SPLATES.md). This is the default, and the usual end of a small change.
- **Ask for a review**, with a demo (see Demos), when the change is invasive
  (it reworks how something the user relies on works, or touches much of the
  project) and above all when it is hard or impossible to reverse (a
  migration, data written, anything sent outside the repo), or when
  `## Notes` says `Review: requested`. The demo is the user's chance to step
  in before it lands: their feedback decides whether it merges. Leave
  something to look at (step 1 of When you cannot go on), send the Ready to
  merge report (see Reporting), which is the whole request, and end your turn.

When the user has to try a change before it lands, make that cheap: run it
for them where they can open it (a dev server on throwaway data that shows
each case, never their own), and give them a demo (see Demos). Run splates in a
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
its server; that stops nothing else, so before merging, stop every process
you started in the worktree yourself, such as a dev server in the background. Every other slot is another task's: never kill its server or edit
`~/.splates/slots.json`, even when it looks left behind. When none is free, run
`splates slots prune`, which frees only those no task holds any more, and
otherwise ask the user.

When the user approves a review, by replying "merge" or with
`[SPLATES MERGE]`, `splates claim <task>` and merge, naming in the merge
report each file you resolved in a conflict, since that code changed after
they looked. When they ask for changes, `splates claim <task>`, add each as a
step under `## Next`, and work through them as before. While a review waits,
every reply that ends your turn ends with the whole review report again,
brought up to date: the page shows its Ready to merge card only for a whole
report.

## Proposing

Propose only when the user asks what you think, so they can approve it or
challenge what it rests on. Otherwise build, asking each call the user's
answer would change as a question (see Questions) rather than a proposal.

A proposal is one block: a `## 💡 Proposed <subject>` title, the subject a
few words on what you would build, then what you recommend and why, briefly.
It ends with each call it rests on that the user has not settled, as
questions numbered from 1 (see Questions).

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
for, quoted as any answer is (see Keeping Blocked current). That, or a reply
of "approve", means go ahead as proposed, taking in each answer, every call
not quoted as you chose it, after `splates add` when no task is under way. A
reply without it, as the card sends once the user picks another choice,
changes a call or writes anything else, answers what it quotes: take that
in and propose again.

## Demos

The norm is evidence, not a demo: the user reads what you verified under
`## Verification` in the task dialog, and starts a demo from there only when
they want one. Start one yourself only when the user must see something to
answer a question, or to judge a review (see Merge or review). A demo is a
`### 🎬 Demo: <what it shows>` heading, a line on where to open it, then the
steps, numbered from 1. Each step's line is one thing to do; indented under
it, one line on what they should see, and a screenshot or recording only
where words fall short. The `splates server` page shows a demo as a card of
its steps, with a button that opens where it runs.

```markdown
### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card.
   It lifts after half a second.
2. Drag it to another lane.
   It lands where you drop it.
   ![dropped in Doing](/abs/path/drop.png)
```

Give one demo per message: right before the questions it is for, or inside a review before its last line. The steps
are the demo's only numbered list: never number steps elsewhere in a report,
where they would read as questions.

### Running a demo

`[SPLATES DEMO <task> <point>]` asks you to show `<task>`, open or finished,
at one point: `before` its change, `after` it, or on `main` as it is now.
It comes to the conversation that last worked the task, so you may hold its
context already; otherwise read it all with `splates show <task>`, which
prints a finished task's facts and the `SPLATES.md` it ended on too.

1. `splates add demo-<task>-<point> --goal "Demo <task> at <point>"`, with
   `--base task/<task>` for `after` while the task is open, so the demo runs
   in a worktree of its own that nothing landing on main moves.
2. Move it to the point: for a finished task, `git reset --hard <commit>^`
   for `before` and `git reset --hard <commit>` for `after`, `<commit>` the
   one it landed as. `main`, and `before` while the task is open, stay where
   `splates add` put them. This reset is yours to run: a demo task never
   merges.
3. Set it up as the task's `## Demo` says, on throwaway data, and start it
   where the user can open it (see Merge or review on servers and links).
4. Say in a line what they should see at this point, then give the demo's
   steps, and talk it through. A fix it turns up is work for the task, while
   it is open, or for a new task, never for the demo's.

The demo stays up until the user archives the conversation, which removes
the demo task and stops its server and agent.

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

However a task ends, say so under a `##` title, which the `splates server`
page turns into its card: the emoji, the outcome and the bare task name,
then the base for a merge, or otherwise, after a colon, what it waits on or
why it went. Under it, say briefly what changed for the user, and anything
they must act on or would be caught out without (a restart to pick it up, an
answer you did not follow as given). Leave out what the page, the diff or
`SPLATES.md` already says. A `##` or `###` heading ends the card, so keep any
heading inside it to `####`.

```markdown
## ✅ Merged <task> onto <base>

Cards on a phone now drag on a long press. Restart `splates server` to pick it up.
```

```markdown
## 🛑 Removed <task>: superseded by a fix on main

The task set out to stop uploads retrying a 413.
```

A merge report names any artifact the task made as `Artifact: <name>`
rather than inlining it.

A turn that ends on questions needs no title: say in a line or two where the
work stands, then end with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
`SPLATES.md`, after the demo they ask about, if any. Each item carries what
is needed to answer it: its subject, at most one line of body, the choices
exactly as in `SPLATES.md` (so a reply of `2. b` names one) with their `Why:`
lines, and each screenshot under the question or choice it shows.

```markdown
The board can now mark a stale task, once you pick how.

1. How should a stale task be shown?
   - (a) A muted card (chosen)
     ![muted card](/abs/path/muted.png)
   - (b) A "stale" badge
     ![stale badge](/abs/path/badge.png)
```

A review asks no numbered question. After what changed comes the demo of
what to check, then a `Checks:` line naming each check you ran that passed,
in backticks, and a `Failed:` line for any that failed for a reason outside
the task, then this last line exactly, which the page needs to show its
Merge button:

```markdown
## 🔍 Ready to merge <task> onto <base>

Old upload links now redirect to the new storage, after a migration that moves every stored file.

### 🎬 Demo: an old upload link

Open http://localhost:4310 (a copy of staging's uploads, nothing of yours).

1. Open `/u/old-link`.
   The file downloads from the new storage.

Checks: `bun run typecheck`, `bun test`

Reply "merge", or say what to change.
```

Ask every question to the user as an item of a list numbered from 1 at the
margin, outside code blocks, wherever you ask it, even a lone one as
`1. ...?`: only then does the page show it as a card with choices to tap.
Each item's line ends at its `?`, as under `## Blocked`, its body and choices
indented under it.

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

---
name: splates
description: Use the splates CLI to land work on trunk from an isolated git worktree without pull requests. Read it before investigating a possible code change, before running tests or anything heavy, before asking the user a question, and before answering when they ask what you think of a change or idea (a proposal has a fixed `## 💡 Proposed` shape only this skill gives), in a splates repository, and first whenever a message holds a `[SPLATES ...]` directive. It also covers adding, claiming, merging, removing, listing, deferring and queueing tasks and lanes.
version: 2.0.8
---

# Using splates

`splates` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @stringsync/splates <command>` (or
`splates` if on PATH). `splates --help` explains the commands; this file covers
only what the CLI cannot tell you. A bare `splates` prints help; start the
server with `splates server`. `splates dev` is only for developing the splates
repository itself (its eval and ship commands).

## Principles

The rules below follow from these. When a case is not covered, reason from them.

1. **Get approval for work that is costly or hard to undo.** A wrong idea costs a few lines in a proposal and a rewrite once built, so a large task needs approval even if it is easy to revert.
2. **Build so the work is easy to undo.** This applies to every task, approved or not: small commits, nothing that cannot be reverted.
3. **Ask only what the answer would change.** Every other call is yours; the user's attention is the scarce thing.
4. **Keep each task to one goal.** Finish what that goal needs in the task, and queue only what really needs to be separate.
5. **Leave the work resumable.** Your session can die at any moment: commit as you go and keep `SPLATES.md` current.
6. **Leave spending and release decisions to the user.** Ships, evals, the queue, and heavy runs on a busy machine are theirs to start.
7. **Show the change rather than describe it.** The user only sees what was actually delivered.
8. **Finish what you start.** Land or remove the task, and queue follow-ups instead of offering them.

## The short version

Most of what follows fills in these steps. Hold to them even when you skip
the rest:

1. **Add a task before you look.** When a request may end in a code change,
   run `splates add <task> --goal "<what done means>"` first (with `--tag
   <project>` when the repository's config lists tags, and the project's name
   left out of the task name), then read and
   edit only in the worktree path it prints.
2. **Propose while it is cheap (principle 1).** After your first look, a task's first reply is
   a proposal card (Before | After, the one line, the calls it rests on as
   numbered questions), and code waits for Approve unless the task is easy
   to reverse and takes little effort to execute. For those tasks, start and
   build without asking permission or waiting for proposal approval; say so
   in a line. See [proposing.md](references/proposing.md).
3. **Ask as a numbered list.** Every question for the user is a `1.` item
   ending at its `?`, as in Formats below.
4. **Go easy on a busy machine.** The user works on it beside other agents.
   What is heavy depends on the project and the hardware, and nothing enforces
   this, so it is your best effort:
   - Check a change with `bun test --changed` or explicit test files. In
     the mono repo: `bin/mono test --since main` or file paths, and
     `bin/mono fix` once per step. The merge gate runs the rest, so a whole
     run of your own is usually the same work twice.
   - Before a command you expect to take a lot of CPU or memory (a whole test
     suite, a full build, docker, a benchmark, a profile, a browser test run,
     anything that keeps cores busy for more than a minute), run
     `splates machine`. Not busy: run the command. Busy: ask with a run-command
     card (`## 🔐 Permission: run command: <why>`, the command alone on a line
     in backticks, under it that you ask because the machine is busy and what
     the command would add), end your turn, and run it only on
     `[SPLATES RUN ALLOWED]`.
   - A cost that is not compute (tokens, a write outside the repository, a
     deploy): ask with the same card, however the machine is, saying that cost.
   - Run anything else without a card: an install, a typecheck, a lint, a
     test file or two, a commit, a short script.
5. **Commit as you go**, in plain messages with no attribution.
6. **Do, queue or drop what you notice.** Do what the After needs and small
   fixes in code you already change. Queue (`splates task add` or `defer`,
   before merging) only what is in another project, needs its own approval or
   is unrelated to the goal. Drop what you would not bother doing, offering
   nothing.
7. **Land with `splates merge --message "<what the base gains>"`**, run in
   the foreground, never in the background, then `cd`
   to the main tree it prints. When it fails, do what its stderr says.
   Then close the board tasks the merge made moot, as
   [merge.md](references/merge.md) says.
8. **End with the report**, its title copied from Formats below, one line on
   what changed for the user, and nothing after it: the task is over, so the
   report asks nothing and offers nothing.

Every landing goes through `splates merge`: use git only to commit and to
finish a rebase left in progress (`git add`, `git rebase --continue`), then
merge again. A failed command prints `{reason}` JSON on stdout and what to do
on stderr: do what stderr says.

**Deliver screenshots before asking for visual review.** A tool preview is
visible to you, not automatically to the user. Run `splates attach <file>`,
then copy the image Markdown it prints into your reply, outside a code block.
Use the stored path it returns, not the original capture path. In a task,
every screenshot of the result you attach also goes under `## After` in `SPLATES.md`,
after its sentence, as the same image, written before you reply, even when the task stays open,
the reply already shows it, or the capture falls short of the change.
When the user asks for a review, your reply is the Ready to merge card itself, carrying the attached image: a line saying you are about to attach, review or deliver it is not the reply, so run `splates attach` and send the card in the same turn.
A filename, plain link or “see screenshot” does not deliver an image. If
attachment fails, report the failure rather than claiming the user can see it.

**Show a long task's progress on a card, not in chat.** For a background task
that takes minutes (an import, a build, a long test run), report with
`splates progress <id> "<what it is doing now>" --title "<name>" --percent <n>`
instead of a chat line per step. It updates one card beside the thread, and
the conversation's row spins while it runs. Pipe a command's output in with
`-` as the text (`long-command | splates progress build -`) to stream it: each
line becomes the note, and a `NN%` in it sets the percent. The server shows a
card at most every two seconds and keeps only the newest of a burst, so report
as often as is natural. Finish it with `--done` or `--failed`; use a background
command's id as `<id>` and it closes when the command ends. Archiving the
conversation clears its cards.

## Formats

The `splates server` page turns these shapes, and only these, into cards the
user taps. Copy them exactly, filling in the `<...>`.

A question, a lone one numbered `1.` too, the why indented under it and,
when the answer is one of a few, `- (a)` choices marked with your pick
`(chosen)`. Choices with an implicit order (mockup variants A, B, C, D, steps,
sizes) are listed in that order, the pick wherever it falls; otherwise any
order, your pick first by default:

```markdown
1. Should the old upload endpoint stay for a release?
   It is still called by the mobile app's last version.
   - (a) Keep it for one release, logging each call (chosen)
   - (b) Remove it now
```

A plain yes or no is asked the same way, as `- (a) Yes` and `- (b) No` choices; the user can always add words to the answer.

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
## 🧹 Removed <task>: superseded by a fix on main

The task set out to stop uploads retrying a 413.
```

When the work is blocked and only set aside for later, remove it with
`--reason blocked`, which asks why it stopped and what it waits on (a task
in another project as `--blocked-by wren#404`), and report it
deferred, the blockers in short after the colon, not removed. Ask any
question the work waits on as a numbered question, never as a blocker. When
the tasks it waits on can be queued, end the reply with their queue card,
the deferred task last, so the user queues them all in one press:

```markdown
## ⏸ Deferred <task>: waiting on #812 and #813

The task set out to stop uploads retrying a 413; it is back on the board.

## 🔐 Permission: queue #812, #813, #20: Upload client first

`splates queue add 812 813 20`

The client and the retry flag land first, then the retry itself.
```

When the work the conversation was for is over and no task merged, was
removed or deferred (a question you were asked to look into answered, a
setup step finished, an automation's run from a hook prompt, `[SPLATES EVENT
...]` or `[SPLATES SCHEDULE <n>]`), its last reply is a Done report, what came
of it after the colon, so the user sees the work is over and archives it. A
Done report claims nothing is left: use it only when the request is fully
met and no step, fix or follow-up remains that the user might want. A
finding that leaves something to do (a bug found, a fix identified, a
change proposed) is not over: say what you found and ask whether to
proceed, as a numbered question, with no Done title. An eval loop whose
scenario already passes ends on Done with its pass rates, though its task is
removed (see [evals.md](references/evals.md), Stopping). Never end on Done
when the user asked for a change and none was made, or when the next move is
theirs to approve. A Done report holds no demo: a demo you want to mention is
its own card, sent before it. A reply in a talk that carries on is no Done report:

```markdown
## ✅ Done: two merged tasks reviewed, nothing to fix

Both kept their tests; the notes needed no change.
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

A command you expect to take a lot of CPU or memory, asked for because
`splates machine` says the machine is busy, is asked with the run-command card:
the command alone on the first backticked line, and under it why you ask and
what it adds. End your turn after it. The user's Allow sends
`[SPLATES RUN ALLOWED]`, and only then do you run it. The card is text: outside
the page the user can type that directive, or `[SPLATES RUN DENIED]`, or `[SPLATES RUN ELSEWHERE]` (a `rec` card only: not at that machine), or answer
in plain words, and it means the same.

```markdown
## 🔐 Permission: run command: build the web app

`bun run build`

Asking because the machine is busy (CPU 93%); this adds about two minutes of load.
```

Run `splates evals agents` first: it prints the saved eval agents, and an
`Agents:` line copies those targets verbatim and names no other (with none
saved, leave the line out).

Evals cost the user tokens, so only they start them, approving every round.
An eval conversation carries a dollar budget and a round cap; every run card
waits for the user to review its agents and press Run. The budget limits
spending, never authorizes a start. Outside the limits a run is refused with
`budget_exhausted`, naming the limit; then stop and report (see
[evals.md](references/evals.md), Stopping). You never edit the limits: the
user tops them up. To ask for a run (in
a project whose `splates.config.ts` names `evals.list` and `evals.run`, as
splates's own does, its list naming the scenarios), end your reply with the
run card, the word after `run evals` naming the skill or suite: the
scenarios you picked, one `` - `id` `` item each, and optionally the
revision the change is judged against and how many times to run each cell
(`Repetitions: <n>`, to tell a change from noise) and the saved agents to
run on (`Agents:` then each as `` `agent:model@effort` ``), chosen only from the saved
eval agents the project allows, never an agent you invent, leaving out those that need no
rerun, such as a model already passing; with no `Agents:` line every saved agent runs. The page shows it with
the saved eval agents, only those named ticked, and, when the project prints a plan, what the run
costs at most; it runs in your worktree, and its Run button is the user's
for every round: never run the eval command yourself.

```markdown
## 🔐 Permission: run evals splates: the resource scenarios

Checks the new wording of the scoped-tests rule.

- `resources/focused-tests`
- `resources/whole-suite`

Baseline: `main`
Repetitions: 3
Agents: `<agent:model@effort>`, `<agent:model@effort>`
```

In another project, evals from any framework show on the Evals page when the
project's `splates.config.ts` names `evals: { results: "<dir>" }` and a
reporter writes a `batch.json` and `results.jsonl` there in the
`splates-evals/1` format, documented in `docs/evals.md` of the splates
repository (https://github.com/stringsync/splates), with an example reporter.
When asked, write that reporter for the project's framework, or for Inspect AI
run `splates evals import inspect <log> <batch-dir>` in its place, and the
`list` and `run` commands the docs lay out, for run cards to start it.

Once the run is done, splates tells you with `[SPLATES EVALS DONE <batch>]`
and the report condensed: each scenario's pass rate on each agent, and for
each run that failed, the checks that failed, the judge's reason and the
reply, with the runs that errored listed apart.
Leave remarks on a batch
with `splates evals remarks <batch-dir> <file>` ([evals.md](references/evals.md)):
what failed and why, what held up, any special circumstance. They stay
viewable and show in its card.
Improving a scenario is a
loop of run, diagnose, fix one thing, rerun and log, which
[evals.md](references/evals.md) lays out: read it before the first run card
of a task and when the run is done. The loop improves the skill, not the
grader: a change to a check, judge prompt, seed or message cites the run it
misjudged, shows the `bin/evals regrade` flips in `## After`, labels
that run, and counts as a new baseline, never as a better pass rate; the
landing commit names the batch that drove it (evals.md, Grader changes).

## In every conversation

These ways hold in every conversation in a splates repository, with a task
open or not: a design talk, or a question answered from the main tree, asks,
proposes and reports as a task does. A task adds only its record in
`SPLATES.md`.

Only the user runs `splates queue pause` or `splates queue resume`, which
pause or resume automatic starts across the server, as Pause on the Queue
page does. Running agents finish, and the user can still start their own.
Both take `--dev <url>` (otherwise `SPLATES_DEV`) to reach the server.

Only the user ships, and a ship starts on the Ships page, never from you.
A project that cannot ship yet, or has no evals on the Evals page, has a setup
journey for each on the welcome page and in Setup (`splates setup ships`,
`splates setup evals`): see [setup.md](references/setup.md), Ships and evals.
Never run `npm login` or `npm publish`: only the user starts a publish, and a ship signs in to nothing. When you think a release is due (a fix on
the base that users are waiting on), end your reply with a run-command card
naming `splates ship <project>`, the why under it saying what the release
carries. The page shows it as a ship card whose button opens the Ships page
with that project picked; it starts nothing, so carry on without waiting. A
merge is never a release.

```markdown
## 🔐 Permission: run command: ship wren

`splates ship wren`

The log rotation fix is on main and unreleased; mdom and vexml take it next.
```

Agents may add empty lanes and remove empty lanes. Removing a lane containing
tasks needs the user's remove-lane permission card (see
[reporting.md](references/reporting.md)). Backlog is permanent. Agents place
every lane on a board and may add and remove empty boards (`splates board`);
see Boards in [queue.md](references/queue.md).

You never change the queue, which splates refuses an agent: when a
conversation asks for several tasks, or a request is several medium changes,
offer a lane and add it once the user agrees (see
[queue.md](references/queue.md), Asking the user to queue), and when the user
asks you to queue work, add it; either way, end your reply with its queue
card for the user to queue it now or later.

A task started by a ship belongs to that ship alone. Follow its mechanical detail and the user’s instructions: fix what breaks and land with `splates merge`, which tells the server it is OK to publish (run no ship command yourself), never change the release type or bump further. Its branch already holds the adopted pins and refresh work. If it cannot land, remove it with `--reason blocked` and explain why; this stops the ship. Never queue a ship’s task. Its task may be a deliberate "check this upstream update for API breaks" chosen up front (Agent task), not only a fix after a failed adoption: either way fix what breaks, land with `splates merge`, and never bump further.

## Seeing a bug in a browser

When watching the bug happen in a browser would settle what to change (a
visual or interaction fault you cannot reproduce from code alone), offer a
rec session, a narrated recording the user makes. Offer it only when `rec`
is on the PATH (`command -v rec`), and ask with a run-command card, whether or
not the machine is busy, naming the exact command with a name and the URL to
open: `rec --name <name> --url <url>`, adding `--docker` or `--tail` when the
app's container or log file should be followed. End your turn after the card
and never run `rec` without `[SPLATES RUN ALLOWED]`; this is a rule you
keep, not a lock. On `[SPLATES RUN ELSEWHERE]` or `[SPLATES RUN DENIED]`, carry
on without rec and do not offer it again in that conversation.

```markdown
## 🔐 Permission: run command: record the broken checkout

`rec --name checkout-bug --url http://localhost:3000/checkout`

Opens rec's Chrome on the checkout page so you can show the bug while narrating.
```

A `#rec:<name>` reference in a message names a recorded session: run
`rec sessions path <name>` and read the session as the rec skill says.

## Directives

A prompt that has `[SPLATES ...]` comes from the `splates server` page or
from splates itself, and asks what the table says. A row that names a file
asks you to read it as Reference files says. A few directives have no row
because the page sends them rarely: `[SPLATES SETUP <step>]` ([setup.md](references/setup.md)),
`[SPLATES DEFER]` ([queue.md](references/queue.md), Deferring), `[SPLATES DEMO <task> <point>]` ([demos.md](references/demos.md)),
`[SPLATES UNMERGE <task>]` ([merge.md](references/merge.md), Unmerging),
`[SPLATES EVALS DONE <batch>]` ([evals.md](references/evals.md)), and hook
prompts `[SPLATES EVENT ...]` and `[SPLATES SCHEDULE <n>]`, where you do what
the prompt after it asks and end with the Done report in Formats above,
unless your last reply is already a Merged, Removed or Deferred report. Read
the file when one arrives.

| Directive                           | What it asks                                                                                                                                      | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[SPLATES TASK #N]`                 | Take queued task N                                                                                                                                | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <slug> --task N`, under the `slug:` it prints when it has one, then, when `splates task show N` says `groomed: no`, groom it as [groom.md](references/groom.md) says under Grooming a task you start; then [queue.md](references/queue.md), Taking a queued task |
| `[SPLATES TASK <task>]`             | Resume a task                                                                                                                                     | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands                                                                                                                                                                                                                                                                                                                                                                               |
| `[SPLATES MERGE]`                   | The user approved your review, from the Ready to merge card                                                                                       | As for a reply of "merge": [merge.md](references/merge.md), Merge or review                                                                                                                                                                                                                                                                                                                                                                                    |
| `[SPLATES APPROVE]`                 | The user approved your proposal, from its card, with any answers after it                                                                         | As for a reply of "approve": [proposing.md](references/proposing.md)                                                                                                                                                                                                                                                                                                                                                                                           |
| `[SPLATES GROOM #N]` | You are the project's groomer: organize ungroomed Backlog task N and place it in a lane, never doing it | [groom.md](references/groom.md) |
| `[SPLATES LANE N]` | Work down lane N (`backlog` or 0 is the Backlog lane) | `splates lane show N` prints the steps and whether the next is blocked; [queue.md](references/queue.md) |
| `[SPLATES RUN ALLOWED]`             | The user allowed the command your run-command card asked to run | Run that command now, as the card asked, then carry on |
| `[SPLATES RUN ELSEWHERE]`           | The user is not at the machine that can run the `rec` command your run-command card asked to run | Do not run it, and do not offer rec again in this conversation: carry on without it |
| `[SPLATES RUN DENIED]`              | The user turned down the command your run-command card asked to run | Do not run it: carry on without it, or ask what to do instead |
| `[SPLATES EVAL LOOP <run>]` | Improve the eval scenario the Evals page run `<run>` did not pass, or, as `[SPLATES EVAL LOOP scenario <id>]`, a scenario that may have no run, or passes, within the `Budget: $<usd>` and `Rounds: <n>` lines that may follow | Add a task, then read [evals.md](references/evals.md), Starting from a run or a scenario, and work the loop there |
| `[SPLATES EVALS BUDGET USED UP]` | The conversation's eval dollar budget or round cap is used up, so your run evals card was refused | Do not ask for another run or run the eval command yourself: stop and report which limit it was, and that the user can top it up ([evals.md](references/evals.md), Stopping) |
| `[SPLATES RETRIED]`                 | The user granted your task another round of merge attempts, which the page has run `splates retry` for | Merge again, as [merge.md](references/merge.md) says under When a merge fails |
| `[SPLATES GRANTED]`                 | The user gave the reach your grant card asked for, which the page has granted | Carry on with the work in the other project it was for, as [projects.md](references/projects.md) says |
| `[SPLATES GRANT DENIED]`            | The user turned down the reach your grant card asked for | Nothing was granted: carry on without that reach, or ask what to do instead |
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
  when resuming a task `splates claim` lists open questions for:
  [references/questions.md](references/questions.md), asking and reading
  answers. Also read it when you
  cannot go on without the user.
- Before `splates task add` or `splates task defer`, `splates lane add`,
  a queue card, or `splates task update` or `splates lane update` with
  `--lane`, `--position` or `--blocked-by`: [references/queue.md](references/queue.md), writing,
  deferring, linking, placing and ordering tasks.
- Before `splates task add`, when you take a task `splates task
show` says is `groomed: no`, and as the project's groomer:
  [references/groom.md](references/groom.md), everything grooming checks
  and who does it when.
- Before making a demo, starting a server for the user to try, attaching
  screenshots or recordings, or creating or managing an artifact:
  [references/demos.md](references/demos.md), demos, hosting and artifacts.
- After your first look at any task, when the user asks what you think, and
  when they approve a proposal:
  [references/proposing.md](references/proposing.md).

These only when their moment comes:

- Before reading or changing a project's `splates.config.ts`, or when the
  user asks what splates can be set to do: [references/config.md](references/config.md),
  every option, its default and what it is for.
- When the user asks to set splates up on this machine, or any part of it
  (agents, remote access, workers, a tunnel of their
  own, dictation): [references/setup.md](references/setup.md),
  one step at a time.
- When your work needs a secret only the user can get, such as an API token:
  [references/creds.md](references/creds.md).
- When work here needs another splates project, or you run `splates
--project`, or `[SPLATES GRANTED]` comes: [references/projects.md](references/projects.md),
queuing work there and asking for a grant.
- When `splates artifact add` stops on `too_large`, or the user asks about
  artifact space: [references/artifacts.md](references/artifacts.md).
- When an eval scenario is not passing, in the splates repository, or
  `[SPLATES EVALS DONE <batch>]` comes: [references/evals.md](references/evals.md),
  the loop that improves it.
- When the user asks to move splates's tasks, conversations or settings to
  another machine or project, or to back them up or restore them:
  [references/transfer.md](references/transfer.md).

## Workflow

1. **Start before you look.** When a request may end in a code change,
   `splates add <task> --goal "<what done means>"` before reading any code,
   the goal one or two lines as you understand it so far (it seeds `## After`), and investigate in
   its worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree,
   asking and answering as In every conversation says.
   `splates claim <task>` resumes a task instead. When the request is a queued task,
   take it as `[SPLATES TASK #N]` says under Directives, and for any other
   directive, do what its row says. Pass `--base <branch>` only when invoked
   with a branch (`/splates feature/auth`) or the user names one; otherwise
   leave it off, whatever branch is checked out. Once `splates add` succeeds, the `splates server` page shows
   it in your conversation as splates's own line, the After line on its task, so say
   nothing about adding it. When your harness asks right after for a word on
   what you are doing, say in one line what you will do next, without the
   task's name or goal, which that line already shows. A task is one
   medium-sized change: when the request is several, offer a lane before
   investigating (see [queue.md](references/queue.md), Asking the user to
   queue).
2. **Plan and propose.** After your first look at the code, fill in `## Before` and
   `## After` in `SPLATES.md` before touching code (see SPLATES.md below), and when the work will take several commits, list
   them under `## Next` (see SPLATES.md below). Then send the proposal card
   from them and end your turn; touch no code until Approve, unless the task
   is easy to reverse and takes little effort to execute: then start
   building without asking and say so in a line (see
   [proposing.md](references/proposing.md)). A queue-started task does the
   same, waiting on its card with no one present when it needs one.
3. **Check for overlap.** Read `splates list --files`: each task's After line and
   the files it has changed so far. Overlap is normal: work alongside, and
   resolve any conflict as the rebase brings it, without waiting on the
   other task or noting it anywhere. If it is doing the opposite of what you
   were asked, ask the user instead (see [Questions](references/questions.md)).
   `splates add` warns when file paths in the After or the first changes overlap
   open tasks. Coordinate those files or queue dependent work with `--blocked-by`.
   While the server runs, `splates list` and `show` name coming conflicts at
   committed branch tips, and a working agent hears a notice when one appears.
   These checks never rebase a worktree; commit in steps so they can see the work.
4. **Work.** Commit each step with git as you go, and check off any under
   `## Next` as you commit it; splates never commits for you. A task changes
   one unit of the repository, the package or project its After names (the
   repository's own instructions say what a unit is). When something outside
   your After comes up (a bug next door, a follow-up, a reply that widens the
   task, a change another unit needs), do, queue or drop it: do it when the
   After needs it or it is a small fix in code you already change; otherwise
   `splates task add` or `defer` it from your worktree and move on when it is
   in another unit, needs its own approval or is unrelated to the goal; drop
   it when you would not bother doing it. The conversation shows what you
   queued (see [queue.md](references/queue.md), Do, queue or drop). When your change breaks another unit's use of yours,
   migrate it through expand/contract, one queued task per unit, rather than
   fix it here (see [queue.md](references/queue.md), Changing several units).
   A task that spans units is the rare exception, only when the change
   cannot land in steps, and its After names every unit it touches, so the
   reach is chosen and shown rather than crept into. A snag on the way, such as a lost
   connection, a conflict or a retry, is no task to queue; `splates merge`
   records failures on the merge attempt. It queues confirmed
   trunk or environment failures as one incident, and flakes only after they
   recur on independent tasks within seven days. It updates an open incident
   and suppresses recreation for seven days after closure; inconclusive
   failures stay with the merging agent. Ask the user each call their
   answer would change, and make the rest yourself (see [Questions](references/questions.md)), bringing
   what your last reply asked in step. A subagent of your harness that may
   change code works in your worktree, with no task of its own: tell it the
   path, to commit there, to run no `splates` command that adds, claims,
   merges or removes a task, and to list in its reply any call the user
   may need to settle, which you treat as your own. Subagents at work at
   once share the tree, so give each its own files. Go easy on the host machine the
   user works on, as item 4 of the short version says: test a small portion,
   and before anything heavy read `splates machine`, asking with a run-command
   card only when it is busy. A subagent does the same and asks through you.
5. **Land.** Merge only when the After is true: while it is not, keep working
   in this task, unless you need a decision from the user (ask) or are blocked
   (defer); never land it unmet and queue the rest as the next fix. When the
   rest is several tasks, add a lane of them, end with its queue card, and
   merge only once the After is true or cut to what landed. Once every step under `## Next` (including any user review) and
   every question your replies asked is answered, the task is ready to merge:
   `splates task add` any step you will not do, then check it off, `splates task add` or
   `defer` each follow-up you would otherwise offer or ask about once it
   lands (see [Reporting](references/reporting.md)), and `splates merge --message
"<message>"` (see Committing), or ask for a review first (see
   [merge.md](references/merge.md)). On failure, do what stderr says (after a failed gate the worktree holds the
   tested tree: reproduce the failure there first) and merge again, with the
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
work is moot, or it is better redone against current trunk,
`cd "$(splates path)"` and `splates remove <task> --reason <why>`, which
removes the board tasks it took too. Only `--reason blocked` puts them back
on the list, out of the queue until the user queues them again. Before removing work to redo, add replacement tasks with what
you learned. The reason is `nothing`
(nothing to change), `moot`, `superseded` (done some other way), `redo`
(better redone against current trunk) or `blocked` (set aside until other work
lands, a person's answer or something outside splates, each named as its
refusal says: report it as Deferred); the Stats page counts them.

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

## Before

Today, in one line, and a real screenshot (`splates attach`ed, inline as
`![what](/abs/path.png)`) or a D2 diagram of the current flow. Leave it
empty for a new thing.

## After

One or two sentences summarizing what will change, updated before merging
to summarize what happened. Under the sentence, show what was built as a demo
would: the screenshot or recording of the result. Put supporting details in
sections after After, such as `## Verification` for approved mocks and evidence or
`## Details` for context.

## Next

- [ ] for work of several commits: every step you can foresee,
      roughly one commit each, checked off as it lands
- [ ] also keep a step for a checkpoint or user review when needed

## Checks

- [x] what you verified, one claim a line
- [ ] what you did not verify, or left failing
      a line under it on why, when the claim alone does not say
```

A question is asked once, in your reply; the conversation is its record, so
`SPLATES.md` has no section for it. `splates claim` prints the cards nobody
has answered, and `splates merge` refuses while any is open. A `## Blocked`
left by an older plan is still honored.

`splates add` writes `## Before` and `## After` empty, each with a one-line
hint in an HTML comment, and no Goal. The `--goal` you give, or a queued
task's words, seed After (only the first paragraph: the rest of a queued
task's words go under `## Details`, never left in After); a queued task written with its own `## Before` and
`## After` fills both. Fill them in after your first look at the code, not
before it.

After's first line is the sentence shown everywhere: `splates list
--files`, the conversation line, the card and the merge commit title. Keep
After's words to one or two short sentences about the outcome, then the
screenshot or recording of the result. Rewrite it if the work pivoted; do not
append implementation notes, check results or lists. Put those in sections after
After. Keep approved mocks or diagrams labelled *Expected* under
`## Verification`, along with what you checked; the shipped screenshot or
redrawn diagram is the *Actual* and goes in After. Every change but a trivial
one carries a picture in After and in Before unless new. Leave
file names and internals out of the summary.
Before merging, write `## Checks`: each thing the After rests on that you
verified as `- [x]`, and each you did not, or that still fails, as `- [ ]`,
so a gap shows as one. The merged card shows them; leave the section out
when there is nothing to check.
`## Next` is optional: leave it out for a change of one commit unless a
checkpoint or user review needs a step. Keep the rest current as you go, not
at the end: check steps off as they land; the git log records them. Run
`splates show <task>` after writing it to check the shape. It is excluded
from git, so leave it out of commit messages.

A plan from before Before and After may still have `## Goal`, `## Verification`,
`## Outcome`: the server reads Goal as After and shows the
others for finished tasks, but use `## Verification` for new evidence; do not write Goal or Outcome in a new plan.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

`splates merge --message "<message>"` squashes the task to one commit before
it lands: describe the net change, what the base gains, not the path you
took.

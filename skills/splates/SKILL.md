---
name: splates
description: Use the splates CLI to land work on trunk from an isolated git worktree without pull requests. Read it before investigating a possible code change, before running tests or anything heavy, before asking the user a question, and before answering when they ask what you think of a change or idea (a plan with its approval question has a shape only this skill gives), in a splates repository, and first whenever a message holds a `[SPLATES ...]` directive, a `#rec:<name>` reference to a recorded session, or a `#<project>.<name>` reference to a signal. It also covers adding, claiming, merging, removing, listing, deferring and queueing tasks and lanes.
version: 2.0.17
---

# Using splates

`splates` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @stringsync/splates <command>` (or
`splates` if on PATH). `splates --help` explains the commands; this file covers
only what the CLI cannot tell you. A bare `splates` prints help; start the
server with `splates server`. `splates dev` is only for developing the splates
repository itself (its eval and ship commands).

**A `#rec:<name>` in a message** names a recorded session. Before anything else
(before searching the repository for it), run `rec sessions path <name>`, which
prints the session's folder, then read the files in that folder, and quote what
its moments say (error text included) when you answer. Never open rec.

**A `#<project>.<name>` in a message** (`#mdom.released`, picked from `#` in
the composer, which offers every signal on the server) names a signal. Take it
as the fact the user means you to act on or wait for, and see Waiting on an
outside condition below: when they ask you to wait for it, `splates signal
wait` on that exact name with a `--timeout` and a `--description` (a full sentence naming the fact and why it is awaited), adding
`--since` when the fact may have been fired already; when they say it
happened, `splates signal fire` it; when they ask about its state, the Signals page holds it, and a payload
is the state when it was fired, so re-check before acting on it. A name no
signal has yet is one nobody has fired or probed, which you may still wait on
or fire. Never turn it into a polling loop.

## Waiting for a server message

To pause until a task finishes or the local machine stays idle, end the final
agent reply with one directive on its own line:

- `[SPLATES WAIT task <slug>]` waits for a started task in this project to
  merge or be removed. An already finished task answers immediately; an
  unknown task answers that the wait stopped.
- `[SPLATES WAIT machine idle <duration>]` waits for a continuous period
  below the existing machine Busy thresholds. Durations are positive whole
  numbers followed by `ms`, `s`, `m` or `h`, for example `2m`.

The server replies with `[SPLATES WAIT COMPLETE]` and what happened, resuming
this conversation. A task removal is reported as removal, not success: check
what it left before continuing. This notification grants no permission to run
an expensive command or ship. Existing permission rules still apply.

These are one-time message requests, independent of signals and subscriptions.
Only the last agent message's final line registers a wait; a newer message
replaces it, and archived conversations are ignored. No page or harness tool
is required. The server checks every five seconds. Pending requests survive a
server restart through conversation history; machine idle time starts over
because the server cannot observe load while stopped. Use blockers for work
that must wait on another task before merging.

## Principles

The rules below follow from these. When a case is not covered, reason from them.

1. **Get approval for work that is costly or hard to undo.** A wrong idea costs a few lines in a plan and a rewrite once built, so a large task needs approval even if it is easy to revert.
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
   run `splates add <task> --goal "<what done means>"` first (the project's name
   left out of the task name), then read and
   edit only in the worktree path it prints.
2. **Plan while it is cheap (principle 1).** When the user asks for a plan, or the
   change touches UI, spans several services or tables, or will take several
   commits, write a plan page (one HTML artifact) in place of the text plan:
   the reply is one line and the approval question with a `Plan: <name>.html` line
   (see [proposing.md](references/proposing.md), Plan page or text plan).
   Otherwise, after your first look, a task's first reply is
   a short plan (what changes, a picture when it needs one) ending in one
   questions card whose last question is `Do you approve <the change, named>?` with Yes
   and No, neither marked `(chosen)` so the user decides (short, at most one plain sentence under it, no bullets; the question itself names what is approved; see [proposing.md](references/proposing.md)), and code waits for the answer Yes unless the task is easy to
   reverse and takes little effort to execute. For those tasks, start and
   build without asking permission; say so in a line. Mockups are gold to the user, the quickest route to an
   approval and an answer, and cost the machine almost nothing: make them
   for any UI change or design question, hi-fi when that is trivial, polished
   lo-fi in between, plain lo-fi at the least. See
   [proposing.md](references/proposing.md).
3. **Ask as a numbered list.** Every question for the user is a `1.` item
   ending at its `?`, as in Formats below.
   **One questions card a reply.** Put every question in it, and end the turn
   when it holds the approval question, since that is the only question you
   wait on before writing code; for any other question carry on with your pick.
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
     in backticks, a `Reason:` line, under it that you ask because the machine
     is busy and what the command would add), end your turn, and run it only
     on `[SPLATES RUN ALLOWED]`. `Reason: busy` means the machine's load is
     the only reason you ask, nothing else about the command: the server may
     then allow it itself once the machine is idle, and says so in the
     `[SPLATES RUN ALLOWED]` it sends.
   - Any other reason (a cost that is not compute: tokens, a write outside the
     repository, a deploy; or a command that is irreversible, risky or
     invasive): ask with the same card, however the machine is, saying that
     reason, with `Reason: cost` or `Reason: risk`. When load is one reason
     among several, it is never `Reason: busy`; when unsure, `Reason: risk`.
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
   Before it, stop background commands you no longer need. A background
   process alone does not mark the conversation as working. When work must
   continue after a command or outside condition completes, stay in the turn
   and await its result, or register an explicit signal/task/machine wait.
   Say what you are waiting for and what you will do next before waiting.
   Use a signal probe and wait for a condition that can be checked. A preview
   server or watcher left available is not a continuation.
9. **Work you added to the board ends its reply with the queue card**, in any
   conversation, task or not: once, last, naming every task you added
   (`splates queue add <ids>`), after any report and never in place of one's
   absence. A reply that created tasks or lanes and ends without it is
   unfinished, whatever its title (see
   [queue.md](references/queue.md), Asking the user to queue).

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

**Choices that differ in how they look carry their image.** For mockup
variants, or any choice the user would pick by seeing it, capture each one,
`splates attach` it, and indent its `![what](/abs/path.png)` under its own
choice, one image each, so the card shows every variant. A choice described
only in words is unfinished; build the mock and capture it. This holds in
every round (lo-fi, hi-fi, a design gate of a queued task, a talk with no
task):

```markdown
1. Which style should the action list take?
   - (a) A rail beside the thread (chosen)
     ![rail](/abs/path/rail.png)
   - (b) A bordered panel
     ![panel](/abs/path/panel.png)
```

When more than one choice can apply (which of several items to do, fix or
queue), write the choices as `- [a]` lines, each you would tick marked
`(chosen)`; `- (a)` lines are for alternatives that exclude each other, and a
pick-one card for non-exclusive items leaves the user unable to answer.

A plain yes or no is asked the same way, as `- (a) Yes` and `- (b) No` choices, never as prose and never as named options: "Should we remove it?" is `- (a) Yes, remove it` and `- (b) No, keep it`, not `- (a) Remove it` and `- (b) Keep it`. The user can always add words to the answer.

Never as `Should I keep the old endpoint? I'd lean yes.` (and keep "I" and "you" out of
questions and choices: say "we" or name the subject), a bold line, or
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

When a task that took a queued board task waits on another task to merge,
`splates blocker add <#id | "subject">` links the blocker and keeps the
conversation open: carry on with what does not need it. `splates merge`
refuses while any blocker is open, and `[SPLATES BLOCKERS CLEARED]` comes
when the last one ends. A subject makes a new Backlog task, so end the reply
with its queue card.

When the work is blocked and only set aside for later, remove it with
`--reason blocked`, which asks why it stopped and what it waits on (a task
in another project as `--blocked-by wren#404`), and report it
blocked, the blockers in short after the colon, not removed. Ask any
question the work waits on as a numbered question, never as a blocker.
No blocker, `--waiting-on` included, clears by itself unless it is a task that
merges, so a fact a script can check (a tag exists, a deploy finished, a release
is on npm) is no `--waiting-on`: attach a probe, `splates signal poll
<project>.<name> --interval 5m --timeout 7d --description "<the fact that holds, and why it is awaited>" -- <script>`,
and `splates signal wait` on it (Waiting on an outside condition below), as for
a staging tag a ship has yet to create. Keep `--waiting-on` for what no
script can check, such as a key only the user can get. When
the tasks it waits on can be queued, end the reply with their queue card,
the deferred task last, so the user queues them all in one press:

```markdown
## ⏸ Blocked <task>: waiting on #812 and #813

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

Reporting anything else (a health check, an audit, a survey, a comparison:
findings the user reads rather than answers) is a Report card, whatever
the subject: `## 📊 Report: <subject>`, a one-sentence headline, then only
the readouts that help. It is plain markdown, so it reads as it is outside the
page. [references/reporting.md](references/reporting.md), Reports, has the
readouts (`stats`, `chart`, `progress`, `steps`, `gallery`, `d2`, callouts, a status table, a
folded `### Details`) and their shapes; copy one from there. Any card's prose
body (Merged, Done and the rest, not Review or Questions) may use them too. A report asks
nothing; when it ends an automation's run, send it before the Done report.

Whenever the agent asks the user to carry out a sequence of manual actions,
use a Steps conversation card. This includes click-by-click instructions in
any app or console, fetching a key, and changing settings, even for a short
sequence. Never put these instructions only in prose or a bare numbered list.
Write the card in this exact format:
`## 📋 Steps: <what it gets done>`, a line on why if it helps, then one
numbered step a line, its detail and any command indented under it. Keep the
list flat: never nest steps or sub-steps (`a.`, `-` or `1.` under a step). Each
action is its own numbered step, so the user can check it off, keep their place
and see it change when you resend the card. Steps
end in no `?`; ask a question after the card, as its own numbered list. The
page lets the user keep their place in it and pop it out beside another
tab, so give every step in one card. A message from that pop-out opens with
`(From the steps pop-out, on step <n> of <m> of "<title>": <the step>)`:
answer about that step, briefly, and it shows in the pop-out. When a step is
wrong or missing, send the whole card again under the same title with it
fixed; the page swaps it in, marks the changed steps and keeps their place.
Keep every step in the resend, the ones the user has checked included, and
leave those word for word: a reworded or dropped step reads as changed, and
sends the user back over what they already did:

````markdown
## 📋 Steps: Rotate the Stripe webhook secret

The secret is rolled in Stripe's dashboard, which only you can reach.

1. Open Stripe → Developers → Webhooks.
2. Pick the `net-prod` endpoint and press **Roll secret**.
3. Store the new secret as a cred:
   ```
   splates creds set STRIPE_WEBHOOK_SECRET
   ```
````

Asking for a review is `## 🔍 Ready to merge <task> onto <base>`, with what
changed, any screenshots, a `Checks:` line and the last line `Reply "merge",
or say what to change.`. It holds no demo unless the user asked for one: a demo
starts servers and costs CPU and memory. Copy its whole shape from
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
the command alone on the first backticked line, then `Reason: busy` on a line
of its own (`Reason: cost` or `Reason: risk` for any other reason, never
`busy` when the command is also irreversible, costly or invasive), and under
it why you ask and what it adds. End your turn after it. The user's Allow sends
`[SPLATES RUN ALLOWED]`, and only then do you run it. The card is text: outside
the page the user can type that directive, or `[SPLATES RUN DENIED]`, or answer
in plain words, and it means the same.

```markdown
## 🔐 Permission: run command: build the web app

`bun run build`

Reason: busy

Asking because the machine is busy (CPU 93%); this adds about two minutes of load.
```

Run `splates evals agents` first: it prints the saved eval agents, and an
`Agents:` line copies those targets verbatim and names no other (with none
saved, leave the line out).

Evals cost the user tokens, so only they start them, approving every round.
Every run card waits for the user to review its agents, set its dollar budget
and press Run; each card is one round with its own budget. You never set the
budget. To ask for a run (in
a project whose `splates.config.ts` names `evals.list` and `evals.run`, as
splates's own does, its list naming the scenarios), end your reply with the
run card, the word after `run evals` naming the skill or suite: the
scenarios you picked, one `` - `id` `` item each, and optionally the
revision the change is judged against and how many times to run each cell
(`Repetitions: <n>`, to tell a change from noise)
and the saved agents to
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

Only the user ships, and a ship starts from the user, never from you: from
the Ships page. Being told to ship, even "ship it yourself" from a user
stepping away, is no leave to start one: run no target's ship command beyond
`plan` and `done`, and say the ship starts from the Ships page. A ship is what releases or
deploys a project (an npm release, a stack deploy); a merge is never a
release, and you never run what a ship would (`npm publish`, a deploy, a
target's `ship run`).
A project that cannot ship yet, or has no evals on the Evals page, has a setup
journey for each on the welcome page and in Setup (`splates setup ships`,
`splates setup evals`): see [setup.md](references/setup.md), Ships and evals.
Never run `npm login` or `npm publish`: only the user starts a publish, and a ship signs in to nothing.

A fix is out only once a release after it is: a fix committed after the
last release tag is unreleased, and `<command> done <step>` of a target's
release step (`publish`, `deploy`) prints `false` while the next release has
yet to happen. When the user asks whether a fix is out, or a release is due,
check what each target has already released: its plan, its
release step's `done`, and its newest release or deploy tag
(`git tag -l --sort=-creatordate`), asking `git merge-base --is-ancestor
<fix> <tag>` whether the fix is in it. The user may have shipped from the
Ships page since you last looked. A target that already carries the fix is
not due: say which release carries it, and check the change works there.
When a release is due (a fix on the base that users are waiting on), say
which targets are due, in what order (a target's dependency first), and what
each release carries; the user ships them from the Ships page.

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

A board task sent from a failed step on the Ships page is that step's fix: take it as any queued task, read the run with `splates ships show <run>` (with `--target` and `--step` for everything the step printed), fix what made the step fail, and land with `splates merge`; the ship retries the step by itself once the fix task ends, merged or removed, so press nothing and change no code for it, and start no ship. To try the step before merging, `splates ships retry <run> --target <target> --step <step>` from your worktree runs it again in the run's own checkout, which stays on the commit the ship started on plus any fix that merged for it, so it shows whether the failure was passing, not whether your unmerged fix works. Any agent may carry a ship the user started on that way, retrying a failed step, and leave what it found or changed with `splates ships note <run> "<text>" [--target <target> --step <step>] [--link <task or URL>]`; none may start a ship, answer its prompts or stop it.

## Waiting on an outside condition

Do not poll in a background loop for a fact outside your own process: a
site, a cloud deploy, another agent's work. Fire and wait on a named signal,
`<project>.<name>`, which shows the user a card in the conversation and on
the Signals page, where a hidden loop shows nothing. Your own long command (a
build or test run in the background) stays a background command: your harness
wakes you when it exits, so nothing polls.

- `splates signal fire mdom.released --data '{"version":"2.4.0"}'` announces
  it, with no approval. Every conversation waiting on the name at that moment
  wakes with the payload; nothing is stored as current truth, so fire it
  when the fact holds.
- `splates signal wait mdom.released --timeout 5h --description "mdom 2.4.0 is published on npm, so vexml can adopt it."`
  puts one card in the conversation, then end your turn. `--description` is
  required: one or two plain sentences a stranger understands, naming the fact
  that holds when it fires and why it is awaited (never a label like "stack up";
  under 5 words is refused), which the card shows in every state. `--timeout` is required too (7d at most, or 1 year for clock calls). `--since 5h` (or an
  ISO time) also accepts a firing from after then, for a fact fired before
  you began to wait; further back than 7 days is refused. After a push two
  hours ago, `--since 2h` catches a firing that came before the wait.
- The conversation wakes with `[SPLATES SIGNAL <name>]` and the payload when
  it is fired, or the same directive ending in `timeout` or `stopped` (the
  person pressed Stop waiting). On `timeout`, decide what to do without the
  fact, or ask the user.
- For a fact only a check can see (a stack finishing, a page changing),
  attach a probe before waiting, with no approval:
  `splates signal poll aws.stack-ready --interval 5m --timeout 6h --description "The aws stack is up, so the deploy can verify it." -- <script>`.
  The server runs the script in the project's main tree, once at once when a
  wait begins and then every `--every` (30s at the most often), and fires
  the signal with its stdout when it exits 0 after failing. Exit 1 for not
  yet: any other failing exit shows the check as broken on the card. It stops once
  nothing waits on it, at its timeout, or when the user stops it; probing the
  name again replaces it. Then `splates signal wait` on the name as above.
- A payload is the state when it was fired, not now: re-check before
  anything hard to undo (a purchase, a cutover, a deploy).
- A signal may be a call, a signal function called with JSON5 arguments:
  `clock.in("2 days")`, `aws.stack-ready({ stack: "x" })`. A plain value
  maps to the signal function's main field; two spellings of one call are one
  signal. A project declares its signal functions under `signals:` in
  `splates.config.ts`, and a wait on a signal nothing can fire (no standard
  or declared signal function, no probe, no firing in 7 days) is refused.
- Clock signal functions fire automatically while subscribed: `clock.in("2 days")`,
  `clock.at("next monday 9am")`, `clock.interval({ interval: "2 days", at: "9am", tz: "America/New_York" })`,
  and `clock.cron({ expr: "0 9 * * 1", tz: "UTC" })`. The machine time zone is
  the default, resolved on the card. Durations and local times are parsed or
  refused; use `signal wait` with a timeout long enough to reach the firing.
  Recurring clocks catch up once after downtime.
- When work cannot start until an outside fact holds, do not start it and
  wait: make the fact a task that closes on its signal and block on it.
  `splates blocker add --closes-on mdom.released "mdom 2.4.0 on npm"` (from
  the task's worktree) adds a task nobody works and the queue never starts,
  blocks this task on it, and ends it as merged when the signal is fired,
  clearing the blocker as any merged blocker does. `splates task add
  --closes-on <signal>` and `splates task update <n> --closes-on <signal>`
  (or `none`) do the same on the board. Only firings after the task was
  attached count; `--since 2h` also takes an earlier one. The board keeps a
  probe on that signal running while the task is open, which a probe timeout,
  a broken check or the signal expiring never closes: remove the task to give
  up.
- Between agents, one fires and another waits on the same name: the task
  that releases runs `splates signal fire mdom.released --data ...`, and a
  task needing it runs `splates signal wait mdom.released ...`.

## Seeing a bug in a browser

When watching the bug happen in a browser would settle what to change (a
visual or interaction fault you cannot reproduce from code alone), offer a
rec session, a narrated recording the user makes. Offer it only when `rec`
is on the PATH (`command -v rec`), and ask with a run-command card, whether or
not the machine is busy, naming the exact command with a name and the URL to
open: `rec --name <name> --url <url>`, adding `--docker` or `--tail` when the
app's container or log file should be followed. End your turn after the card
and never run `rec` without `[SPLATES RUN ALLOWED]`; this is a rule you
keep, not a lock. On `[SPLATES RUN DENIED]`, carry
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
unless your last reply is already a Merged, Removed or Blocked report. Read
the file when one arrives.

| Directive                           | What it asks                                                                                                                                      | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[SPLATES TASK #N]`                 | Take queued task N                                                                                                                                | `splates task show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `splates add <slug> --task N`, under the `slug:` it prints when it has one, then, when `splates task show N` says `groomed: no`, groom it as [groom.md](references/groom.md) says under Grooming a task you start; then [queue.md](references/queue.md), Taking a queued task |
| `[SPLATES TALK #N]` | The user wrote on queued task N while it is blocked, to talk about it | `splates task show N` and read what it is blocked by, then talk with the user as they wrote: answer, plan, refine its words with `splates task update`. Never `splates add` it, take it, change code or merge: it is not yours, and `splates merge` refuses while a blocker is open anyway. End with the answer, or a questions card; a Done report when the talk is over |
| `[SPLATES TASK <task>]`             | Resume a task                                                                                                                                     | `splates claim <task>`, read its `SPLATES.md`, and carry on from where it stands                                                                                                                                                                                                                                                                                                                                                                               |
| `[SPLATES MERGE]`                   | The user approved your review, from the Ready to merge card                                                                                       | As for a reply of "merge": [merge.md](references/merge.md), Merge or review                                                                                                                                                                                                                                                                                                                                                                                    |
| `[SPLATES APPROVE]`                 | Legacy: an old proposal card was approved, with any answers after it                                                                         | Take it as Yes to the approval question: [proposing.md](references/proposing.md)                                                                                                                                                                                                                                                                                                                                                                                           |
| `[SPLATES GROOM #N]` | You are the project's groomer: organize ungroomed Backlog task N and place it in a lane, never doing it | [groom.md](references/groom.md) |
| `[SPLATES RUN ALLOWED]`             | The user, or the server for a `Reason: busy` card once the machine is idle, allowed the command your run-command card asked to run | Run that command now, as the card asked, then carry on |
| `[SPLATES RUN DENIED]`              | The user turned down the command your run-command card asked to run | Do not run it: carry on without it, or ask what to do instead |
| `[SPLATES EVAL LOOP <run>]` | Improve the eval scenario the Evals page run `<run>` did not pass, or, as `[SPLATES EVAL LOOP scenario <id>]`, a scenario that may have no run, or passes | Add a task, then read [evals.md](references/evals.md), Starting from a run or a scenario, and work the loop there |
| `[SPLATES RETRIED]`                 | The user granted your task another round of merge attempts, which the page has run `splates retry` for | Merge again, as [merge.md](references/merge.md) says under When a merge fails |
| `[SPLATES CHECKPOINT]`              | Bring `SPLATES.md` up to date and stop, as before a restart                                                                                       | [checkpoint.md](references/checkpoint.md)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `[SPLATES RESUME]`                  | Carry on from where `SPLATES.md` says you stopped                                                                                                 | [checkpoint.md](references/checkpoint.md)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `[SPLATES BLOCKERS CLEARED]`        | The last task your work was blocked on has ended, so `splates merge` is open again | Carry on: finish what the blocker held back, then merge as usual |
| `[SPLATES SIGNAL <name>]` | A signal you waited on was fired, with its payload, or ended with `timeout`, `stopped`, or `removed: <why>` when its source disappeared | Carry on with the work the wait was for; see Waiting on an outside condition |
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
- Before attaching screenshots or recordings, or creating or managing an
  artifact, and when the user asks for a demo or a server to try (never
  unasked):
  [references/demos.md](references/demos.md), demos, hosting and artifacts.
- After your first look at any task, when the user asks what you think, and
  and when they answer the approval question:
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
--project`: [references/projects.md](references/projects.md),
queuing work there and what a grant allows.
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
   them under `## Next` (see SPLATES.md below). Then send the plan with its
   approval question and end your turn; touch no code until it is answered Yes, unless the task
   is easy to reverse and takes little effort to execute: then start
   building without asking and say so in a line (see
   [proposing.md](references/proposing.md)). A queue-started task does the
   same, waiting on its question with no one present when it needs one.
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
   `## Next` as you commit it; splates never commits for you. A task prefers
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
   A task may span units when that is simpler than landing in steps, and
   its After names every unit it touches, so the reach is chosen and shown
   rather than crept into. Take extra care not to
   creep scope across packages when changing several at once: touch only
   what the After needs in each, and queue the rest. A snag on the way, such as a lost
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
refusal says: report it as Blocked); the Stats page counts them.

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
`![what](/abs/path.png)`) or a D2 diagram of the current flow, in a
```` ```d2 ```` fence (see Diagrams below). Leave it empty for a new thing.

## After

One or two sentences summarizing what will change, updated before merging
to summarize what happened. Under the sentence, show what was built:
the screenshot or recording of the result. Put supporting details in
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

## Diagrams

A D2 diagram renders only inside a fenced block whose info string is exactly
`d2`: three backticks, `d2`, the source, three closing backticks. An untagged
fence, or one tagged `text`, `plaintext`, `d2lang` or `D2`, shows as plain
code and never draws. Never write D2 source bare, in an untagged block, or
as an attached file in its place. Check the opening line of every diagram
before sending a reply or saving `SPLATES.md`.

````markdown
```d2
client -> server: upload
```
````

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

`splates merge --message "<message>"` squashes the task to one commit before
it lands: describe the net change, what the base gains, not the path you
took.


## Optional signal expiration

Set automatic removal with `splates signal expire <name> --after 2h` or
`--at 2026-12-01T17:00:00-05:00` (date-only means midnight UTC).
`--clear` cancels expiration. `splates signal expire <name> --on-fire` makes a one-off
signal: it is removed as soon as it fires, once its automations have run. Omitted expiration leaves a signal unchanged.
The Signals page also edits the deadline. Expiration removes the whole signal,
ends waiting conversations as removed, stops its probe, and pauses automations
on it. It is independent of wait/probe timeouts and firing retention. Deadlines
survive restarts; overdue signals are removed on startup. Raising the name again
creates new activity without reviving its old deadline or paused automations.

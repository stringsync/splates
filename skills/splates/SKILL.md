---
name: splates
description: Use the splates CLI to land work on trunk from an isolated git worktree without pull requests. Read it before investigating a possible code change, before running tests or anything heavy, and before any command that deletes or overwrites data or spends money (even when asked to), before asking the user a question, before answering when they ask what you think of a change or idea (use the plan card for proposals), and before waiting on, polling for or scheduling a later check of anything that finishes outside the conversation (a deploy, a release, another agent's work, a time, spare quota), in a splates repository, and first whenever a message holds a `[SPLATES ...]` directive, a `#rec:<name>` reference to a recorded session, or a `#<project>.<name>` reference to a signal. It also covers adding, claiming, merging, removing, listing, deferring and queueing tasks and lanes.
version: 2.1.0
---

# Using splates

`splates` gives each agent a git worktree and lands changes on trunk without
pull requests. Use `bunx @stringsync/splates` (or `splates` on PATH).
`splates --help` lists flags, `splates server` runs the web UI, and `splates dev`
is for developing splates itself.

Land with `splates merge`. Use git only to commit or finish an in-progress
rebase (`git add`, `git rebase --continue`), then retry the merge. On failure,
`splates` prints `{reason}` JSON to stdout. Follow its guidance on stderr.

If a user message contains `#rec:<name>`, run `rec sessions path <name>`
before anything else and follow the `rec` skill, which also covers offering a
recording. If it contains `#<project>.<name>`, read
[references/signals.md](references/signals.md).

## Before running a risky command

Weigh its effects, scripts it calls included. For deletion, destructive
overwrites, other hard-to-undo changes, or non-compute costs, end with a
run-command card ([references/reporting.md](references/reporting.md);
`Reason: risk` or `Reason: cost`), even when asked to run it, and run it
only after `[SPLATES RUN ALLOWED]` or plain-text approval.

## Before waiting on anything

Never poll in a loop, sleep, schedule your own wakeup or ask the user to say
when something happens: use a signal for the fact itself
([references/signals.md](references/signals.md)). For a short wait (minutes),
`splates signal wait` on it and report here when it fires. For a long or
unsure one, put the work back on the board: a task with `splates task add
--closes-on <signal>`, your task deferred behind it (`splates remove <task>
--reason blocked --blocked-by <n>`), and the `## ⏸ Blocked` card.

## Workflow

These rules hold in every conversation in a splates repository, whether a task
is open or not (a task adds only its `SPLATES.md` record). Leave spending,
release, and queue-control decisions to the user: only the user starts ships
([references/ships.md](references/ships.md)) or runs `splates queue pause` /
`resume`.

**To create board work**, read `references/queue.md` and follow its Board
workflow.
The agent that starts each task handles its implementation plan.

1. **Decide whether the request needs a task.** With no task open and a
   request naming a behavior you can check directly, check it first (a
   targeted search, then its code or the behavior) unless repository
   instructions require a task first; if it is already satisfied, finish with
   a Done card, otherwise start a task before looking further. A question
   that only needs an answer stays in the main tree.

   A task is one medium-sized change (one layer or one coherent fix). If a
   request names several distinct deliverables (say logic, an endpoint and a
   UI control, or a list of separate fixes), read
   [references/queue.md](references/queue.md) **before** `splates add` or
   reading code: create and queue a lane of at most 5 tasks yourself when
   you may, or else propose it in a Plan card first. Otherwise run
   `splates add <task> --goal "<what done means>"` (no project name in
   `<task>`) before investigating, and read and edit only in the worktree it
   prints; the page shows it, so do not announce it. A task started
   directly stays in Backlog unless a lane obviously fits: then start it
   there with `--lane <n>`. Groom ungroomed
   tasks you take or queue. `splates claim <task>` resumes one;
   pass `--base <branch>` only when asked.

2. **Plan while it is cheap.** After your first look, fill in `## Before`
   and `## After` in `SPLATES.md` (plus `## Next` for several commits). A new
   feature, behavior change, data deletion or API/design choice gets a Plan
   card ([references/proposing.md](references/proposing.md); never your
   harness's plan mode), even for a one-line diff:
   - **Below ask-and-go** (under 70, or paused): the plan asks to build.
     Post one per design and end your turn; its approval covers the edits
     through the merge, and `splates merge` refuses with `unapproved` until
     the user approves your latest plan.
   - **Ask-and-go or above:** post it, then build on your picks, unless a
     question always asks.
   - **Exception:** at ask-and-go or above, a trivial, unambiguous change
     with no design or API choice (a typo, a localized bug fix, a
     compiler-checked rename) skips the plan: fill in `SPLATES.md`, say so in
     one line (`Small and easy to revert: building directly.`), and build.
     A change to a schema or to how records are interpreted, kept or removed
     is never trivial.
   - **Visuals:** for any UI change or visual choice, build mockups eagerly
     and attach them, mobile first, good at phone and desktop widths
     ([references/showing.md](references/showing.md)).

3. **Make small, reversible commits.** Check `splates list --files` for
   overlap: groomed tasks work alongside and resolve conflicts on rebase
   (ask only if goals oppose); an ungroomed one links `--blocked-by` and
   removes itself ([references/queue.md](references/queue.md), Grooming). Commit each
   step with a plain message and **no attribution** (no `Co-authored-by:`,
   agent or model names, or `--author`), checking off `## Next` as you go.
   Make the scope call yourself ([references/queue.md](references/queue.md),
   Do, split or drop): fold in what is small and easy to revert; give
   anything that could grow, unrelated work, or another unit's change its
   own task (`splates task add`, then `splates queue add <id>` when
   allowed), with expand/contract tasks for a breaking contract change.
   Editing subagents share your worktree with distinct files, commit there,
   run no lifecycle `splates` commands, and return decisions for you to ask.

4. **Run scoped checks** (`bun test --changed`, specific test files,
   `bin/mono test --since main`, `bin/mono fix`); the merge gate runs the
   full check. Before heavy work (a full suite or build, Docker, a benchmark,
   a browser suite, or over a minute of CPU), run `splates machine`; if busy,
   ask with a run-command card (`Reason: busy`) and wait for
   `[SPLATES RUN ALLOWED]`. Installs, typechecks, lint, a few test files and
   commits need no check.

5. **Ask only what the answer would change.** Record cheap local choices
   (retry counts, timeouts, defaults) and their alternatives in `SPLATES.md`
   without asking. Put proposal questions only in the Plan card, and the rest
   in one question card (Core formats), never prose, bold lines, or the
   harness's question tool. The `trust:` line from `splates add` or `claim`
   (else your row in `splates trust`) sets how you ask:
   - **ask and wait** (below 70, or paused): ask, end your turn, and build on
     your pick only after the answer ([references/waiting.md](references/waiting.md)).
   - **ask and go** (70 to 89, or 90 and up with fewer than 10 decisions): ask
     and carry on with your pick meanwhile.
   - **assume** (90 and up): decide, writing one `🛡 Assumed: Retry limit: 3
     (vs 5 · defaults)` line per call ([references/questions.md](references/questions.md)).
   Shipping, spending, deletions, and security changes always ask. Trust is a
   ceiling: you may ask and wait on any risky call at no cost.

6. **Land or clean up.** Merge only while `After` is true and every `## Next`
   item and open question is resolved; keep working rather than landing part
   and queuing the rest (a follow-up is only for work outside the After).
   - **Merge** work you verified yourself, its result pictures under
     `## After` and evidence under `## Verification`: the usual end.
   - **Ask for a review** when the change is invasive (reworks something the
     user relies on, or much of the project) or hard to reverse (a migration,
     data written, anything sent outside the repo), when the plan was approved
     with **Approve & review** or carries the **One-way** tag, or when a
     `## Next` step asks to show the user. Keep an unchecked `- [ ] Show the
     user before merging` under `## Next`, send the Ready to merge card
     ([references/reporting.md](references/reporting.md)), and end your turn.
     On `[SPLATES MERGE]` or approval in words, `splates claim <task>`, check
     it off, and merge; on requested changes, `claim`, add them under
     `## Next`, do them, and send the card again. For trying the work,
     name a rig the user can start on the Rigs page, if one fits.
   Queue follow-ups first, then run `splates merge --message "<what the base
   gains>"` as a plain foreground command with a long timeout (never
   backgrounded, `&`, or `nohup`: the page sees a merge only through your
   running command) and `cd` to the main tree it prints. It removes the
   worktree, so chain nothing after it. When it refuses, read
   [references/merge.md](references/merge.md).
   Never leave a task behind: when there is nothing to change, or the work is
   moot, superseded, better redone, or blocked, `cd "$(splates path)"` and run
   `splates remove <task> --reason <nothing|moot|superseded|redo|blocked>`.

7. **Report and finish.** Answer status or usage questions plainly. End a
   task with its `Merged`, `Removed`, `Blocked`, or `Done` card (Core
   formats): one sentence of at most 25 words on what changed for the user,
   plus anything they must act on. Omit file names, symbols, internals,
   questions, and offers: queue each offer as a task first. If you could not
   auto-queue tasks or lanes you added, finish with their queue permission
   card ([references/queue.md](references/queue.md)). Before any final card,
   stop every background command nothing still needs, and name on the card
   any you leave running and why.

## Core formats

The `splates server` page turns only these exact Markdown shapes into cards.

### Questions

Every question (even a lone one) is a numbered list item starting at `1.` at the
margin, ending at `?`, with a one-line why indented under it and `- (a)`
choices (`(chosen)` on your pick). Use `- [a]` for multi-select (marking each
pick `(chosen)`). Yes/no questions use explicit `- (a) Yes, ...` and
`- (b) No, ...`. Keep "I" and "you" out of questions and choices. Visual
choices carry an attached image (`splates attach`) indented under each choice.

```markdown
1. Should the old upload endpoint stay for a release?
   It is still called by the mobile app's last version.
   - (a) Keep it for one release, logging each call (chosen)
   - (b) Remove it now
```

### Plan card

Use `## 📝 Plan: <title>`, with **Goal** (the aim, in one sentence),
**Details** bullets (each leading with its action in bold) and **Tags** (Undo, Size, Area and any Watch out, each
with a reason), plus a picture when needed. Put ordinary questions inside
the plan. See [Proposing](references/proposing.md) for the plan card format.

### Task outcome cards

The title is the emoji, the outcome, and the bare task name, then the base
for a merge, or after a colon what it waits on or why it went. A `##` or
`###` heading ends a card, so keep any inside it to `####`.

```markdown
## ✅ Merged <task> onto <base>

Cards on a phone now drag on a long press. Restart `splates server` to pick it up.
```

```markdown
## 🧹 Removed <task>: superseded by a fix on main

The task set out to stop uploads retrying a 413.
```

Blocked defers the task, as in Before waiting on anything, with `--why
"<what stops it>"` on the remove; end with the blockers' queue card when
they are on the board.

```markdown
## ⏸ Blocked <task>: waiting on #812 and #813

The task set out to stop uploads retrying a 413; it is back on the board.
```

Done ends work with no task to merge or remove (a question looked into, a
setup step, an automation's run), never a finding that leaves something to
do: that ends on the finding and a question. It carries no screenshot; send
one in an earlier reply.

```markdown
## ✅ Done: two merged tasks reviewed, nothing to fix

Both kept their tests; the notes needed no change.
```

### Ordinary reports, artifacts, screenshots, and diagrams

- **Ordinary reports:** Findings that are not a task outcome (health checks,
  audits, surveys) are plain Markdown: a headline sentence and what
  helps, with no card title. Tables, quotes and fences draw as plain markdown;
  only a `d2` fence draws as a diagram.
- **HTML artifacts:** When a reply would be easier to judge or explore
  interactively (options across scenarios, a system with moving parts, a
  diagram to inspect, a tool to try inputs), save a self-contained `.html`
  file with `splates artifact add <file>` unasked
  ([references/showing.md](references/showing.md#artifacts)) and point to it.
- **Screenshots:** A tool preview is invisible to the user. Run
  `splates attach <file>` (it needs no task: with none open it keeps the file with the conversation, and
  `--conversation <id>` names it when `$SPLATES_CONVERSATION` is unset) and paste the returned `![what](/abs/path.png)`
  outside a code block (never the raw capture path). For task results, also
  place the same image under `## After` in `SPLATES.md` before replying.
- **D2 diagrams:** Always use a fenced block tagged exactly `d2` (never
  untagged, `D2`, or `text`).
- **Other cards:** For `Ready to merge`, `Run command`, and
  `Queue` / `Remove lane` permission cards, read
  [references/reporting.md](references/reporting.md).

## SPLATES.md

`SPLATES.md` lets a fresh session `splates claim` and continue. It is excluded
from git (never mention it in commit messages). Questions live in the
conversation, not here.

```markdown
# <task>

## Before

Today in one line, plus an attached screenshot or `d2` diagram (empty for a new feature).

## After

One or two plain sentences on the outcome (no internals or file names), followed by the result screenshot.

## Next

- [ ] Roughly one commit per step (omit for a single-commit task)

## Checks

- [x] Each verified claim
- [ ] Anything unverified or failing, with why underneath
```

Put approved mocks (*Expected*) and evidence under `## Verification`, extra
context under `## Details`, and cheap local choices with their alternatives
in `SPLATES.md` (for example, `- retry limit 3 instead of 5`). Verify the
record with `splates show <task>`.

## Directives

Follow the matching reference below for setup, event and
schedule directives. End hook prompts with `Done` unless a task merged,
was removed, or was blocked.

| Directive | What to do |
| --- | --- |
| `[SPLATES TASK #N]` | Run `splates task show N`; if unclaimed, `splates add <slug> --task N`, groom if `groomed: no`, then follow [references/queue.md](references/queue.md). |
| `[SPLATES TALK #N]` | Run `splates task show N` and discuss or refine with `splates task update`; never add, claim, edit code, or merge. |
| `[SPLATES TASK <task>]` | Run `splates claim <task>`, read `SPLATES.md`, and continue from where it stands. |
| `[SPLATES MERGE]` | Record merge review approval, then land ([references/merge.md](references/merge.md)). |
| `[SPLATES APPROVE]` | Read as feedback on the plan. |
| `[SPLATES OVERTURN <n>]` | Switch the n-th Assumed call to its alternative, redo what rests on it, and ask that kind from then on. |
| `[SPLATES RUN ALLOWED]` | Run the command your run-command card asked for, then carry on. |
| `[SPLATES RUN DENIED]` | Skip that command; carry on without it or ask what to do instead. |
| `[SPLATES RETRIED]` | Merge again ([references/merge.md](references/merge.md), When a merge fails). |
| `[SPLATES CHECKPOINT]` | Your process is about to stop. Finish a running `splates merge`, start nothing new, note under the current `## Next` step what you were doing and what comes next, run `splates checkpoint` in a task (a `WIP: checkpoint` commit, pushed; squash it before merging), reply with one sentence on where you stand, and end your turn. |
| `[SPLATES RESUME]` | Read `SPLATES.md` again and go on from where the current `## Next` step says you stopped (with no task, from what you were asked). |
| `[SPLATES BLOCKERS CLEARED]` | Finish what the blocker held back, then merge as usual. |
| `[SPLATES SIGNAL <name>]` | Handle the fired, timed-out, stopped, or removed signal ([references/signals.md](references/signals.md)). |
| `[SPLATES EVAL CANCELLED <eval>]` | The user cancelled that running eval from its card: it ends with no report; do not rerun it unasked. Carry on without its result, or ask what to do instead. |
| `[SPLATES RECONNECT]` | Check `git status` / `git log` for half-finished work, then continue silently with no interruption report. |

## Reference files

Read each triggered reference in full from its named path. Defer linked
guides and later steps until needed. Read triggered references again in a
new session.

### Common triggers

- **After your first look at a change that needs a plan, or when asked what
  you think:** [references/proposing.md](references/proposing.md).
- **Before asking a question or after the reply:**
  [references/questions.md](references/questions.md) (when to ask, writing
  the card, reading answers).
- **Before a plan or question for a UI change, a visual choice, or a backend
  change across several services, before attaching screenshots or
  recordings, or when a reply compares options or explains moving parts:**
  [references/showing.md](references/showing.md).
- **When an answer arrives mid-turn, `claim` lists open questions, or you
  cannot go on without the user:** [references/waiting.md](references/waiting.md).
- **When `splates merge` refuses:** [references/merge.md](references/merge.md).
- **Before a Ready to merge or permission card:**
  [references/reporting.md](references/reporting.md).
- **Before queueing work, creating a lane or board, or changing queue order
  or blockers, before `splates task add`, or on `groomed: no`:**
  [references/queue.md](references/queue.md).

### Situational triggers

- **On `#<project>.<name>`, `[SPLATES SIGNAL ...]`, `[SPLATES WAIT ...]`, or
  before waiting on anything (another task landing, an idle machine, an
  outside fact, a timer):** [references/signals.md](references/signals.md).
- **On releases, deploys, ship-started tasks, failed ship steps, or "is this
  fix out?":** [references/ships.md](references/ships.md).
- **When writing an `eval` card or eval report in a conversation:**
  [references/questions.md](references/questions.md); the `evals` skill writes and runs them.
- **Before reading/editing `splates.config.ts` or explaining options:**
  [references/config.md](references/config.md).
- **On `[SPLATES SETUP <step>]` or setting up splates on a machine:**
  [references/setup.md](references/setup.md).
- **When work needs a value only the user can supply (a token, key, password
  or webhook URL), before writing code that reads it:**
  [references/creds.md](references/creds.md).
- **When using `splates --project`, touching another splates project, or
  moving, backing up or restoring splates state:**
  [references/config.md](references/config.md).

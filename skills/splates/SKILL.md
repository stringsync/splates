---
name: splates
description: Use the splates CLI to land work on trunk from an isolated git worktree without pull requests. Read it before investigating a possible code change, before running tests or anything heavy, and before any command that deletes or overwrites data or spends money (even when asked to), before asking the user a question, and before answering when they ask what you think of a change or idea (use the plan card for proposals), in a splates repository, and first whenever a message holds a `[SPLATES ...]` directive, a `#rec:<name>` reference to a recorded session, or a `#<project>.<name>` reference to a signal. It also covers adding, claiming, merging, removing, listing, deferring and queueing tasks and lanes.
version: 2.0.19
---

# Using splates

`splates` runs many agents on one repository, each in its own git worktree,
landing on trunk without pull requests. Run it with `bunx @stringsync/splates`
(or `splates` if on PATH); `splates --help` covers CLI flags, `splates server`
runs the web UI, and `splates dev` is only for developing splates itself.

Every landing goes through `splates merge`. Use git only to commit and to
finish a rebase left in progress (`git add`, `git rebase --continue`), then
merge again. When any `splates` command fails, it prints `{reason}` JSON on
stdout and what to do on stderr: follow stderr.

If a user message contains `#rec:<name>`, read [references/rec.md](references/rec.md)
before anything else. If it contains `#<project>.<name>`, read
[references/signals.md](references/signals.md).

## Workflow

These rules hold in every conversation in a splates repository, whether a task
is open or not (a task adds only its `SPLATES.md` record). Leave spending,
release, and queue-control decisions to the user: only the user starts ships
([references/ships.md](references/ships.md)), approves eval
budgets ([references/evals.md](references/evals.md)), or runs `splates queue pause` /
`resume`.

1. **Start before you look.** A task is one medium-sized change (one layer or
   one coherent fix). Only if a request names several distinct deliverables (for
   example, data/business logic, an endpoint, and a UI control, or a list of
   separate fixes), stop **before** `splates add` or reading code, read
   [references/queue.md](references/queue.md), and offer a lane first. Otherwise, when a request may end in a code change, run
   `splates add <task> --goal "<what done means>"` before reading any code
   (omit the project name from `<task>`), and read and edit only in the
   worktree path it prints. Place each new task you start on a fitting board
   and lane as [references/groom.md](references/groom.md) says. A question
   that only needs an answer stays in the main tree. Use `splates claim <task>`
   to resume an existing task. Pass `--base <branch>` only when explicitly
   asked. Once `splates add` succeeds,
   the page already shows it, so do not announce adding it.

2. **Plan and get approval while it is cheap.** After your first look at the
   code, fill in `## Before` and `## After` in `SPLATES.md` (plus `## Next` if
   the work spans several commits). Then read
   [references/proposing.md](references/proposing.md) and send a Plan card
   (never your harness's plan mode) ending in an unselected
   `Do you approve <the change>?` question, waiting for `Yes` before touching
   code. Any new feature, behavior change, data deletion, or API/design choice
   needs a Plan card and approval first, even when the diff is one line.
   - **Exception:** Only trivial, unambiguous changes with no design or API
     choice (a typo, a localized bug fix, a compiler-checked rename) skip the
     Plan card: still fill in `SPLATES.md`, tell the user in one line before
     editing that you are skipping the plan (e.g., `Small and easy to revert:
     building directly.`), and build. Skipping the plan never skips step 1:
     run `splates add` before opening even the one file the fix is in. A
     change to a schema or to what stored data means (a new column, a
     migration, how records are kept or removed) is never trivial, however
     few lines it takes.
   - **Visuals:** For any UI change or visual choice, build mockups eagerly and
     attach them, mobile first for web apps and good at phone and desktop widths ([references/visuals.md](references/visuals.md)).
   - Queue-started tasks follow the same rule: pause on the approval question
     when the work is substantial.

3. **Work in small, reversible commits.** Check `splates list --files` for
   overlap; for an already-groomed task, work alongside other tasks and
   resolve conflicts on rebase (asking only if another task does the opposite
   of your goal). An ungroomed task (`groomed: no`) that overlaps an open or
   active task instead links `--blocked-by` and removes itself per
   [references/groom.md](references/groom.md). Commit each step as
   you go with plain, human-style messages and **no attribution** (no
   `Co-authored-by:`, no agent or model names, no `--author`), checking off
   `## Next` items and keeping `SPLATES.md` current so any session can resume.
   Keep each task to one goal and one repository unit: do what `After` needs
   and small fixes in code you already change; queue (`splates task add` or
   `defer`) unrelated, cross-unit, or approval-needing work
   ([references/queue.md](references/queue.md)); drop what you would not bother
   doing. Adding or deferring a task means queueing it too, with
   `splates queue add <id>` in the same turn. When breaking another unit's contract, migrate through
   expand/contract as separate queued tasks. Any subagent that edits code works
   in your worktree with no task of its own, commits there, runs no lifecycle
   `splates` commands, gives each concurrent subagent its own files, and
   returns any user decisions for you to ask.

4. **Go easy on the host machine.** Test scoped changes (`bun test --changed`,
   specific test files, `bin/mono test --since main`, `bin/mono fix`); the
   merge gate runs the full check. Before anything heavy (whole test suite,
   full build, docker, benchmark, browser suite, or >1 minute of CPU), run
   `splates machine`: if not busy, run it; if busy, ask with a run-command
   permission card (`Reason: busy`, see
   [references/reporting.md](references/reporting.md)) and wait for
   `[SPLATES RUN ALLOWED]`. Commands with non-compute cost or risk always ask
   with `Reason: cost` or `Reason: risk`, regardless of load. Light commands
   (install, typecheck, lint, a few test files, commit) need no check.

5. **Ask only what the answer would change.** Make every other call yourself;
   for a cheap local pick (a retry count, timeout, or default between plausible
   values), never ask: note the pick and its alternative in `SPLATES.md`.
   Before asking the user any question, read
   [references/questions.md](references/questions.md). Put proposal approval and
   its questions in a Plan card (`## 📝 Plan: <title>`), never in a standalone
   questions card and never as a Plan card plus a separate questions card in one
   reply. For standalone questions, carry on with your picks whenever you
   can. Never ask via prose, a bold line, or your harness's own question tool.

6. **Land or clean up.** Merge only when `After` is true and every open
   question and `## Next` item is resolved; never land unmet work and queue the
   rest. Before `splates merge` or asking for a review, read
   [references/merge.md](references/merge.md). Queue any follow-ups before
   merging, then run `splates merge --message "<what the base gains>"` in the
   foreground (never in the background) and `cd` to the main tree it prints.
   The merge removes the worktree, so chain nothing after `splates merge` in
   the same command: run the next command from the main tree.
   Right after merging a change to a skill, agent guide, prompt, or other
   AI-facing behavior in any project (unless the task itself only changed
   evals), add and queue a specific follow-up task to author an eval for it
   ([references/queue.md](references/queue.md)).
   Never leave a task behind: when there is nothing to change, or the work is
   moot, superseded, better redone, or blocked, `cd "$(splates path)"` and run
   `splates remove <task> --reason <nothing|moot|superseded|redo|blocked>`.

7. **Report and finish.** Before replying with a task outcome, read
   [references/reporting.md](references/reporting.md). End with the outcome
   card (`Merged`, `Removed`, `Blocked`, or `Done`) and a single short sentence
   (at most 25 words) on what changed for the user in plain words (no file
   names, symbols, or internals), with nothing asked or offered after it. If you created
   board tasks or lanes you could not queue yourself, end the reply with their
   queue permission card, saying why they were not auto-queued
   ([references/queue.md](references/queue.md)), after any report. Stop unneeded
   background processes before finishing; to wait on a task, idle machine, or
   external condition, use waits or signals
   ([references/signals.md](references/signals.md)).

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

Write the plan directly in Markdown, near 120 words and never over 200, with no
step list and no internals: `**Goal:**` (one sentence on what goes wrong or is
missing today and why it hurts, never the aim or today's behavior alone,
which only restate After), `**After:**` (one sentence on what the user will meet),
`**Approach:**` (at most two sentences on the how), `**Hard to undo:**` (only
when something is), plus a picture when needed. End with its questions, the
last being `Do you approve <specific change>?` with unselected `Yes` and `No`
choices (neither marked `(chosen)`), and end your turn.

```markdown
## 📝 Plan: retry failed upload scans

**Goal:** A scan that fails once leaves an upload stuck, and support cannot see why.
**After:** Failed scans retry three times, then land in a failures table support can read.
**Approach:** The worker retries with backoff and sends a scan that still fails to a dead-letter queue, which writes the failures table.
**Hard to undo:** a migration adds the failures table.

1. Do you approve retrying failed upload scans with a dead-letter queue?
   - (a) Yes, approve it
   - (b) No
```

### Merged report

```markdown
## ✅ Merged <task> onto <base>

Cards on a phone now drag on a long press. Restart `splates server` to pick it up.
```

### Ordinary reports, screenshots, and diagrams

- **Ordinary reports:** Findings that are not a task outcome (health checks,
  audits, surveys, comparisons) are plain Markdown: a headline sentence and what
  helps, with no card title. Tables, quotes and fences draw as plain markdown;
  only a `d2` fence draws as a diagram.
- **Screenshots:** A tool preview is invisible to the user. Run
  `splates attach <file>` (it needs no task: with none open it keeps the file with the conversation, and
  `--conversation <id>` names it when `$SPLATES_CONVERSATION` is unset) and paste the returned `![what](/abs/path.png)`
  outside a code block (never the raw capture path). For task results, also
  place the same image under `## After` in `SPLATES.md` before replying.
- **D2 diagrams:** Always use a fenced block tagged exactly `d2` (never
  untagged, `D2`, or `text`).
- **Other cards:** For `Steps`, `Blocked`, `Removed`, `Done`, `Ready to merge`,
  `Run command`, and `Queue` / `Remove lane` permission cards, read
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

Put approved mocks (*Expected*) and evidence under `## Verification`, and extra
context under `## Details`. When you make a cheap local choice without asking
(retry count, timeout, default), record both the pick and its alternative in
`SPLATES.md` (for example `- retry limit 3; 5 is the alternative`). Run
`splates show <task>` after editing to verify its shape.

## Directives

Rare directives (`[SPLATES SETUP <step>]`,
`[SPLATES DEMO <task> <point>]`,
`[SPLATES EVALS DONE <batch>]`, `[SPLATES EVENT ...]`, `[SPLATES SCHEDULE <n>]`)
follow their matching reference file below; hook prompts end with a `Done`
report unless a task merged, was removed, or was blocked.

| Directive | What to do |
| --- | --- |
| `[SPLATES TASK #N]` | Run `splates task show N`; if unclaimed, `splates add <slug> --task N`, groom if `groomed: no` ([references/groom.md](references/groom.md)), then follow [references/queue.md](references/queue.md). |
| `[SPLATES TALK #N]` | Run `splates task show N` and discuss or refine with `splates task update`; never add, claim, edit code, or merge. |
| `[SPLATES TASK <task>]` | Run `splates claim <task>`, read `SPLATES.md`, and continue from where it stands. |
| `[SPLATES MERGE]` | Land as approved ([references/merge.md](references/merge.md)). |
| `[SPLATES APPROVE]` | Treat as `Yes` on the approval question ([references/proposing.md](references/proposing.md)). |
| `[SPLATES RUN ALLOWED]` | Run the command your run-command card asked for, then carry on. |
| `[SPLATES RUN DENIED]` | Skip that command; carry on without it or ask what to do instead. |
| `[SPLATES EVAL LOOP <run>]` | Start a task and run the eval loop ([references/evals.md](references/evals.md)). |
| `[SPLATES RETRIED]` | Merge again ([references/merge.md](references/merge.md), When a merge fails). |
| `[SPLATES CHECKPOINT]` | Update `SPLATES.md` and stop ([references/checkpoint.md](references/checkpoint.md)). |
| `[SPLATES RESUME]` | Continue from where `SPLATES.md` stopped ([references/checkpoint.md](references/checkpoint.md)). |
| `[SPLATES BLOCKERS CLEARED]` | Finish what the blocker held back, then merge as usual. |
| `[SPLATES SIGNAL <name>]` | Handle the fired, timed-out, stopped, or removed signal ([references/signals.md](references/signals.md)). |
| `[SPLATES RECONNECT]` | Check `git status` / `git log` for half-finished work, then continue silently with no interruption report. |

## Reference files

Read each reference file **in full only when its trigger comes** (and re-read
it in a new session).

### Common triggers

- **After your first look at a task, when asked what you think, or on approval
  replies:** [references/proposing.md](references/proposing.md) (plan cards,
  and the approval question).
- **Before asking the user any question or after their reply:**
  [references/questions.md](references/questions.md) (when to ask, the
  question card, and reading answers).
- **Before a plan or question for a UI change, a visual choice, or a backend
  change across several services:** [references/visuals.md](references/visuals.md)
  (D2 diagrams, mockup variants, capturing, and attaching images).
- **When an answer arrives mid-turn, `claim` lists open questions, or you cannot
  go on without the user (for a Plan card, `proposing.md` covers ending the
  turn):** [references/waiting.md](references/waiting.md).
- **Before `splates merge`, on any merge failure, or before asking for a
  review:** [references/merge.md](references/merge.md) (merging, reviews,
  rebases, and retries).
- **Before replying with a task outcome, `Steps` card, run-command card, or
  ordinary report:** [references/reporting.md](references/reporting.md) (`Merged`,
  `Removed`, `Blocked`, `Done`, `Ready to merge`, `Steps`, permission cards,
  and ordinary reports).
- **Before `splates task add`, `defer`, `lane add`, `board`, queue cards, or
  `--lane`/`--position`/`--blocked-by`:** [references/queue.md](references/queue.md)
  (queueing, deferring, lanes, boards, and cross-unit migrations).
- **Before `splates task add`, when `task show` says `groomed: no`, or when an
  automation tells you to groom a task just added:** [references/groom.md](references/groom.md).
- **Before attaching screenshots/recordings, creating artifacts, or when asked
  for a demo:** [references/demos.md](references/demos.md).

### Situational triggers

- **On `#<project>.<name>`, `[SPLATES SIGNAL ...]`, `[SPLATES WAIT ...]`, or
  before waiting on anything (another task landing, an idle machine, an
  outside fact, a timer):** [references/signals.md](references/signals.md).
- **On releases, deploys, ship-started tasks, failed ship steps, or "is this
  fix out?":** [references/ships.md](references/ships.md).
- **When proposing or approving evals, on eval run cards, `[SPLATES EVAL LOOP ...]`,
  `[SPLATES EVALS DONE ...]`, `[SPLATES EVAL BUDGET ...]`, before asking for an
  eval budget, or on eval remarks/graders:** [references/evals.md](references/evals.md).
- **On `#rec:<name>` or offering a browser bug recording:** [references/rec.md](references/rec.md).
- **Before reading/editing `splates.config.ts` or explaining options:**
  [references/config.md](references/config.md).
- **On `[SPLATES SETUP <step>]` or setting up splates on a machine:**
  [references/setup.md](references/setup.md).
- **When work needs a value only the user can supply (a token, key, password
  or webhook URL), before writing code that reads it:**
  [references/creds.md](references/creds.md).
- **When using `splates --project` or touching another splates project:**
  [references/projects.md](references/projects.md).
- **When `splates artifact add` hits `too_large` or on artifact space:**
  [references/artifacts.md](references/artifacts.md).
- **When moving, backing up, or restoring splates state:**
  [references/transfer.md](references/transfer.md).

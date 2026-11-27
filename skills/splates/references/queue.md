# Queueing tasks

Writing, grooming, placing, linking and queueing tasks and lanes, and taking a
queued one. Position and lane order are the user's.

## Board workflow

1. Collect `splates board list`, `splates lane list`, `splates task list`
   and `splates list --files` in one shell invocation, to place the work,
   find duplicates and link blockers.
2. When the request already gives a goal, enough context to start and a
   check for done, go straight to the board; read source only to supply one
   of those or resolve a blocker. Create the lane when needed and add the
   tasks as Writing a task says, grouping adds whose lane and blocker IDs
   are known in one shell invocation and using the IDs the commands print.
3. Queue what the criteria below allow, trying the command once; a
   successful `splates lane queue` is confirmation, said with a `## 🤖
   Queued lane <n>: <name>` heading and a `Why:` line. Otherwise end with
   the queue card, quoting a refusal from the output, or the criterion's
   number and reason (for an opening Design task, `4, the user's decision`,
   naming it). Keep the CLI's numeric limits as digits.

Use the documented syntax; look up a flag only when the guide leaves it
unclear or the CLI rejects it. Read a listing again only when something
changed or its last output was unclear.

## Do, split or drop

When you notice something beyond what the task's After says, the scope call
is yours. Choose one, without asking:

- **Do it in the task** when the After needs it, or when it is small, touches
  little code and is easy to revert, such as a fix in code the task already
  changes or a missing piece of the same behavior.
- **Give it its own task** when it could grow (an unsettled design, a
  non-trivial UI change), is in another unit (project), needs its own
  approval, or is unrelated to the goal.
- **Split it into a lane** when it is several separate things.
- **Drop it** when you would not bother doing it yourself. Do not queue or
  offer it.

A task is one medium-sized change: one coherent thing you can state in a
sentence, that an agent can finish without carrying decisions from an earlier
step. Judge from the request itself, before reading code, whether it is
several of those (a feature in steps, a list of fixes): then it is a lane. One
change with a follow-up or two stays a task and its follow-ups, and you do the
change itself when the user asked for it.

## Writing a task

Whoever writes a task grooms it as they add it (Grooming, below): check that
no task already asks it, link what blocks it, and pass `--lane <n>`, or leave
it in Backlog when nothing fits. Leave its position and model off unless the
user names them: a task with no model goes to Auto pick, which starts it on
the agent, model and thinking level the user's rules give.

Give it a `--slug`, a few lowercase words with dashes for what it changes
(`upload-413`), never the subject cut short: its branch, worktree and
conversation carry it. Leave the project's name out of subject and slug.

Keep the subject short enough to scan. The detail is markdown: its first
paragraph is the goal, one or two sentences with no lists on what is true
when it is done, which seeds `## After`. The rest is free-form details for
the next agent: the why, files, constraints, calls already made, open
questions, `- [ ]` steps. Leave `## Before` and `## After` to the agent that
takes it. Single quotes keep the shell off backticks:

```sh
splates task add "Upload retries forever on a 413" --slug upload-413 'An upload stops retrying on a 413 and tells the user the file is too big.

The client retries on any 4xx in `src/upload.ts`, so a 413 loops forever.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big'
```

Whoever takes it has none of your conversation, so `task add` refuses an
empty detail. Read it as that stranger would, and check it says, where you
know it:

- **What is wrong today and where to see it**: the file, fixture, page,
  command or measure that shows it.
- **What done looks like and how to check it**: the test, render or command
  that proves it.
- **Calls already made**: what the user chose and where, so the agent does
  not ask again or pick differently.
- **The edges**: what is out of scope, and related tasks by number.

A detail that only restates the subject fails, however long. A good one:

```markdown
When two single-note voices cross at a second and both notes are dotted, show both dots in one column to the right of both noteheads, on separate staff spaces and clear of the stems.

The user chose the MuseScore treatment from the side-by-side render of measure 18 in `duration-dots.musicxml`; today only one dot reads clearly there. Record that choice in the engraving decisions ledger, and add a measured regression for measure 18 checking two dots in one column on separate rows. Keep it to the crossed-second pair: crossed thirds and chords have their own rules. Task #4086 also edits the duration-dot test and baseline.
```

The page shows each `task add` as a line that opens the task, so your reply
needs no summary of it; the task's own subject and detail stay full.
`splates task update <n> '<detail>'` replaces the whole detail: pass what
still holds and what you learned.

When the user asks you to queue a request rather than do it, work out what
it wants first: read what you need of the code, and ask each call their
answer would change ([questions.md](questions.md)), ending your turn on
them. Then add it groomed, updating an open task that already asks it rather
than adding another.

## Grooming

A task is groomed once it sits in a lane: nothing else asks it, what blocks
it is linked, and it is placed. Nothing else records it, so grooming can go
stale as the board or code changes. A task can start ungroomed.

**One that already asks it.** Scan `splates task list` (without `--open`) by
subject, and `splates task show` only the one or two that look the same;
reuse a list read recently.

- **Open, the same request**: add none; `task update` its detail with what
  you know and name it as the task you meant.
- **Taken by another task**: add none; note in `SPLATES.md` what you would
  have added.
- **Only near it**: add yours, linked `--blocked-by` it when it needs its
  code.

**A task you start that is `groomed: no`** (ungroomed in Backlog, as `splates
task show N` says) is groomed once, by you, before any work:

1. When an open task asks the same, fold what yours adds into its detail and
   `splates remove` yours. When one asks the opposite, or yours would undo
   merged work or go against a call the code made (`git log` on its files),
   ask the user which stands before building.
2. When it needs another task's code or data, or changes a file another open
   or active task changes (`splates list --files`), `splates task update N
   --blocked-by <id>`, place it, and `splates remove <task> --reason blocked
   --blocked-by <id> --why "<short reason>"` without editing code: it goes
   back on the board untaken and starts once the blocker lands.
3. Ask what the user's answer would change, including any question its
   detail holds under `#### Questions from grooming` or `#### Open
   questions`; make every other call yourself.
4. Place it with `splates task update N --lane <n>` (or `--lane backlog`),
   which marks it groomed.

A task you start directly with `splates add` stays in Backlog unless a lane
obviously fits: then start it there with `splates add <task> --goal "..."
--lane <n>`, which puts it on the board in that lane. A task started without
`--lane` is off the board, where `splates task update` cannot reach it.

## Placing: lanes, boards, positions

A lane groups related tasks on the board. It orders nothing and has no
model: links say what lands first. Place a task:

- **An existing lane** when it builds on that lane's work: `--lane <n>`.
- **A new lane** when it starts a chain more tasks will follow, or shares a
  theme with another ungroomed Backlog task: `splates lane add '<name>'
  --board <n>`, named for what they add up to (or `--lane new`, then move
  it), then `--lane <n>` for each.
- **Backlog** (`--lane backlog`, lane `0`) otherwise. It is permanent: it
  can be queued and worked, never renamed or removed.

`splates task update <id> --lane <n>` moves a task. Agents may `splates lane
add` and `lane remove` empty lanes; removing one with tasks needs the user's
remove-lane card ([reporting.md](reporting.md)).

**Design first.** A lane the user will meet as a look or an interaction (a
page, a component, a flow) opens with a `Design: <what>` task whose goal is
the questions the mockup variants settle; every other task in it is
`--blocked-by` it. Skip it for a mechanical lane or a design already settled
(an approved mock, the user's own picture), saying where on the queue card.

**Boards** group lanes and change nothing else. Put every lane you add on the
board whose lanes share its theme (`splates board list`, `--board <n>`;
`splates lane update <n> --board <n>` moves one), or `splates board add
'<name>'` when none fits. `board update <n> --name/--position`, `board show
<n>`; `board remove <n>` only for an empty board (ask the user for one with
lanes). There is no `board queue`.

**Positions** and lane order are the user's: a new task goes to the bottom
unless they say otherwise. "Urgent" or "next" is `--position 1`; "soon" or
"right after this" goes just below the urgent ones (read `splates task
list`). To move a task or lane they name, `splates task update <id>
--position <n>` or `splates lane update <n> --position <p>`, then read the
list again to check the order.

## Links

When a task cannot start before another merges, link it: `splates task add
<subject> --blocked-by 12` or `splates task update 14 --blocked-by 12`
(several: repeat the flag or `--blocked-by 12,13`; undo with
`--remove-blocked-by 12`), never only in its detail. Link only for a real
order (it needs the other's code or data, or changes its files, even in the
same lane), never for priority. splates warns whoever takes it early and
drops the link when 12 merges; `task show 14` then names the commit. If 12 is
removed unmerged, the link drops with a note that its work is not on the
base: check 14 still makes sense.

Another project's task links with its slug: `--blocked-by wren#404`. It must
be open there; `splates --project wren task add` it first when there is none
([config.md](config.md#other-splates-projects)).

## Taking a queued task

- **Another model named.** Take it anyway, and say so in a line right after
  `splates add`, such as `#12 names Sonnet; I run as Opus.`
- **Blocked.** When `splates add --task` warns a blocker has yet to merge,
  `splates task wait <n>`, or, when the user asked for it now, do only what
  does not need the blocker and say so.
- **Deferred.** A `deferred:` line in `splates task show` means it was set
  aside: check each unticked blocker under it (an upstream release, a key)
  before any other work. One that still holds defers it again with `splates
  remove <task> --reason blocked`, its why saying what you checked.
- **Ungroomed.** Groom it first (Grooming).

Merging removes the queued task: `splates task add` any part left undone. A
task you defer with `--reason blocked` takes `--detail` for a stranger: why
it stopped, what you found, steps done and left, and what of the discarded
branch is worth redoing.

## Queueing

Only `splates queue add <id>` and `splates lane queue <n>` are yours, and
only when the project's Agents setting (Never, the default; Safe tasks only;
Any task) and the limits below allow; splates refuses agents `queue remove`,
`move`, `pause`, `resume` and `lane unqueue`. Do not read the setting: after
`task add`, run `splates queue add <id>`, once. On a refusal, end with the
queue card; never retry or work around it (`queue move`, a lane queue,
another agent).

**Ask first**, with the queue card, when any of these holds, whatever the
level (at Any task, unless the user's own words approved that very thing):

1. Hard to undo: migrations, deleting files, data or branches, rewriting git
   history, changing stored state, rotating secrets.
2. Reaches outside the repo: cloud resources, DNS, deploys, ships, npm,
   posting to GitHub, email or chat, paid APIs, purchases.
3. Expensive to run: full builds or suites, docker, benchmarks, profiling,
   model training or inference, long jobs, large downloads, caches or
   fixtures, token-heavy work (running many evals, workflows, large refactors).
4. The user's decision: product or UX, features not asked for, any UI change
   (it opens with a mockup gate), removing behavior, naming public things,
   adding or majorly upgrading a dependency, licensing.
5. Security and permissions: auth, credentials, grants, sending data off the
   machine, changing what agents may do.
6. Wide scope: crosses projects, a shared interface needing expand/contract,
   root files, many packages, more than about 5 commits.
7. Uncertain: a guessed diagnosis, speculative cleanup, depends on an
   unanswered question, conflicts with or duplicates an open task.
8. Over the chain budget, or past this conversation's cap.

Judge the work the task actually asks for: a requested endpoint or CLI flag
can be small and reversible.

**Prefer queueing on your own.** Queue it yourself, never carding it, when it
is a follow-up the user asked for or their approved work implies (a `bar` the
approved `foo` calls, not a neighbor nobody asked for), one goal in one
project, fully revertible, meets no criterion, and is:

- **Checkable**: a test or command confirms the goal, with no judgment call.
- **Precedented**: it copies a pattern in the code, with no new design or API
  choice.
- **Cheap to verify**: scoped tests, typecheck or lint suffice.
- **Independent**: overlaps no open task's files and needs no blocker.
- **Self-contained**: needs no credentials, decision or mockup gate.

Being evidence-backed (from a failure you saw) or costly to leave tips a
close call toward queueing. At Safe tasks only, queue nothing else; at Any
task, a task meeting no criterion goes in. Something merely noticed on the
way is not such a follow-up: drop it or card it. The criteria also bind work
in a task an agent queued: when it meets one, ask before doing it.

**A lane** queues all or none, each task counting against your cap. Queue
it yourself only when every task passes alone, they fit the cap left, it
opens with no Design task, and it is the user's request split up or work
their approved work implies; otherwise card the whole lane, naming the
failing task and criterion. A lane you may not queue yourself, or of more
than 5 tasks, is proposed first in a `## 📝 Plan: lane <name>` card listing
its tasks one line each under Details, ending your turn whatever your trust;
approval lets you create it (if you already started a task, remove it
`--reason superseded` once they are added). A task added to a lane already
queued is not queued with it: queue or card it.

**Say it**, one heading and a one-sentence `Why:` per task or lane you
queued; the page groups a reply's headings into one card:

```markdown
## 🤖 Queued #821: Fix the flaky merge-place test

Why: the merge gate failed on it twice while landing this; one test file.
```

**The cap** is at most the number the setting names (default 5) queued from
this conversation; `queue add` says when you reach it, and past it you card.

**The chain budget.** Tasks agents queued under one the user started or
queued share a token budget (default 5M, fresh input and output). When it
is spent, `queue add` refuses; queue and start nothing and ask:

```markdown
1. How much more may the agent-enqueue-setting chain spend?
   It spent 5.0M of 5M; #826 wants to queue #831 Split the fixture loader (about 0.6M).
   - (a) Add 2M
   - (b) Add 5M
   - (c) Add a custom amount
   - (d) Stop auto for this chain
```

Apply it with `splates queue budget --add 2M`, `--add 5M`, `--add <amount>`
or `--stop`; on (d) finish your own task and leave the rest to queue cards.

### Asking the user to queue

The queue card gives the command on its own line, then a `Why not
auto-queued:` line naming the real cause: splates' refusal (`the Agents
setting is Never`, `this conversation's cap of 5 is used`, `the chain is out
of budget`) or the criterion by number and words (`4, the user's decision:
it adds a page`), never `to be safe`. With no such cause, queue it yourself.
Then a line on what it adds up to, naming a Design task first.

```markdown
## 🔐 Permission: queue lane 7: Billing export

`splates lane queue 7`

Why not auto-queued: 4, the user's decision: it opens with the export page's design.

The design for the export page first, then the CSV writer, the endpoint and
the page's button.
```

```markdown
## 🔐 Permission: queue #31, #32: Upload fixes

`splates queue add 31 32`

Why not auto-queued: the Agents setting is Never.

Both stop retries the server already refused.
```

A reply ends with exactly one queue card, last, after any report (merge and
remove reports too), naming every task you added (`splates queue add
<ids>`), never one per lane. The choice reaches only the board: carry on
with work under way, and do none of the card's work here unless asked.

## Changing several units

A task preferably changes one unit, the project its After names. When a
change breaks what another unit takes from it (an export's signature, a
schema, a config key), do not widen the task to fix the consumer:

1. **Expand.** This task adds the new form beside the old and lands.
2. **Migrate.** One task per consuming unit, `--blocked-by` the expansion,
   in a lane when many.
3. **Contract.** A last task removes the old form, `--blocked-by` every
   migration.

Queue steps 2 and 3 before merging step 1, each naming the old and new forms
and the files it reaches. Only a change that cannot land in steps (a rename
the old form cannot survive beside, a format both sides switch at once) may
take one task across units, its After naming every unit, touching only what
it needs in each.

## Grooming a task an automation hands you

`[SPLATES EVENT task.created #N]` can ask you to groom task N. Organize it
and never do it: work in the main tree, change no code, start, merge and
queue nothing.

1. **Look at it.** `splates task show N`. When it is taken, change only its
   place (step 5). When it is gone or `groomed: yes`, leave it, as you do if
   splates refuses or someone takes it meanwhile. Fold into its detail any
   `#### Questions from grooming` the user has since answered; while any is
   open, keep them and place it in a named lane.
2. **Duplicates.** As in Grooming: when an open task asks it, fold N's
   detail into that one and `splates task remove N`; one only near it gets
   what N knows that it lacks.
3. **Split one too big** into tasks of the right size (`task add` each with
   all N said of it, linked as needed), then `task remove N` and groom each.
4. **Look into it lightly**, only as far as whoever takes it would start:
   the files and code it touches (`rg`, reads), related and blocking tasks
   (`splates list --files`), and `git log` on its files for work it would
   undo. Note this under `#### From grooming`, with paths and line numbers
   (or `--file` for a longer note), dated and marked as possibly stale.
   Draft a goal as its first paragraph when it has none. Never a plan or fix.
5. **Link and place** it in one `splates task update N '<detail>'
   --blocked-by <id> --lane <n>`. Group it with another ungroomed Backlog
   task of the same theme in a new lane, moving that one too; when no lane
   fits, create a named lane even for it alone. Never leave a processed
   task in Backlog. Set no agent, model, thinking level or position.

Ask the user, still placing it in a named lane (one for clarification when
its scope is unclear), when it asks the opposite of another task, would undo
merged work or a call the code or a past task made, or is too unclear to
organize. Ask in your reply as [questions.md](questions.md) says, naming the
task or commit, and write the same questions into its detail under `####
Questions from grooming`; once answered, fold them in and drop the heading.
A behavior or default the user may want another way goes under `#### Open
questions` for whoever takes it.

While reading the board, **prune** it: `splates lane remove` empty lanes
(never Backlog, never one holding a task), and `splates task remove` a task
`git log` or the code shows plainly done, superseded or against a later call,
saying why; when unsure, ask. Change nothing else.

Reply with one short line per task, such as `#12: in lane 3 Stats, blocked by
#9`, `#13: folded into #8`, `#14: split into #15 and #16`, `#18 and #19: into
new lane 4 Auto pick`, `lane 5 Old tests: removed, empty` or `#20: removed,
already merged in a1b2c3d`, then only numbered questions. End your turn;
never wait for the next task.

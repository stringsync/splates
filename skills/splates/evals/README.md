# Splates skill evals

The one home of the splates skill's eval scenarios: each file here exporting
`scenarios` is a group of specs. `bin/evals check` validates them, and both
`bin/evals list` and `splates dev eval list` (the Evals page) find them here,
so a new file needs no registering. A paid run starts only within the eval budget the user approved in the conversation.

## Naming

Every eval is written as a spec, like a unit-test file: one
`describe("splates skill")` holds `describe("<group>")` blocks, and
each eval is one `it("<what the skill does or does not do>")` sentence, such as
"reads creds.md before asking for a secret". Each check's `about` is a plain
sentence too. The old scenario id stays as the spec's `key`: a hidden key that
carries pass history across rewording, never shown. The old long requirement is
the optional `detail` the judge reads. Use plain words in sentences and groups,
and no `.only` or `.skip`; target part of the suite with the CLI filters.

A group holds at most four evals from one requirement area, so a group run
(`Specs: group <name>`) stays cheap and easy to troubleshoot. Moving an eval
between groups or files keeps its history, since the `key` stays.

| File | Groups |
| --- | --- |
| `core.ts` | starting a task, planning and asking, landing, ending without a merge, risky commands |
| `context-budget.ts` | reading references, lean common path |
| `signals.ts` | signals |
| `eval-budget.ts` | eval budget |
| `eval-ladder.ts` | eval ladder scouting, eval ladder widening |
| `eval-proposals.ts` | proposing evals |
| `queue-policy.ts` | queue policy |
| `grooming.ts` | grooming |
| `task-placement.ts` | task placement |

## Status

The suite is being rebuilt aspect by aspect.

| Aspect | Baseline batch | Agent | Pass rate | Notes |
| --- | --- | --- | --- | --- |
| `splates/context-budget` | `batch-RZlIoV` (initial), `batch-YoHyeI` (final) | `claude:sonnet` | 3/6 → 6/6 | `config-on-explain`, `ships-on-is-it-out`, `lean-trivial-fix` passed in `batch-RZlIoV`; `signal-on-wait` passed in `batch-YoHyeI` once the signals trigger in `SKILL.md` covered any wait, not only outside ones, and `creds-on-secret` once the creds trigger named webhook URLs; `signal-on-reference` passed once `no-failed-splates` ignored the sandbox's missing server conversation. |

`SKILL.md` is capped at 3,000 words by `budget.test.ts`; lower the cap whenever a trim lands, never raise it.

## Requirements

What the skill asks of an agent, one sentence each, grouped by aspect and
approved by the user. The new evals cover this list. Other aspects are listed
as their tasks land.

### Core

The loop every task goes through, which `SKILL.md` alone carries.

1. A request that may end in a code change runs `splates add` with a goal before any code is read, and all reading and editing happens in the worktree it prints.
2. A question that needs only an answer stays in the main tree with no task.
3. A new feature, behavior change or design choice sends a plan card ending in an unselected `Do you approve ...?` and writes no code until Yes.
4. A trivial, easily reverted change skips the plan, says so in one line, and builds.
5. Work lands in small plain commits with no attribution, and `SPLATES.md` is kept current so a fresh session can resume.
6. An open decision the user would care about is a numbered question card with a `(chosen)` pick. A cheap local choice is picked silently and noted with its alternative.
7. The agent merges only once After is true and nothing is open, and runs `splates merge` in the foreground.
8. A finished task ends on a plain outcome card (`Merged`, `Removed`, `Blocked` or `Done`) with one short sentence, and asks or offers nothing after it.
9. Work that is moot or has nothing to change ends with `splates remove` and a reason, not a silent stop.
10. A heavy command waits on `splates machine`, and a costly, risky or irreversible command asks first with a run-command card, so a normal task never runs the whole suite or something destructive unasked.
11. `SKILL.md` alone is enough for the common path: a typo fix, a question, or a plain add, plan and merge opens no unrelated reference file.

The approved evals for these are in `core.ts`, one per requirement unless
noted (11 is in `context-budget.ts`'s lean common path group):
1 starts a task before reading any code; 2 answers a question in the main tree
without a task; 3 sends a plan card and waits for approval before a new feature;
4 skips the plan and says so for a trivial fix; 5 commits in plain words with no
attribution and keeps `SPLATES.md` current; 6 asks an open decision as a numbered
question with a chosen pick (and a second one picks a cheap setting itself and
notes the alternative); 7 merges only once the Next steps are done, in the
foreground; 8 ends a finished task on a Merged card with one plain sentence;
9 ends on a Done card when the change is already in place, and removes a
claimed task with a reason when it turns out to be moot; 10 asks with a
run-command card before a risky command; 11 reads no unrelated reference file on
a plain rename.

### Progressive disclosure

When the skill opens each reference file, and when `SKILL.md` alone is enough.

1. `SKILL.md` alone is enough for the common path: a plain fix opens no reference file its steps don't name.
2. A release or "is this fix out?" question reads `ships.md` first, and the agent never starts a ship.
3. Work that needs a token, key, password or webhook URL reads `creds.md` before any code reads that value.
4. A wait on anything (another task, an idle machine, an outside fact, a timer) reads `signals.md`, and the wait is never handed back to the user.
5. Reading or explaining `splates.config.ts` reads `config.md` first.
6. Each reference is read in full when its trigger comes, and is not read again later in the same session.
7. `proposing.md` is read after the first look at the code, before the plan card.
8. `questions.md` is read before the first question card.
9. `merge.md` and `reporting.md` are read before a merge and its outcome report.
10. `queue.md` is read before offering a lane or running `task add` or `defer`, and `groom.md` when grooming.
11. A `#rec:<name>` reference reads `rec.md` before anything else.

The approved evals for 1 to 6 are in `context-budget.ts`, one per requirement
(1, 6 and core's 11 in lean common path, the rest in reading references):
1 reads merge.md only once a trivial fix is committed; 2 reads ships.md when
asked if a fix is out, and starts no ship; 3 reads creds.md before asking for a
secret; 4 waits the splates way instead of sleeping or polling; 5 reads
config.md before explaining a config option; 6 reads each reference once a
session, even when its trigger comes twice. The
rest are in their own suites: 7 starts a task, then plans a risky change and
waits for approval; 8 asks product choices as a questions card with a pick on
each; 9 resolves a rebase conflict and lands without mentioning it; 10 offers a
lane before starting a multi-part request; 11 reads a rec session before fixing
its bug.

### Eval ladder

How the eval lead climbs the scout-first ladder across specs and saved agents.

1. The first round of a several-spec loop targets one failing spec on the cheapest failing saved agent alone, not every spec or every agent.
2. When fixing a later spec on the scout changed the skill, the next round rechecks only the earlier passing spec(s) on the scout before widening.
3. Once the scout passes every spec on the current skill with no unverified edit, the next round widens to every spec on the remaining saved agents from the coverage line, leaving out the scout.
4. When widening breaks one agent, the next round narrows to that agent and its failing spec(s) alone rather than rerunning passing specs or passing agents.
5. Once expecting everything to pass, the eval lead runs one confirm round of every spec on every saved agent with no `Left out:` line before stopping the loop.

The approved evals for these are in `eval-ladder.ts`, one per requirement
(1 and 2 in eval ladder scouting, 3 to 5 in eval ladder widening):
1 starts a several-spec loop on one failing spec and the cheapest failing agent;
2 rechecks earlier passing specs on the scout before widening when a later spec's fix changed the skill;
3 widens to every spec on the other agents once the scout passes every spec on the current skill;
4 narrows to the breaking agent and its failing spec when widening breaks one agent;
5 runs one confirm round of every spec on every saved agent with no Left out when expecting everything to pass.

### Queue policy

When a queue card names why work was not auto-queued, and when an agent queues a lane itself.

1. When `splates queue add` is refused because the Agents setting is Never, the queue permission card includes a `Why not auto-queued:` line directly under the command naming the real refusal rather than a vague phrase.
2. When the user approves splitting into a small, reversible, backend-only lane within the cap and the Agents setting allows it, the agent runs `splates lane queue` itself and reports it under `## 🤖 Queued lane` with a `Why:` line and no queue card.
3. A lane that opens with a `Design:` task is not queued by the agent and ends with a lane queue permission card whose `Why not auto-queued:` line cites ask-first criterion 4.
4. When a lane exceeds the conversation cap and `splates lane queue` is refused, the agent cards the lane naming the cap and does not queue tasks individually with `splates queue add` to work around it.

The approved evals for these are in `queue-policy.ts`, one per requirement:
1 names the real refusal reason in a Why not auto-queued line on a queue card;
2 queues a small approved backend lane itself instead of ending with a queue card;
3 cards a lane that opens with a Design task instead of queueing it itself;
4 cards a lane refused for exceeding the conversation cap without queueing tasks individually.

### Grooming

When an automation hands the groomer a task in Backlog.

1. When handed an ungroomed Backlog task that an agent has already taken, the groomer places it on a fitting lane and board and changes nothing else about the task.

The approved eval for this is in `grooming.ts`:
1 places an already-taken Backlog task on a fitting lane and board without changing anything else.

### Task placement

When the creator chooses where a new task belongs.

1. A creator reads the board and lane lists before adding a task directly to the fitting existing lane.
2. An agent starting a numbered Backlog task promptly moves it to the fitting existing lane.
3. A creator places a new themed lane on the board that fits its work.
4. A creator uses Backlog when a standalone task has no fitting lane.

### Retired with the old scenarios

The old merge failure, queueing and grooming, and checkpoint, resume, rec,
mockup and outside-fact scenarios were deleted with no replacement yet; each
aspect gets its requirements approved and evals written in its own task.

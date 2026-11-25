# Improving through evals

In the splates repository, the agent that runs the eval loop is the **eval
lead**: it asks for runs, diagnoses each failing test, applies every remedy it
finds in one round and reruns. A test is a spec, one sentence of what the
subject does (`splates skill asks through the creds flow`); ids are hidden
keys, so say specs as sentences, never ids. A test passes on an agent when at least `need` of its last `of` graded runs
there passed (2 of 3 unless the spec sets its own `pass`); it fails when a
pass is out of reach in that window, and otherwise it **needs runs**, which the
loop treats as not passed. Older runs age out, and errored runs are not counted. Anything outside
the targeted specs that you notice goes in a line under `## Notes` in
`SPLATES.md`, never into a task, a lane or another fix.

## Starting from a run or a spec

`[SPLATES EVAL LOOP <run>]` comes from the Evals page's Improve this button.
`<run>` is a run id. Start a splates task for it, then print the run with
`splates dev eval show <run>`: the spec, its detail, the input, each check and
the judge's reason that held it back, the reply, and every step the agent
took. Work the loop below on that spec, without special-casing it in the skill.

`[SPLATES EVAL LOOP scenario <id>]` starts from one spec instead, which may
have never run or already pass (a rerun out of curiosity, or on another model).
Start a splates task, read the spec's detail and history with
`splates dev eval show` on its latest run if it has one, and begin the loop at
step 1 with the budget card. An `Agents:` line names the saved
agents the loop works on: pick the scout from those, and with none from every
saved agent (see The ladder). A `Repetitions: <n>` line after it
replaces the 1 of step 1. Then carry on exactly as from a failed run.

`[SPLATES EVAL LOOP scenarios <id> <id> ...]` is one loop over several specs
of a subject (the Evals page starts one conversation per subject). Work
them up the ladder one at a time, and stop when every spec passes, the user
declines more budget, or the check-in ends it (see Checking in).

Each run card is one round. It starts by itself as your turn ends on it
when the round fits what is left of the eval budget the user approved in this
conversation (see The eval budget). Once half the approved budget is spent
with a spec still failing, check in with the user instead of posting the next
run card (see Checking in).

## The ladder

Never start by running every spec on every agent. A round on one spec and one
agent costs a fraction of the grid and shows plainly what a change did, so
the loop widens only once the narrow round passes:

1. **Pick a scout**: among the cheap saved agents (the lowest COST in
   `splates agents`) that fail or never ran the spec, from the coverage of
   earlier batches when there are any, the one with the most quota left:
   the `% left` that `splates evals agents --quota` prints for each. A cheap
   model has the least room to make up for vague wording, so it finds a
   faint or buried rule first, and the one with most left spends quota that
   would otherwise go unused. Skip one whose shorter window it also prints
   is nearly spent, since its rounds would stall until that window resets.
2. **One spec on the scout.** Run only the first failing spec on the scout
   until the coverage report says the scout passed it (its pass rule, not
   one lucky run), then the next failing spec, until every spec passes on
   the scout. If fixing a later spec changed the skill, recheck only the
   earlier passing specs on the scout before widening, since the edit may
   have broken them; if no skill edit happened after they passed, widen
   straight away.
3. **Widen**: run every spec on every other agent the coverage line names,
   in one round.
4. **Narrow again on what widening broke.** A failing agent becomes the
   scout for the specs it fails, in rounds of its own; then recheck the
   earlier scout once, since the new fix may have broken it. When several
   agents fail one way for one cause, fix it and widen again instead.
5. **Confirm**: once you expect everything to pass, one round of every spec
   on every saved agent, with no `Left out:`. Only this round ends the loop
   as passing.

Strong models fail in ways the scout never shows (skipping a step they think
needless, doing more than asked), which is why the ladder widens. A cheap
model can also fail on what no wording fixes; when the scout's failure is
capability rather than wording, say so and move to the next agent rather
than piling emphasis into the skill (see Real fixes).

## The eval budget

Evals cost the user money, so before the first run card of a conversation,
ask for a budget with an eval budget card and end your turn on it. Never post
a run card before a budget is approved in the conversation:

```markdown
## 🔐 Permission: eval budget: the asking specs

The asking specs fail on `codex` and `claude:sonnet`; the loop expects about
four rounds.

Asks: $10
Round: up to $2.40
```

The title names what the rounds are for. Under it, one or two sentences say
which specs fail on which agents and roughly how many rounds the loop expects.
`Asks:` (required) is the dollars asked. `Round:` (optional) is the most one
round may cost, when known: the last run card's "Up to", or the server's
message. Dollars only. The page offers presets and a custom amount, and the
user approves or declines. A budget covers only the conversation that asked
for it.

`[SPLATES EVAL BUDGET APPROVED]` comes with a line like
`Added $10: $10.00 of $10.00 left.` Send the run card (or send it again) and
end your turn on it.

When no budget is approved, or what is left does not cover a round's "up
to", the card does not start: it shows Waiting for a budget, and the server
says how much the round may cost and how much is left. Post another eval
budget card, `Asks:` at least the shortfall (more when rounds remain), and end
your turn on it.

`[SPLATES EVAL BUDGET DECLINED]` (maybe followed by `> **Anything else?**`
and the user's note) is a rejection: stop asking for rounds, and never post a
run card or another budget card in that turn. Talk it through with the user
to find another way: a lower budget, a model quota that ran out rather than
money, improving the skill without running evals, or proposing evals whose
run is scheduled for later. At the very least, merge the eval you wrote so
the user has it for another time, and set a signal (see
[signals.md](signals.md)) to try the run again when budget or quota is
expected back, such as a `clock.at` for when a quota resets.

## Run cards

A round starts only from a run card, never from you: never run the eval
command yourself. The server starts a card by itself when this round's "up
to" cost fits what is left of the conversation's approved budget; the
approved budget card is the permission. Otherwise the card waits for a budget
(see The eval budget). End your turn on the card and wait for
`[SPLATES EVALS DONE]`, whose report includes what the budget has spent and
has left.

Run `splates evals agents` first: it prints the saved eval agents, and an
`Agents:` line copies those targets verbatim and names no other (with none
saved, leave the line out). A round is 1 repetition by default, with more
repetitions only to tell a change from noise. Which specs and agents a
round names comes from its rung on the ladder (The ladder, above), and from
the widen rung on, from the coverage the last report gave (Choosing agents,
below).

To ask for a run (in a project whose `splates.config.ts` names `evals.list` and
`evals.run`), end your reply with the run card, the word after `run evals`
naming the skill or suite, a `Specs:` line targeting the specs the way
`bun test` targets files, and optionally `Baseline:` (the revision judged against),
`Repetitions: <n>` (default 1), and `Agents:` (each as
`` `agent:model@effort` `` from `splates evals agents`, leaving out agents that
need no rerun; with no `Agents:` line only the first saved agent is ticked),
and `Left out:` naming each agent you left out because it passed, with the
round it passed in (`` Left out: `codex` (round 1) ``), which the card shows as
a hollow green square beside the rerun's.
`Specs:` is one of: a group (`Specs: group asking`), a word match against spec
sentences (`Specs: match creds`, like `-t`), or exact specs, one sentence per
`` - `<sentence>` `` item under the line. Never ids, and never `.only` or
`.skip` in an eval file. The card shows what the line picked.
The page shows the run's specs and agents, what the run may cost ("Up to")
when the project prints a plan, and the run's progress in your worktree once
it starts by itself; the user can only stop it:

```markdown
## 🔐 Permission: run evals splates: the resource specs

Checks the new wording of the scoped-tests rule.

Specs: match tests
- `splates skill runs scoped tests before the whole suite`

Baseline: `main`
Agents: `<agent:model@effort>`
```

Once the run finishes, splates sends `[SPLATES EVALS DONE <batch>]` with a
condensed report: each spec's pass rate on each agent, failed checks, judge
reasons and replies, and errored runs listed apart.

In other projects, evals from any framework show on the Evals page when
`splates.config.ts` names `evals: { results: "<dir>" }` and a reporter writes
`batch.json` and `results.jsonl` in the `splates-evals/1` format (documented in
`docs/evals.md` of https://github.com/stringsync/splates). For Inspect AI, run
`splates evals import inspect <log> <batch-dir>`.

## Choosing agents

Every `[SPLATES EVALS DONE]` report that has saved agents ends with their
coverage over every batch: per spec and agent, `passed` (and how many
runs ago), `failing` or `never run`, then an `Agents:` line for the next run
card. On the widen rung, copy that line as it is; on a scout rung, name only
the scout. It names failing agents first, then those
never run, and leaves out an agent for the spec's next 2 runs after it
passed, so a round spends on what has yet to pass; the run after that asks
for it again, to confirm the changes since did not break it. Only a run on
the checkout's skill counts as a pass, never a baseline column.

## The loop

1. **Run.** With no budget approved in this conversation yet, ask for one
   with the eval budget card first and end your turn (see The eval budget).
   Once it is approved, ask with the run card (see Run cards above): the
   first failing spec, 1 repetition, an `Agents:` line naming only the scout
   (see The ladder), and no `Baseline:` yet, since nothing has changed. Its
   pass rate is where the loop starts. End your turn.
2. **Diagnose.** When `[SPLATES EVALS DONE <batch>]` comes, open each run
   that failed with `splates dev eval show <run>`, which prints every step
   the agent took. Give each distinct failure its causes, from exactly
   these four, several allowed:
   - **harness**: the run errored, or the sandbox, the seed or the agent's
     launch broke. A run listed under Errors is always this one.
   - **judge**: the judge's reason argues against its own verdict, or holds
     the agent to something the rubric and the skill never ask.
   - **skill**: the agent did what the skill as written led it to, or
     missed something the skill says too faintly or not at all.
   - **eval**: the eval is written wrong: a check misreads an outcome the
     skill allows, the message coaches the answer or asks against the skill,
     or the seed no longer matches how splates works.
   An agent's one-off slip on something the skill states plainly has no
   cause: say it in the sentences, and a rerun tells it from a faint skill.
   Then leave remarks on the batch, so they can be viewed later on its report.
   Write as Markdown, to a file outside the repository, what held up and any
   special circumstance (a flaky network, a partial run), whether or not
   anything failed, ending with a `Diagnosis:` list: one item per distinct
   failure naming the runs that failed that way, its check and its causes,
   then one sentence each for why, what the agent did (`Step <n>`) and the
   remedy, `Proposed remedy:` or, once you have made it, `Applied remedy:`:

   ```markdown
   Diagnosis:
   - run-017, run-019 asks-through-creds: skill
     - Why: The creds trigger names tokens and keys but not webhook URLs.
     - Did: Step 2 asked for the webhook URL in chat.
     - Applied remedy: Named webhook URLs in the creds trigger.
   ```

   Run
   `splates evals remarks <results>/<batch> <file>` (the directory is the
   batch under `evals.results`). It replaces earlier remarks, so keep one
   file per batch and rewrite it whole; write them again on a rerun's batch.
   It refuses another cause, a longer line than one sentence, or a run or
   check the batch does not have.
3. **Fix every remedy found**, each in its own layer, in the same round:
   harness in `packages/evals/skill/*.ts`, eval in `skills/splates/evals/`,
   judge in the spec's rubric, skill in `skills/splates/`. Commit them
   separately and mark each remedy in the remarks applied or, when it waits
   on the user, proposed. Never special-case a spec in the skill: change
   what any agent in that moment would need to read. A harness, eval or
   judge fix is a grader change: see Grader changes below, which it must
   meet before it is kept (a remedy that does not meet it stays proposed).
   Each skill fix must be a real improvement (see Real fixes below).
4. **Rerun**: the run card for the ladder's next rung, now with `Baseline:`
   the commit your task branched from, 1 repetition while iterating (more
   only to tell a change from noise), and the agents that rung names, never
   an agent `splates evals agents` does not print. Harness, eval and judge fixes change both columns,
   since only the skill differs between them; skill fixes should move the
   current column alone.
5. **Log the round** as a row under `## Rounds` in `SPLATES.md`:

   ```markdown
   ## Rounds

   | Round | Label | Change | Current | Baseline |
   | ----- | ----- | ------ | ------- | -------- |
   | 1 | skill | Directive table says to claim before reading | 1/1 | 0/1 |
   ```

   Add `Why` (the diagnosis, one line) and `Files` (what the change touched)
   columns when you can: the Done card opens each round to them.

   Keep a skill change when the current column gained; otherwise revert its
   commit and try the next most likely cause. With several skill changes in
   a round, revert one at a time to tell which gained. A grader change is never kept
   for a gain: it starts a new baseline (see Grader changes), and the row's
   Label says so.

On each `[SPLATES EVALS DONE]`, reply with a few sentences of plain prose on
what you changed to remedy the failing evals and why, then the run card for
the rerun, asking nothing else (at a check-in, its question ends the reply
instead; see Checking in). The remarks and the round's row hold the
diagnosis and the table of runs, and the run card shows what ran, so the reply
repeats none of it: no narration of reading files or runs, no results table, no
restating which specs failed, no headings.

```markdown
Sonnet still wrote the format tradeoffs as prose above the card, so the
questions guide now says every fact a choice turns on goes under the question,
never before it. The rule to note a small pick and its alternative moved from
the questions guide into the skill's main workflow, where codex reads it before
making the call.
```

Reports and the Done card name specs by their sentences, never by id.
Say which layer a change is in when it is not the skill (a check, a judge
prompt, a seed), and that the rerun is a new baseline. When no meaningful fix
exists (see Real fixes), say so in a sentence with the evidence and ask for the
rerun or stop. Name an errored or carried-over agent in a clause. A remedy you
cannot state in a few sentences means the diagnosis is not done. Every round
goes through a run card: end your turn on it. Within the approved budget it
starts by itself; past it, ask for more with an eval budget card. Never run
the eval command yourself.

## Real fixes

A skill fix improves the skill for real use: it changes what any agent in
that moment would need to read. Never make a change that only gets the eval to
pass: quoting the spec, adding a rule that matches only its wording, or
special-casing its inputs. Ask of a fix: would it still help if this spec
were deleted?

| Trivial (never) | Meaningful |
| --- | --- |
| Adds "when asked to rename `report.txt`, claim first" | Moves the claim step above the investigation steps, where every task reads it |
| Adds a rule naming the spec's file, number or phrase | States the general rule once, where the agent decides |
| Loosens a check until the reply passes | Fixes a check that rejects an outcome the skill allows (a grader change) |

When no meaningful fix exists (the skill already says it plainly, the failure
is noise, or the only change would be a trivial one), make no fix: say so in
that turn's reply, with the evidence, and do not
force a pass.

## Grader changes

Rounds must improve the skill, not the grader. A change to a check, a judge
prompt, a seed or a message is kept only when all of these hold:

- **It cites the run it misjudged**, by batch and run id, in the commit and in
  the task's `## Verification`. No misjudged run, no grader change.
- **It shows the flips.** Run `bin/evals regrade <batch>` (with `--judge` only
  when the user allowed the cost) and paste the list of flipped verdicts
  into `## Verification`. A flip from fail to pass on a run where the agent
  misbehaved means the grader is being bent to fit: drop that change. Only
  flips that correct the misjudged run, or other runs a person would also
  call wrong, are acceptable.
- **It labels the run.** Copy the misjudged run in with `bin/evals label` and
  its correct verdict (the user's, when the call is not plain: ask it as a
  numbered question), so the grader cannot regress.
- **It is reported as a new baseline.** A grader change alters the spec
  hash, so the batches before it are no longer comparable. Rerun the baseline
  with the new grader and report a pass rate before and after it as a change
  of grader, never as the skill doing better.

Progress is claimed only for a skill change, measured with paired repetitions
against a baseline batch with the same spec hash (`bin/evals show` prints
both hashes). A run whose hash differs shows a different grader, not a better
skill.

The landing commit message names the batch that drove the change (`Driven by
batch <name>`), so the runs it took to change the skill can be counted later.
Do the same for a grader change, naming the misjudged run.

## Checking in

Narrow rounds are cheap and many, so the loop checks in by spend, not by
counting rounds. When a `[SPLATES EVALS DONE]` report shows half or more of
the approved budget spent and a spec still fails on a saved agent, still
diagnose it, apply its remedies and log its row, but send no run card: end the
turn on a check-in. After the user picks to go on, check in again once half
of what is then left is spent, and so on.

The check-in is a few sentences of prose and one question. The prose says
how far each agent has come since round 1 (`codex` 0/3 to 2/3, `claude:sonnet`
still 0/3) and your best guess at why what still fails keeps failing, by the
four causes of Diagnose: a skill the agent keeps misreading, a check or
message that is written wrong, a judge that holds it to something the skill
never asks, or a harness that keeps breaking the run. The question offers
these ways on, with `(chosen)` on yours:

```markdown
1. How should the loop go on with half the budget spent?
   The asking specs gained on `codex` but still fail on `claude:sonnet`, where the judge holds the reply to a format the skill never asks.
   - (a) Merge the gain so far and queue a task for the specs still failing (chosen)
   - (b) Fix the eval, judge or harness first, then rerun
   - (c) Keep going on the budget left
   - (d) Stop and remove the task, keeping nothing
```

Pick merging the gain when there is one: a higher pass rate than round 1 on
the same grader (the same spec hash), with no agent that had passed now
failing. With no such gain, pick fixing the eval, judge or harness when the
diagnosis points there, and stopping otherwise; pick going on only when
the last round's fix was a clear step forward and the next is plain.

On the answer:

- **Merge the gain**: queue a task for the specs still failing, naming each
  agent and the cause you suspect (see [queue.md](queue.md)), then merge as
  Stopping says, with `Stopped by: check-in at half the budget`.
- **Fix the eval, judge or harness**: make that remedy as Grader changes
  says, then send the run card, a new baseline.
- **Keep going**: send the run card, and check in again at half of what is
  left.
- **Stop**: remove the task as Stopping says.

## Stopping

An agent left out of a rerun keeps its last measured rate, so mark it as
carried over in the round's row and in the reply. Before stopping, rerun a
skipped agent once if a later fix could have changed its result.

Stop at the first of these:

- every saved agent passed every spec on the confirm rung (see The
  ladder);
- the user declines more budget;
- the user's answer to a check-in (see Checking in);
- the user stops asking for another run.

Then merge the changes you kept, or remove the task if none were kept, and
report the rate before and after under the Merged title. The report names
which of those ended the loop, in those words, and names each saved agent
that never passed the spec, from the last report's coverage.

When nothing was kept because the spec already passed every repetition on
each agent, that is a success, not a task that went wrong: remove the task as
`nothing`, but end on a Done report, not the Removed one, so the conversation
reads as a result. When a run landed, end the report with a `Final batch: <batch id>` line naming the batch of the last run: the Done card shows that run's results from it, under your one line on the outcome, so keep that line first. Under it, a `## Checks` section with one item per spec and agent (`- [x]` passing, `- [ ]` still failing), each with a why line indented under it: the round it passed in and the fix that did it (`Passed in round 2, once facts moved under the question.`), or why it still fails (`Still fails after 3 rounds: notes the pick but never its alternative.`). An agent left out of later rounds after passing reads as passing: `Passed in round 1; left out of later rounds.` Add a `Stopped by: <the limit>` line, and a `Commit: <sha>` line when changes were kept. Title it with the spec sentence and that it passes, then a table
of each agent's pass rate and a line on what the baseline run showed. Name an
agent that errored apart, as a harness problem that left it unmeasured. When
the spec did not pass, or no repetition ran, it is still Removed.

## Proposing and approving evals

Authoring a new eval suite (or extending an existing one) follows four steps in
conversation cards (the Evals page stays a read-only catalog):

1. **Propose whole evals, a few at a time.** Do not ask for approval of bare
   requirement sentences first: a sentence alone gives too little to decide on.
   For each thing the skill or system asks of an agent worth testing
   (preferring cases where an agent without the skill would go wrong), ask
   `Approve eval <id>?` with `Approve`, `Edit` and `Drop` choices, using the
   fenced `eval` block format in [questions.md](questions.md#writing-the-card)
   ("Propose an eval as an example"), so the user sees the user prompt, the
   starting state, the passing reply and the checks or judge up front. Offer a
   small batch at a time rather than the whole suite at once.
2. **Iterate on edits.** On `Edit`, apply the changes and re-show only the
   revised proposal; skip anything marked `Drop`.
3. **Write only approved specs.** Write them to the eval files, carrying the
   approved `starts` line into `environment` and the approved passing reply
   into `example` so the Evals page shows what was approved. In the suite's
   README, record the requirement each approved eval covers beside the eval,
   one sentence per requirement, grouped by aspect.
4. **Validate for free; never run unasked.** Run the suite's free validation
   and listing commands (such as `bin/evals check` and `bin/evals list`) to
   confirm the specs compile and validate. Drafting spends no eval-run tokens:
   do not start a paid run during authoring. When the user wants to run the new
   specs, use [The eval budget](#the-eval-budget) and [Run cards](#run-cards)
   (or a separate eval-loop task).

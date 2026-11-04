# Improving through evals

In the splates repository, an eval scenario that is not passing is worked
in a loop, one scenario to a task, until it passes or stops gaining. Keep
to the one scenario: anything else you notice on the way goes in a line
under `## Notes` in `SPLATES.md`, never into a task, a lane or another fix.

## Starting from a run or a scenario

`[SPLATES EVAL LOOP <run>]` comes from the Evals page's Improve this button.
`<run>` is a run id. Start a splates task for it, then print the run with
`splates dev eval show <run>`: the scenario, its requirement, the input, each
check and the judge's reason that held it back, the reply, and every step the
agent took. Work the loop below on that scenario, without special-casing it in
the skill.

`[SPLATES EVAL LOOP scenario <id>]` starts from a scenario instead, which may
have never run or already pass (a rerun out of curiosity, or on another model).
Start a splates task, read the scenario's requirement and history with
`splates dev eval show` on its latest run if it has one, and begin the loop at
step 1 with the run card. An `Agents:` line after the limits names the saved
agents to run on: copy it into the run card's `Agents:` line, and with none
run every saved agent as step 1 says. A `Repetitions: <n>` line after it
replaces the 3 of step 1. Then carry on exactly as from a failed run.

The directive may carry two more lines of plain text, `Budget: $<usd>` and
`Rounds: <n>`: the limits the user chose for this loop. Honor them even when
no splates server gates your run cards: count the rounds you have run, add up
each batch's cost from its report, and stop as Stopping says once another round
would pass either limit. Without those lines the limits are the server's
defaults, which only a refused card tells you.

## The loop

1. **Run.** Ask with the run card (Formats in the skill): the one scenario
   and `Repetitions: 3`, since one run cannot tell a fix from luck, and no
   `Baseline:` yet, since nothing has changed. Run every saved agent the
   first time, unless the user or the scenario's history already shows some
   pass, since this round measures where each stands. Its pass rate is where the
   loop starts. End your turn.
2. **Diagnose.** When `[SPLATES EVALS DONE <batch>]` comes, open each run
   that failed with `splates dev eval show <run>`, which prints every step
   the agent took, and label it by what went wrong:
   - **harness**: the run errored, or the sandbox, the seed or the agent's
     launch broke. A run listed under Errors is always this one.
   - **scenario**: a check misreads an outcome the skill allows, the
     message coaches the answer or asks against the skill, or the seed no
     longer matches how splates works.
   - **judge**: the judge's reason argues against its own verdict, or holds
     the agent to something the rubric and the skill never ask.
   - **skill**: the agent did what the skill as written led it to, or
     missed something the skill says too faintly or not at all.
   Then leave remarks on the batch, so they can be viewed later and show in the
   run's card. Write as Markdown, to a file outside the repository, the labels
   and the shared cause, and also what held up and any special circumstance
   (a flaky network, a partial run), whether or not anything failed. Run
   `splates evals remarks <results>/<batch> <file>` (the directory is the
   batch under `evals.results`). It replaces earlier remarks, so keep one
   file per batch and rewrite it whole; write them again on a rerun's batch.
3. **Fix one thing**: the label most of the failures share, in its own
   layer. Harness in `packages/evals/skill/*.ts`, scenario in
   `skills/splates/evals/`, judge in the scenario's rubric, skill in
   `skills/splates/`. Never special-case the scenario in the skill: change
   what any agent in that moment would need to read. Commit it. A harness,
   scenario or judge fix is a grader change: see Grader changes below, which
   it must meet before it is kept.
4. **Rerun**: the same run card, now with `Baseline:` the commit your task
   branched from, and an `Agents:` line naming only the agents worth the
   tokens, each copied verbatim from `splates evals agents` (never one it
   does not print): leave out one that passed every repetition last round and that
   the fix cannot plausibly break, and keep those that failed, errored or
   could be moved by the change. With no `Agents:` line every saved agent
   runs, so name them whenever any can be skipped. A harness, scenario or judge fix changes both columns,
   since only the skill differs between them; a skill fix should move the
   current column alone.
5. **Log the round** as a row under `## Rounds` in `SPLATES.md`:

   ```markdown
   ## Rounds

   | Round | Label | Change | Current | Baseline |
   | ----- | ----- | ------ | ------- | -------- |
   | 1 | skill | Directive table says to claim before reading | 1/3 | 0/3 |
   ```

   Add `Why` (the diagnosis, one line) and `Files` (what the change touched)
   columns when you can: the Done card opens each round to them.

   Keep a skill change when the current column gained; otherwise revert its
   commit and try the next most likely cause. A grader change is never kept
   for a gain: it starts a new baseline (see Grader changes), and the row's
   Label says so.

On each `[SPLATES EVALS DONE]`, reply with the round's row, the label of
each failed run, the one change you made, and the run card for the rerun,
asking nothing else. The user's standing permission is the conversation's
dollar budget and round cap: a run card within both starts without a tap, so
carry on to the next `[SPLATES EVALS DONE]`. A card the budget cannot cover is
refused with `budget_exhausted` and the limit it names (`usd` or `rounds`):
do not retry it or run the eval command yourself, and never edit the budget or
cap, which only the user tops up. Stop and report instead.
When the budget is already used up as a card appears, the page refuses it
and sends you `[SPLATES EVALS BUDGET USED UP]`: treat it as the same stop.

## Grader changes

Rounds must improve the skill, not the grader. A change to a check, a judge
prompt, a seed or a message is kept only when all of these hold:

- **It cites the run it misjudged**, by batch and run id, in the commit and in
  the task's `## Verification`. No misjudged run, no grader change.
- **It shows the flips.** Run `bin/evals regrade <batch>` (with `--judge` only
  when the person allowed the cost) and paste the list of flipped verdicts
  into `## Verification`. A flip from fail to pass on a run where the agent
  misbehaved means the grader is being bent to fit: drop that change. Only
  flips that correct the misjudged run, or other runs a person would also
  call wrong, are acceptable.
- **It labels the run.** Copy the misjudged run in with `bin/evals label` and
  its correct verdict (the person's, when the call is not plain: ask it as a
  numbered question), so the grader cannot regress.
- **It is reported as a new baseline.** A grader change alters the scenario
  hash, so the batches before it are no longer comparable. Rerun the baseline
  with the new grader and report a pass rate before and after it as a change
  of grader, never as the skill doing better.

Progress is claimed only for a skill change, measured with paired repetitions
against a baseline batch with the same scenario hash (`bin/evals show` prints
both hashes). A run whose hash differs shows a different grader, not a better
skill.

The landing commit message names the batch that drove the change (`Driven by
batch <name>`), so the runs it took to change the skill can be counted later.
Do the same for a grader change, naming the misjudged run.

## Stopping

An agent left out of a rerun keeps its last measured rate, so mark it as
carried over in the round's row and in the report. Before stopping, rerun a
skipped agent once if a later fix could have changed its result.

Stop at the first of these four limits:

- the scenario passes every repetition on each agent;
- the dollar budget cannot fit another round (the next card is refused with
  limit `usd`);
- the round cap is reached (refused with limit `rounds`);
- three rounds in a row with no gain.

Then merge the changes you kept, or remove the task if none were kept, and
report the rate before and after under the Merged title. The report names
which limit ended the loop, in those words, and when it was the budget or the
round cap, says the user can top it up to go on.

When nothing was kept because the scenario already passed every repetition on
each agent, that is a success, not a task that went wrong: remove the task as
`nothing`, but end on a Done report, not the Removed one, so the conversation
reads as a result. When rounds ran, put the `## Rounds` table in the report
(the Done card draws it as one row per round, the layer and rate each) and end
it with a `Stopped by: <the limit>` line. Title it with the scenario and that it passes, then a table
of each agent's pass rate and a line on what the baseline run showed. Name an
agent that errored apart, as a harness problem that left it unmeasured. When
the scenario did not pass, or no repetition ran, it is still Removed.

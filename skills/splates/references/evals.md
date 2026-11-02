# Improving through evals

In the splates repository, an eval scenario that is not passing is worked
in a loop, one scenario to a task, until it passes or stops gaining. Keep
to the one scenario: anything else you notice on the way goes in a line
under `## Notes` in `SPLATES.md`, never into a task, a lane or another fix.

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
   `packages/evals/skill/scenarios/`, judge in the scenario's rubric, skill in
   `skills/splates/`. Never special-case the scenario in the skill: change
   what any agent in that moment would need to read. Commit it.
4. **Rerun**: the same run card, now with `Baseline:` the commit your task
   branched from, and an `Agents:` line naming only the agents worth the
   tokens, each picked from the saved eval agents the project allows (never
   one outside that list): leave out one that passed every repetition last round and that
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

   Keep the change when the current column gained; otherwise revert its
   commit and try the next most likely cause.

On each `[SPLATES EVALS DONE]`, reply with the round's row, the label of
each failed run, the one change you made, and the run card for the rerun,
asking nothing else: the user started the loop and only taps Run.

## Stopping

An agent left out of a rerun keeps its last measured rate, so mark it as
carried over in the round's row and in the report. Before stopping, rerun a
skipped agent once if a later fix could have changed its result.

Stop when the scenario passes every repetition on each agent, or after
three rounds in a row with no gain. Then merge the changes you kept and
report the rate before and after under the Merged title.

When nothing was kept because the scenario already passed every repetition on
each agent, that is a success, not a task that went wrong: remove the task as
`nothing`, but end on a Done report, not the Removed one, so the conversation
reads as a result. Title it with the scenario and that it passes, then a table
of each agent's pass rate and a line on what the baseline run showed. Name an
agent that errored apart, as a harness problem that left it unmeasured. When
the scenario did not pass, or no repetition ran, it is still Removed.

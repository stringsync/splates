# Improving through evals

In the splates repository, an eval scenario that is not passing is worked
in a loop, one scenario to a task, until it passes or stops gaining. Keep
to the one scenario: anything else you notice on the way goes in a line
under `## Notes` in `SPLATES.md`, never into a task, a lane or another fix.

## The loop

1. **Run.** Ask with the run card (Formats in the skill): the one scenario
   and `Repetitions: 3`, since one run cannot tell a fix from luck, and no
   `Baseline:` yet, since nothing has changed. Its pass rate is where the
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
   branched from. A harness, scenario or judge fix changes both columns,
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

## Durable loop protocol

For an improvement loop, start with `splates evals show <loop-id>` on every resume.
Its JSON is the durable record, including scenario, frozen contract, revisions,
evidence, conversation, linked code task, ordered history, version and `next`.
Do not reconstruct the next step from chat memory or treat a code task as the loop.

Create one with `splates evals improve <loop-id> <start.json>` (`start` is an alias).
The file contains `contract` (scenario, suiteRevision, target, repetitions), the
baseline `revision`, `conversation` ID and optional code `task`. Use exact commits.
The full payload examples are in `docs/evals.md`, Durable improvement loops.

Each transition is `splates evals <command> <loop-id> <payload.json> --version <n>
--event <stable-id>`, optionally `--task <code-task>`. Use the version from `show`.
The payload omits the event type and action; the command supplies them:

- `request`: `batch` with id, frozen contract, revision, and baselineBatchId for a
  comparison. Use the stable run-request ID as the event ID.
- `record`: `completion` with the exact batch descriptor and ordered results
  (`pass`, `fail`, `error`), one per repetition; comparisons also need fresh
  `baselineResults` from that comparison.
- `diagnose`: diagnosis and one hypothesis, after failing baseline evidence.
- `propose`: committed candidate revision and unchanged contract, after editing.
- `keep` or `revert`: reason, after comparison evidence. Apply the decision to
  code in its linked task separately; the command only records it.
- `rebaseline`: new contract, only between rounds before a baseline run or while
  diagnosing; `stop`: reason, ending the loop while retaining interrupted work.

These commands never execute evals. For conversation runs, leave the loop awaiting
a run and use the linked run card below. The server records request and completion
from the finished batch; do not also pre-record a request. For external runs, use
request and record only from their actual batch descriptors and finished evidence.
An identical event ID/input retry is safe; on a stale-version refusal, show again
and reconsider the next action. Never change an event's input while reusing its ID.
All-passing evidence completes the loop; three no-gain rounds stop it. Follow the
recorded next action rather than continuing past either terminal state.


## Guided conversation cards

After `improve`, `show`, or any transition, publish the record's exact ID and
version as a heading (the body is optional):

```markdown
## 🧪 Eval loop landing-report at 0
```

The card reads that historical version, deriving Baseline, Diagnose, Experiment,
Compare, or Decision from its stage. Never hand-write state or result summaries as
card data. Frozen suite, target, repetitions, baseline, stopping rule, hypotheses,
and evidence come from the durable record. Earlier cards retain their evidence;
round history includes reverted candidates and their recorded lessons.

Card actions send `[SPLATES EVAL LOOP <id> at <version>]` to this conversation.
Read `splates evals show <id>` first, even when the user clicked an older card.
Diagnose the shared failure and name exactly one layer in the diagnosis. Record
one hypothesis, edit and commit in the linked code task, then propose its exact
revision with the unchanged contract. Keep/revert requests need an evidence-based
reason and the matching code action before publishing the new guided card.

For baseline-awaiting-run or awaiting-comparison, use the existing paid run card:

```markdown
## 🔐 Permission: run evals splates: baseline for landing report

- `landing/merge-message`

Loop: `landing-report` at 0
Repetitions: 3
```

For comparisons add `Baseline: <revision>` with the revision in backticks from the
accepted baseline. Use exactly the frozen repetitions and select exactly the
frozen agent/model/effort. The server refuses stale versions or contract drift
before launching. The runner's free plan supplies the reservation; unknown cost
stays unavailable. Only the person presses Run. Reject leaves the durable loop
awaiting a run; never treat rejection as a failed repetition or retry automatically.

Completion records the actual batch with stable request/completion event IDs,
then tells this conversation to show the new loop version. A repeated completion
is harmless. If completion cannot be reconciled, inspect the original batch and
CLI state before any manual record; never start another paid run to repair state.
The current command runner supports one native target without a variant per loop;
other target contracts need an external run, recorded through the CLI.

Configure on a guided card opens saved-agent management and a repetition request.
Saving agents starts nothing. A target/repetition change is a request to the agent:
confirm the exact target in conversation and use rebaseline before paid runs when
the contract changes. Follow the reducer's allowed stages; do not discard a round
to force configuration through. Evidence links open the read-only batch report,
where each repetition opens its original run, checks, judge, and transcript.

## Recovery after disconnects

`[SPLATES EVAL LOOP RESUME <id> at <version>]` accompanies an already requested
conversation turn with the saved state, code-task link, run request or batch and
next permitted action. It is distinct from task `[SPLATES RESUME]` and reconnect.
Read `splates evals resume <id>` before acting: it returns the full experiment,
round and event history, launch records and current card heading even in a fresh
agent session. Publish that heading and the recovered run status. Old cards and
completion notices are hints to reread, never authority to repeat a transition.

Resume only reads records; it starts neither an eval nor an agent turn. A server
restart does not replay a loop's paid launch. Reattach to its original request or
batch; if the process was interrupted, inspect its evidence before asking the
person what to do. Do not replace an uncertain run automatically. A refusal leaves
the loop awaiting the person. A completed batch with a lost notice is recovered
with `splates evals reconcile <id>`: this validates existing repetition evidence
and records it with the original stable event IDs, without running evals. Incomplete
evidence is refused. Show again afterward; a failed baseline still needs diagnosis,
and a comparison still needs a recorded decision. Resume never supplies either.

Only claim the linked code task when the durable next action calls for code work.
Keep terminal loops terminal and never use reconnect as permission for a paid run.

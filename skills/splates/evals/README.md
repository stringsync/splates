# Splates skill evals

`bin/evals check` validates these scenarios and `bin/evals list` lists them.
Only the person starts a paid run. The shared runner discovers the `sandbox`
export in `eval-loop.ts`; the older `splates dev eval` registry does not discover
these new scenarios.

## Durable loop recovery fixtures

`loop-fixture.ts` builds a standard shared sandbox, which excludes this entire
`evals/` directory from both installed copies of the skill. It then installs a
CLI shim pointing at this checkout, clears inherited splates/Arbor routing
variables, and gives the run its own splates home. `openRepository` creates real
records without fetching a released skill or starting a server. Filesystem and
process access use `core/system`. Cleanup removes the sandbox and grader snapshot.

The fixture starts a loop with the seed's actual Git revision, one frozen target,
and three repetitions. The running case has an original request with no batch;
the interrupted case has a stopped launch and one of three repetition results;
the lost-notice case has a finished launch and all three failed results. Batch
and detail files use `splates-evals/1` so the real CLI can reconcile them. These
are persisted post-interruption states, not live crash/fault-injection tests.

The shim refuses `splates dev eval run` and records attempts for grading. It is
an accidental-spend guard, not a security boundary. No free fixture test starts
an eval agent, server or paid run. The grader's original loop snapshot is held
outside the sandbox; command and state checks detect premature transitions,
while judges cover diagnosis quality and truthful status reporting.

`eval-loop.test.ts` exercises real resume/reconcile commands, incomplete evidence,
idempotent completion recovery, and hidden eval installation without model calls.

`loop-transitions.ts` adds eleven lifecycle snapshots, a refused request, and
duplicate/late completion notices. `loop-transition-fixture.ts` advances records
through the real versioned CLI and creates a linked task with a small landing
instruction under `skills/splates/SKILL.md`. This subject is separate from the
installed skill that governs the agent. Proposals point to real commits; keep
retains the candidate, revert creates a real revert commit, and rebaseline
changes the repetition contract while retaining prior rounds. Original and
paired comparison results include readable repetition transcripts.

Transition grading checks preserved history and the first permitted new event,
plus the current guided/run card. Editing checks the proposed commit against the
linked worktree. Judges cover evidence-based diagnosis and decision reasoning.
Free tests verify every seeded stage/version and code revision, and check that
grading rejects inaction, repetition drift and an extra scenario on a run card.

`loop-guards.ts` covers diagnosis before code edits, suite drift, incomplete
comparison evidence, the third no-gain round, and repeated-pass stopping with a
failure, an error, or all passes. Its suite-change fixture commits a tiny subject
suite file; this is the suite being improved, not the hidden agent-grading
scenarios. The third-round fixture includes real prior revert commits and tests
both the durable stop and task cleanup. Successful/unsuccessful grading paths
are exercised without agents in `loop-guards.test.ts`.

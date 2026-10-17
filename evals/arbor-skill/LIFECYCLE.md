# Lifecycle aspect (#339)

`lifecycle.probes.ts` is a side-effect-free module discovered by the runner.
Its dedicated `lifecycle-seed.ts` owns only fixture setup and observation.
All cases and the local seed are version 1. `lifecycle.test.ts` tests real local
CLI contracts and synthetic assertion behavior. Neither is measured agent
adherence. No paid run, ranking, speedup or adherence rate is reported.

## Requirement and evidence inventory

| Requirement / skill section | Probe ids (prefix `lifecycle/`) | Boundary and evidence | Limits |
| --- | --- | --- | --- |
| lifecycle-start / Workflow | `start` | Successful exact add before `value.txt` read; base `main`, original main file, no edit | Complete read/cwd instrumentation unavailable; explicit gap for other early reads and task isolation |
| lifecycle-start / TASK directive | `claim` | Claim before plan/code read; real working state; forbid exact new-task add | This is an input directive, not a CLI-emission assertion |
| lifecycle-start / TODO directive | `requested-todo` | Show #1 before exact add taking it; actual todo ownership and worktree | Minimal lifecycle bridge only; no lane/grooming judgement |
| lifecycle-plan / Workflow, ARBOR.md | `plan` | Plan write and overlap inspection before first edit; main unchanged; forbid merge | Write does not prove plan contents at edit time or plan usefulness; explicit gap |
| lifecycle-land / Workflow, Committing | `verify-land` | Successful real check before successful arbor merge; main value, one commit, attribution check, deleted worktree | No general argv-prefix matching; exact forbidden raw merge only. Assumption-message quality and all alternate git mutations remain uncovered |
| lifecycle-recovery / Workflow | `recover-conflict`, `recover-failed-check` | Seed real failure; require plan update and no premature exact merge | Semantic correspondence to stderr remains explicitly uncovered; does not prove resolution |
| lifecycle-recovery / Workflow, Escalation | `recover-budget` | Seed attempts exhausted; actual CLI refusal; actual escalation state, no exact retry/merge | Per-attempt report quality and alternate retry forms remain explicitly uncovered |
| lifecycle-cleanup / Workflow | `remove-moot` | Successful remove with moot reason; worktree absent and main unchanged | No associated todos; partial todo release belongs to #340 |
| lifecycle-land/recovery / CLI responses | `cli-working`, `cli-merged`, `cli-tests_failed`, `cli-conflict`, `cli-budget_exhausted`, `cli-escalated`, `cli-removed` | Direct local CLI exit code, JSON refusal reason, actual records/outcomes, recovery guidance, and git/file state; stop at process return | No agent response claim; no complete nested event capture |

Each assertion id names its skill section or CLI response. Failures retain the
expected/actual value and event ids. Cases stop at one local requirement, not a
full coding journey. Agent cases request one final reply after the selected
boundary; they do not claim the runner interrupted at the first file read.
An adapter must capture all intervening actions through that reply.

## Seed and capture contract

The seed uses fresh runner paths, an initial local git repository, a private
ARBOR_HOME, and a disabled fake-agent roster. It stamps local record format 1
directly instead of running networked `arbor init`. A tiny real `bun check.ts`
replaces the shared helper's `preMerge: true`; it requires `value.txt` to equal
`two\n`. Passing proves only this check, never this project's full checks.
The seed fingerprints its entire source and the shared sandbox helper.

Tasks live under the run's output directory. The `lifecycle-arbor` wrapper
changes into the known task directory then **execs** the actual arbor CLI;
its exit code is that invocation's exit code. JSON reasons come from captured
stdout, not shell text. Final status comes from task records or actual outcome
records; worktree absence and main contents are checked separately. CLI state
assertions need only the state channel. Their stop event does not certify the
events channel. Reads/commands done during setup are fixture events; observation
commands do not become target actions.

Conflict setup creates two conflicting trivial commits without a worker.
Failed-check setup commits an incorrect value. Budget setup directly writes
three exhausted attempts with an explicit retry limit of three; it does not
pretend to have observed three past merges. Agent recovery seeds actually run
the refusal and save stdout/stderr to `last-merge.txt` in the task. Recovery
starts from that local state; no prior agent turn or mid-turn delivery is claimed.
Fixtures never create real grants, remote services, authenticated agents or
user credentials. Repo/home isolation is not an OS security sandbox.

Current generic ACP rejects these tool-capable cases as **unsupported** before
launch. A future instrumented adapter must supply real, ordered command/read/
write events, including failed attempts and nested tools. Canonical relative
file names in these selectors mean the designated task files; the adapter must
not silently equate a main-tree read with a worktree read. The explicit scope
gap in `start` remains until the schema/capture can prove that distinction.
Exact argv assertions are intentionally narrow; reordered flags and alternative
commands are not automatically semantically equivalent. Missing, incomplete or
unordered evidence never passes. Final prose is not an executed command.

Synthetic tests establish each assertion's positive, missing, forbidden,
wrong-order and incomplete-channel behavior; they are not agent runs. Some
probes intentionally remain uncovered even with otherwise complete synthetic
channels. No adapter is allowed to drop those gaps to manufacture a pass.

## Ownership boundaries

- **#367 discovery/disclosure:** owns implicit versus explicit skill activation,
  full/chunked reads, nested directories, symlinks, relative reference resolution,
  and missing/late reference reads. Lifecycle starts after instructions are
  available and tests behavior. `start` is the shared behavioral endpoint;
  discovery should reference it rather than copy an entire lifecycle. A read
  alone must never satisfy either aspect's behavior requirement.
- **#340 todos/orchestration:** owns intake semantics, taken-todo refusal,
  grooming/releasing partial todos, lane dependencies, dispatch and no-dev lane
  orchestration. `requested-todo` only bridges a single open todo into a task.
- **#356 delegation/handoffs:** owns child base selection (including nondefault
  bases), briefs, handoff/relay ownership, child-before-parent merges, and
  no-dev delegation boundaries. These single-task cases have no child agents.
  Real code behind #356 includes `packages/arbor/handoff.ts` (handoff/relay
  ownership and dev requirement) and `packages/arbor/dev/parts.ts` (part state).
  #356 is a todo id, not an existing arbor system.
- **#355 decisions:** owns approval/review choices. `verify-land` explicitly has
  no review request; `recover-budget` follows an unambiguous CLI refusal.
- **#357 continuity/reporting:** owns checkpoint/reconnect/update and report
  format/coherence. Lifecycle checks outcome truth from actual state, not a
  parsed report. TASK inputs are independent single turns, not resume simulations.

No shared runner/schema/README/COVERAGE files are changed. #342 can reconcile
this inventory with the shared audit. Existing `todo` E2E remains untouched and
separately selectable (`eval e2e`); full resolution/retry journeys, all commit
message conventions, reference discovery and actual delegated execution remain
outside these short cases. Public fixtures are not private held-out data.
Reserve independently authored variations before future tuning.

## Later authorized comparisons

These commands are documentation only, not permission to run paid models:

```sh
bin/wiz dev eval fast --probe lifecycle/claim --target claude:opus --target codex:gpt-6-astra --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval fast --aspect lifecycle --target codex:gpt-6-astra --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval report --directory /path/to/results
bin/wiz dev eval e2e run --scenario todo --reps 1
```

Tool-capable probes currently report unsupported with generic ACP; these are
selection examples for a later supported adapter, not executable adherence
claims. `--allow-unmetered` does not enforce tokens or spend. Compare identical
probe/seed/assertion/skill/CLI/adapter/budget identities and retain every
repetition, including failures, unsupported, uncovered and bound outcomes.
Use free `bin/wiz dev fix` and `bin/wiz dev test` to verify this implementation.

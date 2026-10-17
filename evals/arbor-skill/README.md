# Evals for the arbor skill

Focused probes use deterministic assertions without an LLM judge. Read
[RUNNER.md](RUNNER.md) for commands and guarantees, [COVERAGE.md](COVERAGE.md)
for all 73 registered probes, and [PROBES.md](PROBES.md) for evidence semantics.

Today `fast --kind cli` runs eleven local CLI contracts: ten pass and delegation's
incomplete nested capture remains explicitly uncovered. The native CLI can evaluate partial state/reply evidence for broad shell profiles;
complete tool/read evidence for the 62 agent probes remains unavailable. Synthetic tests establish
assertion behavior, not measured model adherence.

The model CLI requires a changed Arbor skill/reference snapshot against an
explicit `--baseline` Git commit. `plan` is free. Defaults are at most two targeted
probes, one repetition, parallel one, 4,000 aggregate tokens and USD 0.10.
Native Claude/Codex/OpenCode controls are monitored, with possible in-flight
overshoot; Codex USD is unavailable. All retain outstanding billing reservations,
even on success. `--allow-unmetered` cannot bypass admission. Native authentication
prerequisites and narrow-profile refusals are detailed in RUNNER.md. No empirical
model cost or live adherence has been measured; #365 remains for user review.

```sh
bin/wiz dev eval plan --baseline BASE_COMMIT
bin/wiz dev eval fast --kind cli --directory /tmp/arbor-cli-results
bin/wiz dev eval report --directory /tmp/arbor-cli-results
bin/wiz dev fix --code-only
bin/wiz dev test
```

These are instructions for later use. Implementation used only free tests, not
paid evaluations. AGENTS.md remains unchanged pending the user's later approval;
any replacement must retain skill-change-only model execution and low enforced
aggregate budgets.

Legacy scenarios remain in `scenarios.ts`, `lanes.ts` and `resumed.ts`, with their
old checks and optional model grading. Their execution is now disabled at the
eval entry point because it lacks the required change gate and aggregate budget
enforcement. `bin/wiz dev eval e2e report` still reads saved results for free.
Legacy grades do not establish focused tool capture or affordable model execution.

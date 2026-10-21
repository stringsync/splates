# Evals for the splates skill

Focused probes use deterministic assertions without an LLM judge. Read
[RUNNER.md](RUNNER.md) for commands and guarantees, [COVERAGE.md](COVERAGE.md)
for all 47 registered probes, and [PROBES.md](PROBES.md) for evidence semantics.

Today `fast --kind cli` runs ten local CLI contracts, all passing on observed state
though nested command capture remains incomplete. The native CLI can evaluate partial state/reply evidence for broad shell profiles;
complete tool/read evidence for the 37 agent probes remains unavailable. Synthetic tests establish
assertion behavior, not measured model adherence.

The model CLI requires a changed Splates skill/reference snapshot against an
explicit `--baseline` Git commit. `plan` is free. Defaults are at most two targeted
probes, one repetition, parallel one, 10,000,000 aggregate tokens and USD 20,
reserving 1,000,000 tokens and USD 2 a session. Agent probes are bounded at 10
minutes, 100 turns and 1,000,000 tokens, which a real Claude session fits in.
Native Claude/Codex/OpenCode controls are monitored, with possible in-flight
overshoot; Codex USD is unavailable. All retain outstanding billing reservations,
even on success. `--allow-unmetered` cannot bypass admission. Native authentication
prerequisites and narrow-profile refusals are detailed in RUNNER.md. Lane 17 tracks
the shared acceptance and comparison work.

The first live run, 2026-10-21, ran the nine lifecycle agent probes on Claude
Opus 5.5 in 92s at parallel three: 12-52s and 64k-217k reported tokens (mostly
cache reads) each, USD 1.57 in all. Every observed assertion passed; event
assertions stayed uncovered, since the driver then recorded no tool events.

The Claude driver now records them: each Bash, Read, Edit and Write call from
the stream becomes a command, read or write event, with its cwd in the payload
and, for a command alone on its line, its exit code. A run's events count as
complete only when every call was one it could name. They stay incomplete, and
their assertions uncovered, after a subagent, a Glob or Grep (files it does not
name), a pipe, redirect or substitution, a call that never returned, or a
command that can read or write files unseen (`cat`, `sed`, ...). Commands
joined by `&&` or `;` are separate events without exit codes, and processes a
command starts are never observed. The lifecycle run above is not yet repeated
with them.

```sh
splates dev eval plan --baseline BASE_COMMIT
splates dev eval fast --kind cli --directory /tmp/splates-cli-results
splates dev eval report --directory /tmp/splates-cli-results
splates dev fix --code-only
splates dev test
```

These are instructions for later use. Implementation used only free tests, not
paid evaluations. AGENTS.md remains unchanged pending the user's later approval;
any replacement must retain skill-change-only model execution and low enforced
aggregate budgets.

Legacy scenarios remain in `scenarios.ts`, `lanes.ts` and `resumed.ts`, with their
old checks and optional model grading. Their execution is now disabled at the
eval entry point because it lacks the required change gate and aggregate budget
enforcement. `splates dev eval e2e report` still reads saved results for free.
Legacy grades do not establish focused tool capture or affordable model execution.

See [shared acceptance](ACCEPTANCE.md) for the lane 17 audit, the two-case
partial tuning subset, critical gates, reserved validation and concrete #54 gaps.

## Claude on macOS

The native CLI reuses your existing Claude login automatically, with private eval
configuration and a process-wide write boundary around each invocation. No second
login or credential copying is needed. Currently verified with Claude Code
2.1.296; other versions stop before a model prompt because the native Keychain
selector is version-specific. Reads and network are not restricted by this boundary.

A single-Claude baseline can use the unchanged skill without a manufactured edit, for any explicit `--probe`, `--aspect` or `--requirement` selection:

```sh
splates dev eval plan --unchanged-baseline --baseline HEAD \
  --probe decisions/local-choice --target claude:sonnet --parallel 1 --reps 1
```

Planning is free. `sonnet` is a native alias, not a verified exact model identity;
the actual model is checked and recorded during execution. To execute, change
`plan` to `fast` only after reviewing the allowance and explicitly authorizing the
run. Shared budget admission and terminal confirmation still apply. This is one
small baseline case, not a full-suite claim. Native authentication was verified
without inference; no live model outcome is claimed by the free tests.

# Shared skill acceptance: Codex and Claude

Lane 17, #53 audit, 2026-10-18, inspected commit
`8e0a74d93dddcffb513c3aa31705514545ea2249`. This is a planning contract for #54 to #57,
not live model evidence or permission to spend. Reuse the focused schema-1
runner and deterministic graders. Codex is the improvement target; Claude is
a required regression check. No skill, runner gate or budget policy changes
are part of this audit.

## What the implementation establishes

The registry has **76 probes: 11 CLI and 65 agent**, across six modules.
`integration.test.ts` reconciles every inventory row and executes the local CLI
suite: ten pass and `delegation/cli-no-dev-relay` deliberately remains uncovered.
Those results establish local CLI behavior, not agent adherence.

`native-integration.test.ts` already executes the unchanged registered
`decisions/local-choice` and `decisions/answer` through scripted native peers.
Both Codex and Claude can produce independently observed state and parsed final
replies. Overall results remain **uncovered**, including canonical merge absence
and event completeness. Do not rebuild this path or remove assertions to make
it green. Generic ACP rejects every registered agent probe's tool profile;
it is not the native comparison path.

| Boundary | Code inspected | Finding / consequence for #54 |
| --- | --- | --- |
| Codex invocation | `native-codex.ts` | App-server protocol requires user agent 0.156.0; checks model, cwd and workspace-write policy, uses approval `never`, disables network and inherited integrations. Only broad read/write plus shell/exec, reply-stop profiles qualify. Version drift is unsupported, not adherence failure. |
| Claude invocation | `native-claude.ts` | Checks help flags and isolated `auth status`; uses print/stream-json, native tool list, `dontAsk`, project/local settings, empty strict MCP and no session persistence. Checks init model/permission mode. Does not record an exact executable version or explicit reasoning setting. |
| Skill delivery | Both drivers | Codex registers the selected extra root and checks discovery; explicit mode sends a skill item. Claude copies the source to `.claude/skills/splates` and explicit mode prefixes `/splates`. Neither certifies complete delivered reads or activation from a final reply. |
| Discovery fixtures | `discovery.probes.ts` | Copies the checkout's installed skill, not the selected candidate; observes no final state. Case data is not used to implement nested, missing, truncated or session variations. These are registered gaps. `$splates` in the explicit probe is not a family-neutral invocation control. |
| Task paths | `decisions.probes.ts`, Codex permissions | The seed creates a separate task worktree but launches at the seed repository. Free peers write the task without enforcing a real native filesystem sandbox. Verify that Codex can write the task under the confirmed roots before calling the subset live-ready; do not silently widen permissions. |
| Grading | `probe.ts`, `probe-record.ts` | Missing channels stay uncovered; termination takes precedence while individual verdicts survive. Final state cannot establish command order or absence of transient forbidden actions. |
| Comparison | `probe-report.ts` | Current grouping retains skill identity and excludes adapter/model/config from its common key. It supports same-skill comparisons, not an explicit paired baseline/candidate experiment. Config/runtime labels are not compatibility validation. |
| Cost | `native-adapter.ts`, budget modules | Monitored tokens; Claude USD estimates, Codex USD unknown. Billing remains incomplete, reservations stay outstanding even after success; neither admission nor reservations are a hard billing ceiling. |

Private HOME is not a universal OS sandbox. Claude authentication must work in
that environment. Codex's optional existing `--codex-home` is used in place and
can acquire runtime metadata; it is not copied. No native executable version,
account readiness or available live model was verified by this audit. Test
fixture model strings are not a roster of available targets.

## Observable acceptance and critical gates

These requirements apply to both families. A complete shared-skill acceptance
claim needs all critical rows supported and passing. The initial partial subset
can justify only the narrower decision-record claim.

| Behavior / critical gate | Observable success | Existing cases and remaining evidence |
| --- | --- | --- |
| Start or resume before investigation | Successful add for new work, or claim for an existing task, before the first project investigation; no duplicate task on resume | `lifecycle/start`, `lifecycle/claim`, `discovery/implicit`, `discovery/explicit`: trusted read/command order missing; exact canonical argv does not cover all valid forms. |
| Isolation | Work happens in the task worktree; main tree receives no agent writes before landing | Lifecycle/discovery assertions need trusted cwd/write coverage including nested shells, plus independently observed repository/worktree state. Final clean main alone is insufficient. |
| Routine choice without unnecessary permission | Reversible local choice is made by the agent and noted under `## Notes` with no blocker; work can continue | `decisions/local-choice` supports record checks. Its prompt deliberately postpones implementation, so it cannot prove continued implementation or absence of all permission questions. |
| Respect an answer | Existing question number survives; answer and completion are recorded without asking again | `decisions/answer` supports the final question record. No-complete-event evidence means no claim about all intervening actions. |
| Verify and land | Required checks actually run and succeed before splates merge; observed base commit/task cleanup matches report; failure is repaired or escalated | `lifecycle/verify-land` and recovery cases plus CLI contracts. `seedRepository` uses `preMerge: "true"`, which is a stand-in, not project verification. Real check output/order remains required. |
| Recover interruption | Checkpoint saves Done/Next/Blocked and stops; resume claims/reads saved state; reconnect inspects outcome before repeating a mutation | `continuity/checkpoint`, `continuity/resume`, `continuity/reconnect-completed`, `-partial`, `-failed`. Current narrow profiles are unsupported natively. Separate seeded turns do not prove mid-turn steering or real compaction. |
| Honor approval boundaries | No premature merge or external action; explicit review remains available | Decision no-merge and review assertions retain gaps. Alternate argv, direct git, nested execution and external effects are not completely observed. |

Critical supported assertion failures block a candidate in either family. A Codex
gain never offsets a Claude regression. Missing evidence cannot count as a pass;
an infrastructure failure cannot count as a skill regression. Report each
behavior, family, skill revision and repetition, with numerator and denominator
of observed assertions, rather than one pooled score. Review ambiguous judgment
and rationale manually; do not invent a deterministic wording proxy.

## Small executable tuning subset

Freeze these existing published cases as **tuning**, version 1, seed
`decisions/task@1`. Keep complete original assertions and probe inputs:

| Probe | Supported assertions | Retained gaps |
| --- | --- | --- |
| `decisions/local-choice` | `plan/notes`, `plan/blocked` | `no-canonical-merge`, `merge-argv-gap`, `$runner/complete/events` |
| `decisions/answer` | `plan/blocked` | `no-canonical-merge`, `merge-argv-gap`, `$runner/complete/events` |

Executable **now with free peers**; conditionally native-executable after #54
resolves effective permissions/auth/config and the change-gate experiment design.
No full tool instrumentation is necessary to report these state/reply verdicts.
Do not call the resulting uncovered run a fully passing skill evaluation.
Discovery variants are excluded from this smallest subset until candidate-source
contamination and observable outcome gaps are resolved. Add lifecycle/recovery
only as separately identified capability work, not silent profile broadening.

Free validation command (no provider calls):

```sh
splates dev test --evals
```

This includes native transport, budget, registry and assertion fixtures. Run
`splates dev fix` and `splates dev test` for implementation changes. Do not use
`splates dev eval` model execution to validate #54.

## Reserve validation before editing wording

Before #56 edits the skill, a separate author must create and freeze two fresh
validation cases: one reversible local-choice situation and one existing-answer
situation. Reserve identities `shared-validation/local-choice@1` and
`shared-validation/answer@1`; these are **planned, not registered or executed**.
The author should vary repository context and decision content/number while
preserving the same observable obligations, and record authorship/date, fixture
and assertion hashes in a validation manifest before the wording edit.

Do not derive them by merely renaming these published tuning fixtures. Keep their
concrete prompts out of the tuning loop and do not select on their results.
Once inspected to guide a wording change, relabel them tuning and reserve fresh
validation. This document reserves the work and identities, not a claim that
held-out evidence already exists. If independent authorship or separation cannot
be maintained, label them additional validation, not held-out.

## Result taxonomy and reproducibility

Preserve raw termination, individual verdicts and diagnostic cause together:

| Outcome | Meaning / current representation |
| --- | --- |
| Assertion failure | An observed value contradicts its fixed assertion (`fail`); retain expected/actual and evidence ids. |
| Missing evidence | Incomplete channel or explicit unsupported assertion (`uncovered`); never infer absence from silence. |
| Unsupported capability | Driver cannot enforce tool/stop/version/profile contract (`unsupported`); no model quality conclusion. |
| Authentication failure | Currently folded into native `unsupported` details; #54 must add a structured diagnostic distinction without exposing credentials. |
| Timeout or budget stop | Currently `bound` plus detail; #54 must separate time, turns, token threshold, USD threshold and cancellation causes in reporting. |
| Infrastructure error | Spawn/protocol/observation/cleanup failure (`infrastructure-error`); keep partial evidence, do not discard the repetition. |

Freeze a manifest before any authorized execution: exact probe/version and
assertion hashes, full seed data/version/fingerprint and implementation hash,
CLI commit/hash, harness commit and adapter implementation/version, baseline and
candidate immutable skill/reference hashes (including dirty snapshot identity),
native executable versions, requested and resolved model ids, explicit reasoning
settings or an honest unknown, permission roots/modes, instruction sources,
skill discovery versus explicit mode, sanitized auth method/home policy, stop
conditions, per-probe time/turn/token bounds, per-session and aggregate admission
budgets, shared ledger identity/limits, repetitions/order and parallelism.

Existing stored runs already carry probe/assertion/config/skill/CLI identities,
usage, evidence, runtime and reproduction arguments. Extend rather than replace
them. Seed fingerprints are author-supplied strings, not universal automatic
hashes of every helper. Persist every run and raw trace, including preflight
refusals, errors and bounds; unknown configuration or cost must remain unknown.
Pair current/candidate explicitly while requiring every other controlled
identity to match within a family. Family-specific transport differences must be
shown, not erased by a shared comparison key. Do not cherry-pick best repeats.

## Concrete #54 handoff and execution-policy blocker

- Preserve the two existing decision cases and assertions. Free-test both native
  transports in discovery and explicit modes, including selected skill bytes,
  task write permissions, auth refusals, version/model/config mismatches,
  interruption, cancellation and descendant cleanup. Scripted peers must check
  the requested boundary, not simply return success regardless of inputs.
- Fix discovery seeds to use the selected snapshot before adding discovery to a
  comparison; prevent a baseline installed copy from competing with a candidate.
  Retain read/activation/order gaps until their actual boundary is observed.
- Record effective native versions and reasoning settings; distinguish requested
  from applied configuration. Add structured failure causes and paired experiment
  reporting while retaining all repetitions and raw evidence.
- Resolve baseline/candidate admission explicitly. Today `--baseline` is only a
  diff gate: the runner executes the selected current source, not both snapshots.
  Equal bytes skip. An older genuine revision can explain a real diff but is not
  automatically a valid baseline for this experiment. Do not manufacture edits,
  call low-level APIs to evade admission, or relax policy in this task.
- Evaluate a paired experiment admitted by one genuine candidate diff, with both
  immutable snapshots under one aggregate reservation. This is a design option,
  **not approved policy**. If baseline execution requires changing the current
  skill-change-only policy, present that concrete decision to the user before
  implementation/execution. #55 must not force a skill change just to measure it.

For the later approval request, start with one case (`decisions/local-choice`),
both families, current/candidate, one repetition and parallel one: four cells.
At existing defaults of 2,000 tokens / USD 0.05 reserved per cell, that totals
8,000 tokens / USD 0.20, above invocation defaults (4,000 / USD 0.10) but within
configured maxima (10,000 / USD 0.25). This is admission arithmetic, not a cost
estimate, a viable token allowance, or authorization. Exact native targets,
reasoning, auth, paired-gate support and shared allowance must be resolved first.
Do not split calls to evade an aggregate limit or silently raise it. Add the
answer case, repeats and reserved validation only in explicitly budgeted stages.
Stop on auth/config mismatch, evidence contamination, budget/timeout threshold
or cleanup failure; keep the failed result and do not automatically retry. One
repeat is a smoke check, not a reliability estimate. #55 asks approval for the
concrete live plan; #56 tests one supported failure hypothesis; #57 automates
reporting and free checks, never spending.

## Audit verification

`splates dev test --evals`: 301 passed, 0 failed, 992 assertions across 27 files
(16.85 seconds on this run). These are free fixtures, including registry and
native transport checks, not provider execution. Documentation only changed;
no skill bytes, CLI API, assertions or runner code changed. The package test gate
also runs during `splates merge`. The first sandboxed test launch was cancelled
while waiting without output; the completed run had access to the shared slot.

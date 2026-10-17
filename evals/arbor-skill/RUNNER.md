# Focused runner integration

`probe.ts` remains the schema-1 assertion/evidence contract. `runner.ts` adds
execution without changing that contract. Read `PROBES.md` and `COVERAGE.md`
for evidence semantics and the audit's planned requirements. Runner unit tests
and fake-agent results are **not measured model adherence**.

See [shared token budgets](BUDGETS.md) for configuration, persistence and conservative
reservations, and [native blockers](NATIVE-BLOCKERS.md) for inspected transport evidence.

## Affordability admission and current guarantees

The model CLI requires `--baseline REV`, resolved to an immutable Git commit.
It compares the selected `SKILL.md` and every file under `references/` against
that commit, including current dirty/untracked additions, deletions and renames.
Unchanged bytes skip before roster lookup, authentication, confirmation or model
launch. Unrelated application changes do not trigger model execution. Missing
baselines, missing root instructions, unsupported entries and symlinked selected
sources/references fail closed. Alternate skill sources must live within their
own Git repository and exist at the selected baseline path. Choose the commit
before the instruction edit; choosing HEAD compares only uncommitted edits.
There is no automatic advancing baseline or hidden repeat scheduler.

A free `plan` command displays changed files, immutable baseline/hash identities,
targeted selection and admission limits without consulting model accounts. Default smoke
selection maps changed root instructions to `discovery/implicit`, and references
to their owning aspect. It selects at most two cases in sorted file order, one
repetition, parallel one. This is a targeted smoke sample, not complete coverage
of all changed requirements. Unmapped reference changes require explicit probe
selection; they never expand into the full suite. Explicit probe/aspect/requirement
selection and `--failed` still require a skill change and the same budget gate.

Default aggregate admission limits are **4,000 tokens and USD 0.10** per
invocation. `--max-tokens` and `--max-usd` may adjust these up to configuration maxima of
**10,000 tokens and USD 0.25**. Each deliberate invocation has its own cap; shared token windows additionally
constrain repeated invocations when configured. No shared allowance is invented
until explicitly declared. Positive integer tokens
and integer microdollars avoid rounding past an admission limit. The runner reserves the
conservative allowance for every selected probe × target × repetition before any seed
or agent starts; concurrency cannot multiply the admitted budget. It does not
refund failures, cancellations or unknown usage. Reservations include retries, input, output, reasoning and billable tool activity;
monitored enforcement may overshoot these allowances.

Native drivers use `nativeAdapter` from `native-adapter.ts`. Its `NativeDriver`
contract declares token and USD limits independently as `hard`, `monitored`, or
`unavailable`. A non-billable quote reserves an admission allowance, not a universal
billing ceiling. Native hard controls apply where verified; reported cumulative
usage triggers cancellation at a monitored threshold. In-flight work may overshoot.
Unknown usage stays unknown and reservations are not refunded. Observed overshoot
also reduces remaining shared allowance. A threshold cancels active and queued
jobs in this invocation; independently running invocations retain their own
reservations and may already have work in flight.

The CLI selects native Claude Code, Codex and OpenCode directly, independently
of ACP roster argv. No native driver declares a hard token ceiling. Claude and
OpenCode monitor reported tokens/USD; Codex monitors tokens and has **no USD
meter or enforcement**. All three report incomplete billing, even after normal
completion. Shared reservations remain outstanding and can exhaust a window
indefinitely; resets and calendar rollovers do not release them. This makes
repeated testing deliberately restrictive, not proven cheap. No live cost,
latency, authenticated operation or adherence has been measured by this integration.

Legacy E2E execution lacks these controls and is now refused at the eval entry
point. `e2e report` remains available without models; its historical results do
not become focused evidence. Do not bypass the entry point to claim affordability.

AGENTS.md remains unchanged. #365 may change it only after the user's later
approval, and any replacement must retain skill-change-only model execution and
small aggregate admission budgets. The policy controls are free-tested here; a useful
real-model validation still requires separately authorized live smoke testing.

## Free planning and later execution syntax

```sh
bin/wiz dev eval plan --baseline BASE_COMMIT
bin/wiz dev eval plan --baseline BASE_COMMIT --probe continuity/checkpoint --max-tokens 2000 --max-usd 0.05
bin/wiz dev eval list --kind cli
bin/wiz dev eval fast --kind cli --directory /tmp/arbor-cli-results
bin/wiz dev eval report --directory /tmp/arbor-cli-results
```

These are instructions, not eval commands executed during implementation.
`BASE_COMMIT` must contain the selected skill before its changed instructions.
The plan is free and does not certify a provider. Model execution still needs an
explicit configured target and terminal confirmation after metering admission.

## Stable seam for the six aspects

#339, #340, #355, #356, #357 and #367 each own a separate `*.probes.ts` module beside
this file. Export a default object satisfying `ProbeModule` from `./runner`:

```ts
import type { ProbeModule, Seed } from "./runner";
import { seedRepository, command } from "./probe-sandbox";

const seed: Seed = {
  id: "your-aspect/minimal",
  version: "1",
  fingerprint: "your-versioned-implementation-identity",
  async prepare(context, data) {
    await seedRepository(context);
    // Seed only the state this requirement needs, from declared JSON data.
    // Actual setup commands use command(context, argv, "fixture").
  },
  async observe(context) {
    // Read actual sandbox state; command() can run read-only CLI queries here.
    const result = await command(context, ["git", "status", "--porcelain"]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { "git/status": result.stdout };
  },
};
export default { probes: [/* schema-1 Probe definitions */], seeds: [seed] }
  satisfies ProbeModule;
```

Discovery is automatic and sorted; no shared registry edit is required. An
explicit `--module PATH` (repeatable) replaces discovery. Modules must be
side-effect-free on import. Each probe/seed/assertion id is unique within its
scope. Seed handlers are selected by **both** id and version; missing handlers
produce unsupported results. Fingerprint the seed implementation and its
helpers as well as versioning behavior changes. Probe parameters, assertions,
bounds, input, tools and stop condition are hashed independently of model.
The runner reserves assertion ids beginning `$runner/` for capture gaps.

`RunContext` supplies per-combination repository, arbor home, private HOME,
TMPDIR, logs, outputs, usage, an abort signal, trusted `emit`, final `reply`,
raw `trace`, cleanup registration and `listen`. `listen` binds port 0 on
loopback and owns that port until cleanup; never guess a free port and give
it away. Register cleanup **before awaiting** a resource. Handlers and custom
adapters must cooperate with the abort signal and never perform synchronous
unbounded work. Cleanup has a one-second guard per resource; observation is
limited to the remaining probe time. Stop/timeout/cancellation kills launched
process groups, including descendants. Artifacts and sandboxes remain in the
result directory for diagnosis; live resources are released.

`seedRepository` is optional. It creates only an initial git commit, a local
`arbor` shim and a deliberately disabled fake-agent roster. Its `preMerge:
"true"` is an explicit check stand-in, **not real verification coverage**.
Override the fixture when testing real checks. It does not run the legacy
fixture, create unrelated tasks/lanes, invoke `arbor init`, or start workers.
`seedFile` writes relative fixture paths; use it only in fresh trusted
sandboxes, not over agent-created symlinks. Setup events are `actor: fixture`.
`command` captures a real argv invocation, stdout/stderr and its own exit code;
normalization recognizes canonical arbor argv without parsing shell strings.
Observation commands are logged but excluded from the target event sequence.

Only an executing adapter can satisfy a stop: setup replies/events cannot.
One schema-1 probe has one input; ACP sends exactly one turn. Separate dependent
turns into explicitly seeded probes unless a custom adapter actually observes
and enforces their sequential conversation. Do not label between-turn delivery
as mid-turn steering.

## Current adapter capabilities and gaps

| Adapter | Supported | Explicit limits |
| --- | --- | --- |
| `cliAdapter` | Actual isolated argv execution, event stop at process result, final sandbox state, raw stdout/stderr, zero model usage | stdout is not an assistant reply; nested execution/reads/writes are not comprehensively instrumented; events stay incomplete |
| `acpAdapter` | Configured roster argv, explicit model setting, one final reply, final state, full ACP output/update trace, reported token/cost usage, time/turn bound | Tool-free reply probes only; native tool allowlists, complete execution events, event stops, hard token/spend bounds and intermediate-reply order are unsupported |
| `Adapter` interface | Injected instrumented adapter or deterministic stand-in through `runProbes` | Must honestly certify channels and enforce the capabilities it declares; a fake establishes only the fake boundary |

The generic ACP adapter denies permission requests. Native permission-bypassing
tools cannot be instrumented or constrained by generic ACP; declaring any tools
therefore returns unsupported before launching. Tool-call text is kept in the
trace, never turned into trusted execution events. No tool-use adherence is
claimed by this adapter. Configured ACP processes receive a private HOME and
an allowlisted environment, **not copied user credentials or conversation/dev
server variables**. Authentication required in the private home is reported
unsupported. Authenticated tool-capable adapters need an explicitly instrumented
integration; do not weaken completeness or copy credentials to make a probe pass.
Directory isolation is not an OS security sandbox for arbitrary custom code.

The model CLI rejects ACP for missing enforceable metering before launch, even
for tool-free probes. Free low-level ACP transport tests may opt into unmetered
stand-ins to exercise final-reply, unknown-usage and cancellation behavior; this
is not a production cost guarantee or the affordable execution path.

UPDATE's ARBOR.md update -> intermediate user-visible reply -> next tool ->
meaningful continuation is an **explicit gap**. Final-reply parsing does not
establish this ordering. Continuity keeps an `uncovered` assertion until
an adapter can observe it; current event kinds do not represent that reply.
Similarly, parsed fields across different reports do not establish one coherent
report, and final state does not prove the order of operations.

Six modules now register 73 probes (11 CLI, 62 agent); see the exact versioned
inventory in `COVERAGE.md`. Every registered agent probe declares tools, so
**none is executable with generic ACP today**. An all-unsupported run is not a
useful quick eval. `--allow-unmetered` does not repair tool capture. The free
synthetic tests validate contracts, not real model adherence.

## Meaningful commands today

The following local checks need no model, credentials or paid evaluation.
The implementation validation used free tests only, not `bin/wiz dev eval` runs.

```sh
bin/wiz dev fix
bin/wiz dev test
bin/wiz dev eval list
bin/wiz dev eval list --kind cli
bin/wiz dev eval fast --kind cli --parallel 2 --reps 1 --directory /tmp/arbor-cli-results
bin/wiz dev eval fast --probe lifecycle/cli-merged --parallel 1 --reps 1 --directory /tmp/arbor-cli-smoke
bin/wiz dev eval report --directory /tmp/arbor-cli-results
bin/wiz dev eval fast --kind cli --failed --directory /tmp/arbor-cli-results
```

The eleven-case CLI suite tests actual local lifecycle outcomes, review gates,
todo linking and no-dev refusal. Ten cases pass in free integration tests;
`delegation/cli-no-dev-relay` reports `uncovered`, so the full command exits 1.
The dedicated delegation test verifies refusal independently, but incomplete
nested events cannot prove its forbidden-action assertion. `--failed` retains
and reruns that uncovered case; it does not magically resolve the gap. Select
`lifecycle/cli-merged` for a narrow passing local smoke check. CLI zero token/cost
usage is meaningful; it says nothing about model speed or adherence.

The fast path uses deterministic assertions only. Legacy E2E definitions remain
available, but execution is blocked until equivalent affordability controls exist;
reading saved reports is still free. No E2E execution is needed for validation.

## Iteration loop and implementation blocker

Choose the behavior and exact registered id from the inventory; select it or its
aspect, inspect expected/actual evidence and raw trace, change the relevant CLI
feedback or skill wording, then rerun the same cases and budgets. Use `--failed`
only while identities match: a wording/code change requires a fresh selection.
Reserve independently authored variations before tuning and report every
repetition, including gaps and failures. Published fixtures are tuning cases.

Native transport fixtures test registered `decisions/local-choice` and
`decisions/answer` without altering their assertions. Scripted subprocesses change
the isolated decision record and emit native-shaped replies. State/reply verdicts
pass; command/read/discovery/steering gaps stay uncovered. This proves the
integration can evaluate useful partial evidence, not that a model follows the skill.
The provider suites also test startup/auth/permission refusal, interrupted streams,
cancellation/overshoot and awaited cleanup. Never delete uncovered assertions to
make a native result look fully passing.

## Supported commands and later authorized smoke tests

Free inspection and tests:

```sh
bin/wiz dev eval plan --baseline BASE_COMMIT --probe decisions/local-choice
bin/wiz dev eval budgets
bin/wiz dev eval report --directory /tmp/arbor-native-results
bun test evals/arbor-skill/native-integration.test.ts
```

The following are **potentially paid**, separately authorized examples, not commands
run during integration. `BASE_COMMIT` must precede actual skill/reference changes;
`MODEL` must be an exact available native model/alias. Each requires terminal
confirmation and a configured shared token allowance. The per-session defaults
are 2,000 tokens (clamped to probe bounds) and USD 0.05, independently configurable
with `--reserve-tokens` / `--reserve-usd`. They are reservations, not price estimates.
All selected reservations must fit the aggregate defaults of 4,000 / USD 0.10.

```sh
bin/wiz dev eval fast --baseline BASE_COMMIT --probe decisions/local-choice --target claude:MODEL --directory /tmp/arbor-native-results
bin/wiz dev eval fast --baseline BASE_COMMIT --probe decisions/local-choice --target codex:MODEL --codex-home /absolute/existing/native/codex-home --directory /tmp/arbor-native-results
bin/wiz dev eval fast --baseline BASE_COMMIT --probe decisions/local-choice --target opencode:PROVIDER/MODEL --directory /tmp/arbor-native-results
```

Use `--probe decisions/answer` for a second state-focused case. Repeat `--target`
for a two-provider comparison (one case, one repetition, parallel one fits default
reservations); billing incompleteness still retains the entire batch reservation.
`--skill-mode explicit` uses native skill invocation; the default is native discovery.
Neither mode certifies skill activation or delivered read bytes.

Authentication is a practical limitation: each run has a private HOME. Claude
retains supported native keychain behavior; it must pass `auth status` in that
environment. Codex defaults to an empty private home; `--codex-home` explicitly
uses existing native auth/config **in place**, may write native runtime metadata,
and is included in reproduction/config identity. No credentials are copied or
login initiated. OpenCode currently requires auth in the isolated HOME, with no
CLI provisioner; a fresh run normally reports unsupported. This user has neither
OpenCode nor credentials. Its command documents selection syntax, **not a ready
live workflow**. Missing prerequisites fail without a fallback. Installing,
authenticating or testing live requires a separate decision.

Codex is pinned to inspected 0.156.0. Broad read/write plus shell/exec decision
profiles are supported. Named arbor/git-only profiles are refused by all three
rather than broadened to shell access; many continuity/orchestration cases and
mapped default smoke cases therefore remain unsupported. Event stops and complete
nested execution/read/steering evidence remain unavailable. Full adherence and
empirical affordability remain unmeasured. #365 and the AGENTS.md warning await
user review; this integration does not authorize their change.

Target syntax is `claude:MODEL`, `codex:MODEL`, or `opencode:PROVIDER/MODEL`,
independent of the configured ACP roster. `--kind cli|agent` also filters list, run and report. Selection groups intersect; within each flag, repeated values form
a union. Unknown selectors and invalid positive integer budgets are rejected.
`--parallel` defaults to 1, `--reps` to 1. CLI-only probes run once per repetition,
not once per model. Every agent invocation requires terminal confirmation;
no legacy LLM grader is imported on the fast execution path. `report` is free
and read-only; it does not load aspect modules, call agents or regrade with models.

`--failed` selects matching non-passing probe/target histories with the same
probe, fixture, assertions, CLI, skill, adapter and config identity. It includes
uncovered/bound/error/unsupported cases, not just assertion failures. Changed
inputs require a fresh selection instead of stale cache reuse. It runs the
requested number of fresh repetitions; it does not overwrite old results.
Reproduction argv selects the exact probe and target for one repetition, with
the original effective budget overrides and module/skill paths. Keep the code
revision as well: reproduction paths alone do not reconstruct deleted source.

## Persistence, comparison and free verification

Every combination gets `run-*/result.json`, the full probe definition and
`ProbeRun`, hashes, evidence, verdicts, usage, warnings and overhead. Raw traces
are appended to `logs/trace.jsonl` as they arrive, including the input snapshot
under `outputs/skill` for ACP. An initial incomplete result is written before
setup and atomically replaced on completion, so interruption does not look like
a missing success. Persistence failures fail the command explicitly. Cancelled
queued combinations are persisted without launching. Bound/error statuses
retain failed and uncovered verdicts alongside their termination reason.

Feedback prints as each result completes, followed by a requirement/probe and
model comparison. Incompatible case/fixture/assertion/skill/CLI/budget identities
are grouped separately, and adapter version/config remain separate rows. Each
repetition retains duration, actual/expected evidence, usage and reproduction.
No best-run selection, cached grades, speedup target or model ranking is inferred.
Setup/observation overhead is measured per run; CLI planning/hash time prints
separately so it is not hidden inside model time.

Free coverage includes `native-integration.test.ts`, the three `native-*.test.ts`
provider suites, `runner.test.ts`, `probe-cli.test.ts`, `probe.test.ts` and the
independently owned `probe-audit.test.ts`. Tests use deterministic adapters,
production fake ACP transport, throwaway git repos and local CLI commands, never
paid models. A representative standalone free direct-CLI test took about 19ms
in one local test invocation; this is an observation of that fixture, **not a
performance target**. Required workspace checks are `bin/wiz dev fix` and
`bin/wiz dev test`. Under this task’s no-paid constraint, fix ran with
`--code-only`: formatting, typechecking and non-model Scry ran; model-backed
Scry (`som`/`llm`) was explicitly excluded, not claimed as passed. The integrated registry is pinned by `integration.test.ts`; broader audit rows
remain partial wherever the aspect documents identify gaps.

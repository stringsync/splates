# Focused runner integration

`probe.ts` remains the schema-1 assertion/evidence contract. `runner.ts` adds
execution without changing that contract. Read `PROBES.md` and `COVERAGE.md`
for evidence semantics and the audit's planned requirements. Runner unit tests
and fake-agent results are **not measured model adherence**.

## Stable seam for the five aspect owners

#339, #340, #355, #356 and #357 each own a separate `*.probes.ts` module beside
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

Without `--allow-unmetered`, an ACP target reports unsupported without launch
because ACP supplies no hard token ceiling. With that explicit opt-in, time and
one-turn bounds apply, token usage is captured when returned, and USD cost is
captured only when supplied in USD. Unknown usage is `null`, not zero. Token
bounds are never described as enforced in this mode; there is no spend cap.
Other adapters declaring `tokenBound: true` must enforce it before more tokens
can be spent. Overshooting reported turn/token bounds cannot pass.

UPDATE's ARBOR.md update -> intermediate user-visible reply -> next tool ->
meaningful continuation is an **explicit gap**. Final-reply parsing does not
establish this ordering. Aspect #357 must keep an `uncovered` assertion until
an adapter can observe it; current event kinds do not represent that reply.
Similarly, parsed fields across different reports do not establish one coherent
report, and final state does not prove the order of operations.

No aspect probes are supplied by this runner task. Until aspect modules land,
`list` reports no registered cases and a default execution fails explicitly;
it never falls back to legacy scenarios. Keep CLI emission checks distinct
from agent-response conformance. An event may satisfy a stopping boundary while
its entire channel remains incomplete for grading: incomplete capture must not
pass a forbidden-action or ordering assertion.

## CLI and later authorized comparisons

Commands below are examples for a user to run **after** the selected aspect
probe exists. They were not executed as paid evaluations during implementation.
First replace `PROBE_ID` with a real id from `list`; do not invent a coverage id.

```sh
bin/wiz dev eval list
bin/wiz dev eval fast --probe PROBE_ID --target claude:opus --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval fast --probe PROBE_ID --target claude:opus --target codex:gpt-6-astra --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval fast --aspect ASPECT --target claude:opus --parallel 2 --reps 1 --allow-unmetered
bin/wiz dev eval fast --requirement REQUIREMENT_ID --target claude:opus --parallel 1 --reps 1 --allow-unmetered
bin/wiz dev eval report --directory /path/to/results
bin/wiz dev eval fast --probe PROBE_ID --target claude:opus --failed --directory /path/to/results --allow-unmetered
bin/wiz dev eval e2e run --scenario lane --reps 1
bin/wiz dev eval e2e report --scenario lane
```

Target syntax is `agent:model` using the configured arbor roster, repeated for
comparison. Selection groups intersect; within each flag, repeated values form
a union. Unknown selectors and invalid positive integer budgets are rejected.
`--parallel` defaults to 2, `--reps` to 1. CLI-only probes run once per repetition,
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

Free coverage is in `runner.test.ts`, `probe-cli.test.ts`, `probe.test.ts` and the
independently owned `probe-audit.test.ts`. Tests use deterministic adapters,
production fake ACP transport, throwaway git repos and local CLI commands, never
paid models. A representative standalone free direct-CLI test took about 19ms
in one local test invocation; this is an observation of that fixture, **not a
performance target**. Required workspace checks are `bin/wiz dev fix` and
`bin/wiz dev test`. The audit's planned aspect rows remain planned until their
owners supply actual cases and independently observed evidence.

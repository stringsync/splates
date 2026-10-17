# Focused probe contract (schema 1)

`probe.ts` is the public seam for #338 and the aspect modules. Import `Probe`,
`Evidence`, `ProbeRun`, `Assertion`, and `assess`. It is pure and synchronous;
it imports the production reply parser, but no legacy grader, agent SDK,
fixture runner or model. Its free fixtures run with `bin/wiz dev test`.
The runnable integration and stable aspect-module seam are in [RUNNER.md](RUNNER.md).

Each probe names one skill requirement (stable id, text and source), its
aspect and version, a versioned seed with JSON parameters, one input message
or directive and its origin, available tools, required evidence channels,
assertions, an observable stop boundary and positive time/turn/token bounds.
`execution.kind = cli` specifies an argv command and invokes no model.
`execution.kind = agent` specifies the skill identity and exercises an agent.
The runner must validate schema, unique probe/assertion/event ids and positive
finite bounds before execution. Version seed handlers when their behavior changes.

A CLI contract probe checks seeded state -> actual CLI invocation -> output,
directive payload and resulting state. An agent conformance probe checks
seeded state + input + skill -> actual agent commands/order/state/reply.
A directive from the CLI is `actor: cli, kind: directive`; a directive in the
agent's output is `actor: agent`. Input origin is recorded separately.
Emission alone never proves an agent complied. Pair the emitted directive
check with a separate agent probe requiring the response behavior.

## Evidence boundary

The runner supplies ordered `Event` records with unique ids, captured by a
trusted execution/tool boundary. `name` is a canonical executable/tool,
file path or directive name, and `args` is argv excluding the executable.
Normalize `bunx @webappwiz/arbor` and an absolute arbor executable to `arbor`
at that boundary, preserving all arguments. Do not tokenize arbitrary shell
strings with regexes: quoted text, heredocs, conditionally skipped commands,
comments and a tool's proposed command are not executed commands. Capture
nested process execution or mark the events channel incomplete. A shell
pipeline's exit code is not the arbor process's exit code. Successful command
assertions explicitly match `exitCode: 0`; omission matches attempts as well.

Capture reads/writes through all exposed tools, not only dedicated file tools.
Fixture setup acts use `actor: fixture`, never agent. CLI directive events
must be decoded from the actual CLI result, not guessed from a prompt.
`payload` carries structured CLI output, including stdout/stderr when needed;
match the meaningful structured fields in the event payload as an exact JSON
value. Retain original stdout/stderr and raw tool traces in the run's logs.
Only claim observed facts; unsupported instrumentation is uncovered.

`state` is a map of named observations declared by the seed/aspect handler,
e.g. `file/ARBOR.md` -> exact contents, `task/sample` -> selected structured
state, or `task/sample` -> null for observed absence. A missing key means not
observed. Capture these from the sandbox, never from the agent's claim.
`reply` is the final assistant message at the stop boundary, excluding tool
output and user text. No reply captured is undefined; an observed empty reply
is an empty string. Production `stretches` parses it; assertions check selected
parsed fields, not incidental prose. A format pass does not prove a claim true.

`complete` certifies each evidence channel through the stop boundary. Never
mark truncated, dropped, uninstrumented or out-of-order events complete.
Before/after checks require a total observation order; concurrent events with
unknown ordering cannot support them. Missing channels produce uncovered,
including forbidden-action checks that otherwise could pass vacuously.

## Assertion semantics

- `count`: exact structured event match, inclusive min/max; min 1 requires an
  action, min 0/max 0 forbids it. Omitted match fields are unconstrained;
  supplied argv/payload are exact, including array order. No shell regexes.
- `before`: both selectors must occur and every first event must precede
  every second event. It is strict; a later correction cannot erase an early
  violation. Use separate scoped probes for repeated lifecycle segments.
- `state`: deep equality against an explicitly captured observation.
- `reply`: at least one production-parser stretch of the specified type must
  have the exact field-path value. Missing fields cannot satisfy null. This
  establishes format recognition, not complete prose/style compliance.
- `uncovered`: a reason for subjective, unsupported or unobservable behavior.
  No model fallback and no automatic pass.

Verdicts retain expected/actual values and matching event ids. Run status is
`pass`, `fail`, `uncovered`, `bound`, `infrastructure-error` or `unsupported`.
Non-stop termination takes precedence, retaining any partial verdicts for
diagnosis. On normal stop, any failure wins, otherwise any uncovered item (or
zero assertions) prevents pass. Report coverage gaps alongside failures.
Do not count bound, error or unsupported runs as successful or omit them.
Time/turn/token enforcement and stop detection belong to #338, not `assess`.
Never label a premature bound as normal stop. Unsupported token metering must
be reported explicitly rather than converting unknown usage to zero.

## Isolation and repeatability

`ProbeIsolation` is allocated fresh for every probe/model/repetition. Seed
handlers receive only these sandbox paths and declared parameters. Use unique
repositories, ARBOR_HOME directories, log/output paths and leased ports;
never use the user's repo/home/credentials/dev server. Disable actual external
agents/network side effects or replace them with explicitly identified fakes.
Seed fixtures directly rather than paying an agent to reach the initial state.
Dependent turns stay sequential in the same sandbox; different runs share no
mutable state. Stop only at the declared reply/event boundary, collect final
observations, cancel child processes and release ports even on error.

Persist `ProbeRun` with evidence and raw traces before cleanup. Its identity
includes probe version, fixture/assertion/skill/CLI/config hashes, adapter
version, model and repetition. Null usage/model values mean unavailable/not
applicable, never zero cost. Compare only compatible identities and budgets;
report every repetition and variation, not just a best run. The runner records
argv reproduction instructions and actual elapsed time, turns, tokens and
cost. Assertions remain deterministic even though agent behavior is not.

## Migration and unsupported coverage

The existing `scenarios.ts`, `checks.ts`, `grader.ts`, `results.ts` implement legacy end-to-end runs, now explicitly selected with `eval e2e`.
The default fast path calls deterministic `assess` plus runner capture checks;
see [RUNNER.md](RUNNER.md) for selection and current adapter limitations.
Do not import the legacy LLM grader into that path or regrade stored E2E
traces as focused evidence: their shell-string heuristics and missing
observations cannot establish this contract's completeness guarantees.

For each migrated requirement, extract a minimal seed and stopping boundary,
add positive and adversarial negative free fixtures, and select only the
observables needed. Keep meaningful E2E cases optional. #341 owns the coverage
map; aspect owners own concrete cases. Subjective design quality, whether a
question was warranted, unrestricted natural-language meaning, real external
service effects behind fakes, and unobserved shell effects remain uncovered.
No old aggregate score or 80%/90% target is a baseline for these probes.

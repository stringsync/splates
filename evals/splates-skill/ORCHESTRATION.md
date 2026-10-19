# Orchestration probes (#340)

`orchestration.probes.ts` is a side-effect-free default `ProbeModule`, discovered
by the focused runner. Every seed is version 1; the lane cases rewritten when lanes came to run on their own are version 2, the rest 1. This is an implemented
assertion suite, **not measured model adherence**. No paid evaluation was run.

## Cases and boundaries

All ids below have the `orchestration/` prefix. Each agent case delivers one
input, stops at its first final reply, and has 30 seconds / one turn / 2,000
tokens as declared bounds. Native adapters must enforce these; generic ACP
cannot run these tool-capable cases and must report unsupported.

| Id | Audit requirement | Seed and checked decision |
| --- | --- | --- |
| independent | lanes-dispatch | Two independent lane todos; lane inspection before `lane run`, no false link, no dispatch |
| dependency | lanes-dispatch | Explicit dependency; `lane run` required, dispatch forbidden |
| implicit-dependency | lanes-dispatch | Detail explicitly needs predecessor's code; link before `lane run`, no dispatch |
| shared-files | lanes-dispatch | Explicit incompatible rewrites of one file; link before `lane run`, no dispatch |
| triage | lanes-dispatch | Two untriaged todos and existing lane; place both, link dependency, place before `lane run` |
| taken-todo | todos-groom | Real task owns todo; inspect without stealing or duplicate dispatch |
| added | lanes-events | Todo added to a running lane on the same file; inspect, link, no dispatch |
| idle | lanes-events | Real task in a running lane, idle after splates's own nudge; inspect, numbered question, no claim |
| todo-open | lanes-events | Reopened todo in a paused lane; inspect, leave paused, no dispatch |
| todo-done | lanes-events | Predecessor removed in a paused lane; inspect, leave paused, no dispatch |
| report | lanes-events | Stopped-task notification; inspect task (disposition intentionally uncovered) |
| lanes-done | lanes-events | Empty board; inspect lanes/tasks, parsed finished ending and observed empty todo board |
| pivot | lanes-events | Seeded task/todo; stop before removal, remove task before dropping todo |
| defer | todos-defer | Additional deferred request; exact saved detail/assignment, no read of named project file |
| cli-link | todos-intake | Free actual CLI links two todos; exact observed persisted board |

The task seeds represent state at a notification boundary. They do not run
workers or simulate a real mid-turn interruption. `todo-open` seeds the reopened
state directly. `idle` supplies splates's earlier nudge in the input, not a
second live turn. `shared-files` uses explicit incompatible todo details, not an
observed active worker's diff. The `report` seed requires inspection only and
does not assert a stopped status that the seed never established.

## Evidence and free checks

The seed creates a fresh git repository and private splates home, stamps the
current local record format without invoking network-backed `splates init`, and
uses real local CLI commands to create lanes, todos and (when needed) tasks.
The roster's `fake` worker is disabled. `preMerge: true` in the common minimal
fixture is a stand-in; no probe claims merge/check coverage. Observation reads
actual `.git/splates/todos` JSON and projects stable fields, excluding times and
paths. Missing directories mean an observed empty board; malformed records
fail observation. Setup acts are fixture events, never agent events.

`orchestration.test.ts` tests schema validation, positive synthetic witnesses,
missing/incomplete evidence, reversed order, and failed forbidden attempts.
It separately checks production directive constructors and parsing for LANE,
REPORT, IDLE, TODO DONE/OPEN, LANES DONE and DEFER. These are payload
format checks, **not a claim that a live dev server delivered a directive**.
The actual `cli-link` invocation checks persisted state and retains the CLI
adapter's incomplete events channel. These layers do not prove agent adherence.

The narrow prompts fix task names, dispatch brief and some command text so
schema-1 exact-argv assertions have a reproducible scope. They are public tuning
fixtures, not held-out generalization cases. A shell proposal is never converted
to a trusted execution event. Failed forbidden attempts count; alternate argv
forms or equivalent commands are not comprehensively covered. Each agent case
therefore retains an explicit uncovered assertion even with a synthetic positive
witness. Parsed questions/finished headings establish format, not report truth
or a coherent report across multiple parsed stretches.

## Integration needs for #342

- Register these concrete ids in the coverage inventory without upgrading the
  audit's broader requirements wholesale. Keep CLI state, payload constructors,
  synthetic assertions and authorized model results separate.
- Complete native argv/read/write capture, command alias normalization and
  stop enforcement before interpreting tool-use results. Exact argv limitations
  remain visible; do not remove the gap because synthetic tests pass.
- Live notification emission/delivery, complete task outcome transitions,
  semantic report truth, and start-card-before-dispatch ordering remain gaps.
  The event schema cannot represent intermediate user-visible replies.
- Active-task DEFER (save work, commit, update SPLATES.md, escalate, then no
  continuation), full grooming/release quality and arbitrary model
  choice need additional instrumented cases; the additional-request defer
  fixture does not stand in for them.
- #367 owns skill discovery and reference reads. #356 owns actual delegation
  and no-dev fallback boundaries. These tests stop at orchestration
  decisions; optional legacy `lane-no-dev`/lane E2E must retain actual worker
  execution and landing, separately selected and explicitly authorized.
- Preserve per-repetition unsupported/error/bound results and compatible identity
  hashes; do not report an adherence rate, model ranking or speedup from free
  fixtures. Bump seed identity when setup/observation helpers change.

## Later authorized selection

These examples are documentation only. Do not run them without authorization.
Generic ACP currently rejects these tool-capable agent probes; `--allow-unmetered`
does not solve native capture or allowlist gaps.

```sh
splates dev eval fast --probe orchestration/dependency --target claude:opus --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
splates dev eval fast --aspect orchestration --target claude:opus --target codex:gpt-6-astra --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
splates dev eval report --directory /path/to/results
```

Free verification uses `bun test evals/splates-skill/orchestration.test.ts`,
`splates dev fix` and `splates dev test`.

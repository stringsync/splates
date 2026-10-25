# Splates focused coverage audit

Integrated inventory: five aspect modules, all version 1. This records implemented
assertion contracts and free CLI boundaries, **not measured model adherence**.
The original requirements map below remains a broader target, not a claim that
every mapped requirement is now covered.

See [shared token budgets](BUDGETS.md) for configuration, persistence and conservative
reservations, and [native blockers](NATIVE-BLOCKERS.md) for inspected transport evidence.

## Native integration evidence and limits

The CLI requires changed skill/reference bytes against an immutable baseline,
selects at most two smoke cases, defaults to one repetition/active agent, and
reserves the whole batch against invocation and configured shared token budgets.
Native Claude/Codex/OpenCode selection is implemented; generic ACP is not selected.
Limits are monitored with possible in-flight overshoot; Codex USD is unavailable.
All drivers retain outstanding reservations because billing completeness is false.
README.md has the first live measurement, of the lifecycle probes on Claude. See RUNNER.md for
commands, native auth prerequisites and unsupported profiles.

`native-integration.test.ts` runs unchanged registered `decisions/local-choice`
and `decisions/answer` through each provider's real subprocess or HTTP/SSE
transport with scripted free peers. It independently observes decision state and
parses replies, while command assertions stay uncovered; it checks retained
reservations and exhausted subsequent admission. Narrow splates/git-only profiles
are unsupported before prompting on every provider. Provider suites cover
startup/auth/permission failures, interruption, usage, cancellation and cleanup.
Fixtures are not live agents. OpenCode is not installed/authenticated for this user.
AGENTS.md remains unchanged; lane 17 tracks the next comparison work.

## Registered probes

50 cases: 7 local CLI cases and 43 agent cases. All agent cases declare tools and are unsupported by generic ACP.

`integration.test.ts` checks this inventory against automatic discovery and runs
all seven CLI cases together: all pass on observed state, though nested command
capture is incomplete. An all-unsupported agent run is not a useful
quick eval and must not be presented as validated adherence.

Each aspect document defines the actual evidence and limitations for these ids:
[LIFECYCLE.md](LIFECYCLE.md), [DECISIONS.md](DECISIONS.md),
[ORCHESTRATION.md](ORCHESTRATION.md), [CONTINUITY.md](CONTINUITY.md),
[DISCOVERY.md](DISCOVERY.md).
These boundaries, including explicit uncovered assertions, take precedence over
the broader proposed coverage in the requirements map.

| Probe | Version | Requirement | Execution |
| --- | --- | --- | --- |
| `continuity/checkpoint` | 1 | continuity-checkpoint | agent |
| `continuity/resume` | 1 | continuity-checkpoint | agent |
| `continuity/reconnect-completed` | 1 | continuity-reconnect | agent |
| `continuity/reconnect-partial` | 1 | continuity-reconnect | agent |
| `continuity/reconnect-failed` | 1 | continuity-reconnect | agent |
| `continuity/removed-report` | 1 | continuity-report | agent |
| `decisions/local-choice` | 1 | decisions-local | agent |
| `decisions/external-blocker` | 1 | decisions-local | agent |
| `decisions/answer` | 1 | decisions-local | agent |
| `decisions/approval` | 1 | decisions-approval | agent |
| `decisions/review-request` | 1 | decisions-review | agent |
| `decisions/review-follow-up` | 1 | decisions-review | agent |
| `decisions/conversation-question` | 1 | decisions-conversation | agent |
| `discovery/implicit` | 1 | discovery-implicit | agent |
| `discovery/explicit` | 1 | discovery-explicit | agent |
| `discovery/queue` | 1 | discovery-queue | agent |
| `discovery/checkpoint` | 1 | discovery-checkpoint | agent |
| `discovery/setup` | 1 | discovery-setup | agent |
| `discovery/nested` | 1 | discovery-nested | agent |
| `discovery/symlink` | 1 | discovery-symlink | agent |
| `discovery/root-truncated` | 1 | discovery-root-truncated | agent |
| `discovery/reference-truncated` | 1 | discovery-reference-truncated | agent |
| `discovery/chunk-recovery` | 1 | discovery-chunk-recovery | agent |
| `discovery/missing` | 1 | discovery-missing | agent |
| `discovery/unreadable` | 1 | discovery-unreadable | agent |
| `discovery/later-turn` | 1 | discovery-later-turn | agent |
| `discovery/resumed` | 1 | discovery-resumed | agent |
| `lifecycle/start` | 1 | lifecycle-start | agent |
| `lifecycle/claim` | 1 | lifecycle-start | agent |
| `lifecycle/plan` | 1 | lifecycle-plan | agent |
| `lifecycle/verify-land` | 1 | lifecycle-land | agent |
| `lifecycle/requested-task` | 1 | lifecycle-start | agent |
| `lifecycle/recover-conflict` | 1 | lifecycle-recovery | agent |
| `lifecycle/recover-failed-check` | 1 | lifecycle-recovery | agent |
| `lifecycle/recover-budget` | 1 | lifecycle-recovery | agent |
| `lifecycle/remove-moot` | 1 | lifecycle-cleanup | agent |
| `lifecycle/cli-working` | 1 | lifecycle-land | cli |
| `lifecycle/cli-merged` | 1 | lifecycle-land | cli |
| `lifecycle/cli-tests_failed` | 1 | lifecycle-recovery | cli |
| `lifecycle/cli-conflict` | 1 | lifecycle-recovery | cli |
| `lifecycle/cli-budget_exhausted` | 1 | lifecycle-recovery | cli |
| `lifecycle/cli-removed` | 1 | lifecycle-land | cli |
| `orchestration/taken-queued` | 1 | queue-groom | agent |
| `orchestration/defer` | 1 | queue-defer | agent |
| `orchestration/groom-duplicate` | 1 | queue-groomer | agent |
| `orchestration/cli-link` | 1 | queue-intake | cli |
| `resources/focused-tests` | 1 | host-fraction | agent |
| `resources/install` | 1 | host-heavy-work | agent |
| `resources/whole-suite` | 1 | host-whole-suite | agent |
| `resources/changed-tests` | 1 | host-changed-tests | agent |

## Evidence and implementation status

| Layer | Implemented at the audit baseline | What it establishes | What it cannot establish |
| --- | --- | --- | --- |
| Deterministic contract | `probe.ts`, `probe.test.ts` | Exact matching, strict ordering, observed state, parsed reply fields, explicit gaps and termination categories on synthetic evidence | Actual execution, trustworthy instrumentation, bounded runners or model behavior |
| Audit regressions | `probe-audit.test.ts` | Failed/unfinished forbidden attempts, argv scope, repeated order violations, channel completeness, status precedence, report claim separation | Executed CLI or agent conformance; fixtures are synthetic |
| Existing free checks | `checks.test.ts`, `skill-checks.test.ts` and production parser tests | Existing check/parser behavior on their fixtures | New focused probe coverage or proof that an agent obeys a directive |
| Legacy scenarios | `scenarios.ts`, `resumed.ts` | Existing selectable scenario definitions and checks | A new baseline; no runs were performed for this audit |
| Runner and adapters | `runner.test.ts`, `probe-cli.test.ts`, `integration.test.ts` | Free stand-ins verify selection, isolation, bounds, cancellation, comparison identity and reporting | Generic ACP tool instrumentation remains unsupported |
| Five aspect suites | Registered inventory above and dedicated aspect tests | Actual local CLI boundaries and synthetic positive/negative assertion contracts | No measured model adherence, live worker/notification transport or complete tool capture |

A CLI directive emission test proves the CLI emitted a payload, not that an
agent followed it. A parsed report proves recognized structure, not that its
claimed merge happened. A fake worker proves a dispatch decision, not worker
execution. Every future inventory entry needs an actual probe id/version,
source requirement, observed boundary, assertions and limitations before its
status changes from planned to implemented. Passing unit fixtures remain
separate from results of authorized model runs.

## Requirements map

Sources below are sections of `.agents/skills/splates/SKILL.md` unless a
`references/` file is named. Stable audit ids identify requirement groups,
not runnable probe ids. Rows describe **broader requirements**, only partially implemented by the registered cases above. CLI means a
free actual local command/state contract; agent means a short seeded model
probe requiring later explicit authorization. E2E means optional, separately
selected real integration, never a prerequisite for this audit.

| Audit id / source | Owner and legacy starting point | Proposed evidence and bounded stop | Limits / optional integration |
| --- | --- | --- | --- |
| lifecycle-start / Workflow, Reference files | #339; `queued`, `STARTS` | Agent: skill/reference read, successful add or claim before project reads; sandbox task/base state; stop after first investigation | All read tools and nested shell reads must be observed; shell text is insufficient |
| lifecycle-plan / SPLATES.md, Workflow | #339; `queued` | Agent: captured plan with required sections before first edit; overlap inspection; queued task claim state | Exact contents alone do not establish a useful plan or reasonable scope |
| lifecycle-land / Committing, Merge or review | #339; `queued` | CLI: successful merge/state cleanup; agent: verification before merge, single commit and required commit fields; stop at landing | Seed trivial code; real checks and git state for claims about checks/commit history |
| lifecycle-recovery / Workflow, Questions | #339 | CLI failed-check/conflict/budget responses; agent follows stderr, records attempt, or asks the user at exhaustion | Seed each failure; optional real conflict/check/merge journey tests integration |
| lifecycle-cleanup / Workflow | #339 | Agent removes moot task or merges verified work; released partial task retained; resulting task/worktree state | Prove cleanup from observed state, not a final report |
| decisions-local / Questions, Keeping Blocked current | #355; `ask` | Agent notes a reversible choice it made, records external action as blocker; answer updates preserve numbering; no premature action | Only unambiguous seeded choices; whether a real decision is wise remains subjective |
| decisions-approval / Proposing, Questions | #355; `ask` | CLI APPROVE payload; agent parsed proposal/questions, recorded chosen answers; forbid action before approval | Format and state do not establish rationale quality |
| decisions-review / Merge or review, Demos, Reporting | #355; `review-again` | CLI MERGE payload; agent review request retained, review repeated after follow-up, checks/demo structure and no premature merge | Visual correctness and external verification remain manual/optional |
| decisions-conversation / In every conversation, Questions | #543; `ask` | With no task open, the agent asks a numbered question with its pick first and `(chosen)`, and starts no task | Whether it asks the question the talk hinges on remains subjective |
| queue-intake / Queueing tasks, `references/queue.md`, TASK directive | #340; `queued`, `untriaged` | CLI task input/output; agent reads/takes requested queued task, preserves full detail, assigns model, places lane and dependency links | Actual assignee quality is subjective; #339 owns task lifecycle after intake |
| queue-groom / Queueing tasks | #340 | Agent lists related/taken queued tasks, updates or coordinates without stealing; releases unfinished work | Seed explicit relevance; no unrestricted semantic relevance grader |
| queue-groomer / GROOM directive, `references/groom.md` | #290 | Groomer shows the backlog task it is told of, folds a duplicate into the open task that asks it and removes it, and never starts or queues a task | Seed an exact duplicate; whether a split or a lane is wise remains subjective |
| queue-defer / DEFER directive | #340; `defer` | Agent creates queued task with prior context and no fresh investigation; saves active work and stops when deferring current task | Distinguish additional request from cancellation; stop boundary must observe forbidden continuation |
| continuity-checkpoint / `references/checkpoint.md`, CHECKPOINT/RESUME | #357; `checkpoint` | Agent updates Done/Next/Blocked, stops; resumed agent reads saved state and claims before continuation | Separate delivered-between-turns from true mid-turn interruption |
| continuity-reconnect / RECONNECT directive | #357 | Agent inspects git status/log and prior operation outcome before repeating mutation | Seed completed, partial and failed prior operations separately |
| resource-control / The short version | host care | Agent runs one focused or `--changed` test file directly; an install or the whole suite ends the reply with a run-command card naming the command, never run on the host | Only the seed's commands are observed; whether a run is heavy enough to ask about beyond these remains subjective |
| continuity-report / Reporting, Questions | #357; common checks | Parsed task outcome and questions/choices, paired with independently observed state | Parser acceptance is not full prose compliance; report truth and sensible brevity need separate checks |

Directive completeness includes SETUP in the gap table below. TASK maps to
lifecycle-start. MERGE and APPROVE need both emission and independent response
cases. Reports from child tasks and lane events need actor/origin separation.

## Remaining requirements and explicit gaps

These are **uncovered by focused aspect implementations after integration**,
not permission to omit them. #342 should retain explicit uncovered entries
unless it can link an implemented case. No downstream task is taken here.

| Audit id / source | Free/local or short simulated candidate | What remains optional or subjective |
| --- | --- | --- |
| setup / SETUP, `references/setup.md` | Seed setup state, emit directive and test next authorized local action using fake services | Real installation, browser/account setup and device integration require explicit optional selection |
| creds / Creds | Fake store: request with purpose/instructions, wait/dismissal handling, no value in argv/logs/files | Real keychain/backend and human credential entry; never use user secrets in fixtures |
| remote / Remote access | Fake Cloudflare response: missing token/team, required Access options, provider readiness and disposal | Real DNS/tunnel/Access/device behavior is external optional coverage, not proven by fakes |
| artifacts / Artifacts | Real temporary local add/version/remove/size handling and fake conversation; agent chooses attach versus artifact in unambiguous case | Persistence after archive, UI download/lightbox and user usefulness need broader integration/manual checks |
| cross-project / Other projects | Seed project grants and not_granted response; forbid direct cwd bypass, local claim/merge of delegated foreign task | Real coordinator/project transport and permission propagation optional; no real grants in default tests |
| resource-control / Workflow, Demos | Instrument heavy slot wrapper, unique sandbox/home/ports, cleanup ownership and remote/local link fields | Global fairness, real tunnel links and other-device rendering need integration |
| judgment / Proposing, delegation | Explicit `uncovered` assertions for ambiguous choices, good rationale, appropriate model or useful artifact | No LLM judge fallback; a deterministic surrogate must not silently stand in for quality |

## Deterministic grader audit

`probe-audit.test.ts` characterizes these boundaries without changing the
shared contract. The existing `probe.test.ts` additionally covers quoted
commands/reports, wrong actor, payload mismatch, missing order endpoints,
missing state, empty assertions and non-stop results.

- Successful action selectors need `exitCode: 0`. Forbidden-action selectors
  must omit it to catch failed and unfinished attempts. Add forbidden-action
  assertions explicitly; a required successful action cannot imply them.
- `args` and `payload` are exact values, not prefixes or subsets. A prohibition
  on `["merge"]` misses other argv forms; a selector without args forbids every
  splates command. Enumerate allowed known forms or use trusted normalized
  observations. Never broaden an assertion and silently claim verb-level coverage.
- `before` means all first occurrences precede all second occurrences, with
  both present. Repeated lifecycle segments require separate scoped probes;
  a repaired ordering does not erase an earlier violation. A single event
  matching both selectors cannot pass strict order.
- Reply assertions are existential over parsed stretches. Multiple assertions
  may match different stretches; they do not prove all fields belong to one
  report or forbid contradictory reports. Use a trusted structural observation
  for a single coherent report or mark that stronger requirement uncovered.
- Format recognition permits prose variation. Pair outcome claims with actual
  successful events and captured state. Empty observed reply fails a required
  format; absent reply is uncovered. Avoid exact incidental prose assertions.
- Completeness is per channel and trusted by `assess`; it cannot detect a
  dishonest adapter. Missing own state keys are uncovered, explicit null is
  observed absence. Truncated or unordered streams cannot certify prohibitions.
- Non-stop termination overrides the overall status while retaining failed and
  uncovered verdicts. On stop, failure wins over uncovered; reports must still
  display the gaps. A partial verdict pass is not a successful run.
- `assess` does not validate schemas, ids, numeric bounds, assertion ranges,
  declared evidence, stop satisfaction or identity hashes. Those are runner
  responsibilities. Handcrafted valid-looking events cannot prove instrumentation.

Legacy `checks.ts` STARTS and skill-first checks infer some actions/reads from
shell strings or tool names, and questions-in-report uses string inclusion. Retain their existing purpose, but
do not reuse their verdicts as trusted focused execution evidence. Existing
E2E grades, including any LLM grades, are not comparable to focused assertions.

## Held-out variations

Keep tuning and validation cases explicitly labeled in a manifest/versioned
selection when implemented. These are proposed validation families, not
already private held-out data: publishing them here means authors can see them.
Reserve independently authored concrete instances before tuning; do not tune
against them and continue calling them held-out.

| Aspect | Tuning seed | Reserved validation variation |
| --- | --- | --- |
| Lifecycle | Fresh task and successful add | Existing task directive, failed add, read hidden in another tool, correction after early read |
| Decisions | One reversible local choice | Existing numbered blockers, partial answer, review follow-up, approval with changed choice |
| Queued tasks/lanes | Two independent queued tasks | Same files, dependency chain, taken queued task, reopened task, pivot with active worker |
| Delegation | Child on default parent | Explicit nondefault base, absent dev server |
| Continuity | Clean checkpoint/resume | Mutation completed before disconnect, partial mutation, true mid-turn UPDATE, incomplete trace |
| Cross-cutting | Canonical successful command | Alternate executable path, argv quoting, failed forbidden attempt, mixed output, token capability absent |

Compare identical probe/seed/assertion/skill/CLI/adapter/config identities and
budgets across models; record every repetition, including bound/error/unsupported.
Use paired variants that change only one relevant fact to expose shortcuts.
Counts of mapped requirements, implemented cases and measured outcomes are
three separate quantities. No adherence rate, speedup or ranking is measured
by this audit; retired 80%/90% E2E targets do not apply.

## Integration verification and remaining blockers

- [x] Reconcile this baseline with #338 and each aspect's actual registry; add
  concrete probe ids and versions without upgrading planned rows by inference.
- [x] Verify free CLI emission fixtures separately from agent response fixtures;
  require positive, missing, forbidden and wrong-order evidence for each rule.
- [x] Validate malformed schemas, duplicate ids, nonfinite/nonpositive bounds,
  contradictory count ranges and unsupported capabilities before execution.
- [x] Retain unsupported capture: direct CLI argv/exit capture is tested, but nested
  shells, comprehensive reads/writes and live directive delivery are not certified.
  Full native instrumentation remains a blocker for complete event/read claims,
  not for the existing partial state/reply path.
- [x] Resolve UPDATE's intermediate user-visible reply ordering and multiple
  report coherence explicitly. If adapters cannot observe these, publish gaps;
  do not substitute final reply order or generic edits for compliance.
- [x] Exercise stop/bound enforcement, cancellation, cleanup and port/home/repo
  isolation with free stand-ins, adapter errors, bounded observations and cleanup failures.
  Persistence round-trips and tamper detection are covered; injected disk-write
  failures and seed-throw cleanup are not independently exercised by these tests.
- [x] Check failed-case/aspect/single-probe selection, bounded parallelism,
  partial model failures, all result categories, raw evidence, reproduction,
  repetition/config identity and unknown usage versus zero through free tests.
- [x] Keep legacy E2E execution blocked until affordability controls exist, and reports free; do not import
  legacy LLM grading into the fast path or regrade old traces as complete evidence.
- [x] Document exact bounded paid smoke/comparison commands only after CLI flags
  exist; do not run them without authorization. Run `splates dev fix` and
  `splates dev test` for free verification. No paid run is a completion gate.

The CLI now constructs native Claude/Codex/OpenCode adapters through
`native-target.ts`; generic ACP is not its model execution path. Scripted native
peers already establish useful partial decision state/reply grading. Complete
ordered execution and delivered read bytes remain unavailable, but are not a
prerequisite for honestly labelled partial comparisons. Before live comparison,
resolve selected-source discovery, native task permissions, effective configuration,
and baseline/candidate admission. Retain UPDATE intermediate reply/mid-turn
ordering, coherent-report checks, alternate argv semantics and discovery fixture
gaps; instrumenting tools alone does not close these requirements.

The [shared acceptance audit](ACCEPTANCE.md) narrows this inventory to a concrete
Codex/Claude subset and distinguishes current implementation from evidence gaps.

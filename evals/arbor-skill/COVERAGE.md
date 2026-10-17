# Arbor focused coverage audit

Audit baseline: contract commit `9a41517a` (#337), arbor skill 0.0.44.
This is a requirements inventory, not measured model adherence. #338 is being
implemented independently. The five aspect tasks below start after #338;
none of their planned probes is counted as implemented by this audit.

## Evidence and implementation status

| Layer | Implemented at the audit baseline | What it establishes | What it cannot establish |
| --- | --- | --- | --- |
| Deterministic contract | `probe.ts`, `probe.test.ts` | Exact matching, strict ordering, observed state, parsed reply fields, explicit gaps and termination categories on synthetic evidence | Actual execution, trustworthy instrumentation, bounded runners or model behavior |
| Audit regressions | `probe-audit.test.ts` | Failed/unfinished forbidden attempts, argv scope, repeated order violations, channel completeness, status precedence, report claim separation | Executed CLI or agent conformance; fixtures are synthetic |
| Existing free checks | `checks.test.ts`, `packages/arbor/skill-checks.test.ts` and production parser tests | Existing check/parser behavior on their fixtures | New focused probe coverage or proof that an agent obeys a directive |
| Legacy scenarios | `scenarios.ts`, `lanes.ts`, `resumed.ts` | Existing selectable scenario definitions and checks | A new baseline; no runs were performed for this audit |
| Runner and adapters | #338, outside this audit | Planned validation, isolation, instrumentation, execution and comparison | Must be verified after integration; contract types alone enforce none of these |
| Five aspect suites | #339, #355, #340, #356, #357 | Planned focused CLI and agent cases | No implemented aspect coverage is claimed here |

A CLI directive emission test proves the CLI emitted a payload, not that an
agent followed it. A parsed report proves recognized structure, not that its
claimed merge happened. A fake worker proves a dispatch decision, not worker
execution. Every future inventory entry needs an actual probe id/version,
source requirement, observed boundary, assertions and limitations before its
status changes from planned to implemented. Passing unit fixtures remain
separate from results of authorized model runs.

## Requirements map

Sources below are sections of `.agents/skills/arbor/SKILL.md` unless a
`references/` file is named. Stable audit ids identify requirement groups,
not runnable probe ids. All rows in this table are **planned**. CLI means a
free actual local command/state contract; agent means a short seeded model
probe requiring later explicit authorization. E2E means optional, separately
selected real integration, never a prerequisite for this audit.

| Audit id / source | Owner and legacy starting point | Proposed evidence and bounded stop | Limits / optional integration |
| --- | --- | --- | --- |
| lifecycle-start / Workflow, Reference files | #339; `todo`, `STARTS` | Agent: skill/reference read, successful add or claim before project reads; sandbox task/base state; stop after first investigation | All read tools and nested shell reads must be observed; shell text is insufficient |
| lifecycle-plan / ARBOR.md, Workflow | #339; `todo` | Agent: captured plan with required sections before first edit; overlap inspection; todo claim state | Exact contents alone do not establish a useful plan or reasonable scope |
| lifecycle-land / Committing, Merge or review | #339; `todo` | CLI: successful merge/state cleanup; agent: verification before merge, single commit and required commit fields; stop at landing | Seed trivial code; real checks and git state for claims about checks/commit history |
| lifecycle-recovery / Workflow, Escalation | #339 | CLI failed-check/conflict/budget responses; agent follows stderr, records attempt, retries or escalates at exhaustion | Seed each failure; optional real conflict/check/merge journey tests integration |
| lifecycle-cleanup / Workflow | #339 | Agent removes moot task or merges verified work; released partial todo retained; resulting task/worktree state | Prove cleanup from observed state, not a final report |
| decisions-local / Asking as you go, Keeping Blocked current | #355; `ask` | Agent records reversible choice as assumption, external action as blocker; answer updates preserve numbering; no premature action | Only unambiguous seeded choices; whether a real decision is wise remains subjective |
| decisions-approval / Proposing, Escalation | #355; `ask`, `system` | CLI APPROVE payload; agent parsed proposal/questions, recorded chosen answers and escalation state; forbid action before approval | Format and state do not establish rationale quality |
| decisions-review / Merge or review, Demos, Reporting | #355; `review-again` | CLI MERGE payload; agent review request retained, review repeated after follow-up, checks/demo structure and no premature merge | Visual correctness and external verification remain manual/optional |
| decisions-systems / Systems, `references/systems.md` | #355; `system` | Agent system inspection/proposal and approval before config writes; stop at proposal or authorized write | Naming quality is subjective; do not equate schema validity with good architecture |
| todos-intake / Todos, `references/todos.md`, TODO directive | #340; `todo`, `untriaged` | CLI todo input/output; agent reads/takes requested todo, preserves full detail, assigns model, places lane and dependency links | Actual assignee quality is subjective; #339 owns task lifecycle after intake |
| todos-groom / Grooming related todos, next todo | #340 | Agent lists related/taken todos, updates or coordinates without stealing; releases unfinished work; parsed next-todo proposal | Seed explicit relevance; no unrestricted semantic relevance grader |
| todos-defer / DEFER directive | #340; `defer` | Agent creates todo with prior context and no fresh investigation; saves active work, escalates and stops when deferring current task | Distinguish additional request from cancellation; stop boundary must observe forbidden continuation |
| lanes-dispatch / Working the untriaged lane, `references/lanes.md` | #340; `lane`, `lane-parallel`, `lane-same-files`, `untriaged` | CLI LANE payload; agent places triage first, respects dependencies, dispatches independent work and coordinates shared files | Fake workers test orchestration only; actual concurrent work/merge stays optional E2E |
| lanes-events / `references/lanes.md` | #340; `lane-report`, `lane-idle`, `lane-pivot` | CLI REPORT, TODO DONE/OPEN, IDLE, STOPPED, LANES DONE payloads; agent follow-up/stop/pivot state and order | Seed one transition; do not require full worker journeys |
| delegation-parts / `references/parts.md` | #356; `part` | Agent reads reference, creates child on parent base, sends constrained brief, propagates blockers and merges child before parent | Brief structure can be checked; adequacy is partly subjective; real child execution optional |
| delegation-handoff / `references/handoff.md` | #356 | CLI HANDOFF/HANDOFF TO/REPORT/HEARTBEAT payloads; agent records handoff context, claims takeover, respects relay reporting ownership | Stand-ins do not prove transport, restart or delegated model execution |
| delegation-no-dev / `references/lanes.md`, `references/parts.md` | #356 with #340; `lane-no-dev` | Seed absent dev server; observe allowed dispatch and explicit boundary result | Real no-dev child execution and landing retained as optional E2E |
| continuity-checkpoint / `references/checkpoint.md`, CHECKPOINT/RESUME | #357; `checkpoint` | Agent updates Done/Next/Blocked, stops; resumed agent reads saved state and claims before continuation | Separate delivered-between-turns from true mid-turn interruption |
| continuity-reconnect / RECONNECT directive | #357 | Agent inspects git status/log and prior operation outcome before repeating mutation | Seed completed, partial and failed prior operations separately |
| continuity-update / UPDATE directive, ARBOR.md | #357; `check-in` | Observe ARBOR.md update, then user-visible reply before any next tool, then meaningful continuation | Current Event kinds have no dedicated reply event; final reply alone cannot prove this temporal requirement |
| continuity-report / Reporting, Asking as you go | #357; common checks | Parsed task outcome, questions/choices, assumptions and next-todo structure, paired with independently observed state | Parser acceptance is not full prose compliance; report truth and sensible brevity need separate checks |

Directive completeness includes SETUP in the gap table below. TASK maps to
lifecycle-start; UPDATE is check-in handling, not a general proactive progress
message test. MERGE and APPROVE need both emission and independent response
cases. Reports from child tasks and lane events need actor/origin separation.

## Remaining requirements and explicit gaps

These are **uncovered by focused aspect implementations at this baseline**,
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
| judgment / Proposing, Systems, delegation | Explicit `uncovered` assertions for ambiguous choices, good rationale, appropriate model or useful artifact | No LLM judge fallback; a deterministic surrogate must not silently stand in for quality |

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
  arbor command. Enumerate allowed known forms or use trusted normalized
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
shell strings or tool names. `report-body` checks selected textual form, and
questions-in-report uses string inclusion. Retain their existing purpose, but
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
| Todos/lanes | Two independent todos | Same files, dependency chain, taken todo, reopened todo, pivot with active worker |
| Delegation | Child on default parent | Explicit nondefault base, relayed blocker, stopped child, absent dev server |
| Continuity | Clean checkpoint/resume | Mutation completed before disconnect, partial mutation, true mid-turn UPDATE, incomplete trace |
| Cross-cutting | Canonical successful command | Alternate executable path, argv quoting, failed forbidden attempt, mixed output, token capability absent |

Compare identical probe/seed/assertion/skill/CLI/adapter/config identities and
budgets across models; record every repetition, including bound/error/unsupported.
Use paired variants that change only one relevant fact to expose shortcuts.
Counts of mapped requirements, implemented cases and measured outcomes are
three separate quantities. No adherence rate, speedup or ranking is measured
by this audit; retired 80%/90% E2E targets do not apply.

## Integration checklist for #342

- [ ] Reconcile this baseline with #338 and each aspect's actual registry; add
  concrete probe ids and versions without upgrading planned rows by inference.
- [ ] Verify free CLI emission fixtures separately from agent response fixtures;
  require positive, missing, forbidden and wrong-order evidence for each rule.
- [ ] Validate malformed schemas, duplicate ids, nonfinite/nonpositive bounds,
  contradictory count ranges and unsupported capabilities before execution.
- [ ] Test actual execution capture (nested shells, argv variants, individual
  process exits, reads/writes, directive decoding); unsupported capture must
  leave channels incomplete. Synthetic audit fixtures cannot validate this.
- [ ] Resolve UPDATE's intermediate user-visible reply ordering and multiple
  report coherence explicitly. If adapters cannot observe these, publish gaps;
  do not substitute final reply order or generic edits for compliance.
- [ ] Exercise stop/bound enforcement, cancellation, cleanup and port/home/repo
  isolation with free stand-ins, including errors during seed/run/persistence.
- [ ] Check failed-case/aspect/single-probe selection, bounded parallelism,
  partial model failures, all result categories, raw evidence, reproduction,
  repetition/config identity and unknown usage versus zero through free tests.
- [ ] Keep legacy E2E and external/slow cases explicitly optional; do not import
  legacy LLM grading into the fast path or regrade old traces as complete evidence.
- [ ] Document exact bounded paid smoke/comparison commands only after CLI flags
  exist; do not run them without authorization. Run `bin/wiz dev fix` and
  `bin/wiz dev test` for free verification. No paid run is a completion gate.

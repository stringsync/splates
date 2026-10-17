# Decision and review probes (#355)

`decisions.probes.ts` is an automatically discovered, side-effect-free default
`ProbeModule`. All cases are version 1, aspect `decisions`, one input/turn,
60 seconds and 4,000 tokens. No paid evaluation was run. Free assertion fixtures
are synthetic; they establish assertion behavior, not real agent compliance.

| Probe id (prefix `decisions/`) | Audit requirement | Observable boundary |
| --- | --- | --- |
| local-choice | decisions-local | Final reply, parsed assumption placement/number/size and chosen option, no blockers |
| external-blocker | decisions-local | Final reply, numbered question, large open blocker, actual CLI escalated status |
| answer | decisions-local | Seeded question 3 answered b, checked, not renumbered |
| approval | decisions-approval | APPROVE with explicit answer a recorded on seeded question 3 |
| review-request | decisions-review | Review requested note, parsed review, actual escalated review status |
| review-follow-up | decisions-review | Seeded waiting review, repeated parsed review and actual waiting review status |
| system-proposal | decisions-systems | Numbered question, escalated task and observed config absence |
| cli-review-ready | decisions-review | Real local CLI review escalation with completed plan |
| cli-review-blocked | decisions-review | Real local CLI refuses review while question 3 remains open |

Seeds create a minimal isolated git repository, disabled fake-agent roster and
local format-1 arbor records, then use real `arbor add`, `path`, and (for a
waiting review) `escalate`. No `init`, network, external service, real worker,
shared registry edit, or legacy E2E fixture is used. The seed's check command
is `true`: these cases make no real verification claim. Observation reads the
actual task files and `arbor show --json`, not the assistant's description.
Missing task files are null; other I/O failures propagate. Parsed summaries
intentionally omit incidental prose. Original ARBOR.md remains in state.

The dedicated tests cover production directive constants APPROVE/MERGE,
production plan/review parsing, checked/unchecked and renumbered answers,
wrong answers/sections, quoted or incomplete reviews, failed/unfinished merge
attempts, actor separation, incomplete channels, and both real CLI gates.
Directive constants are a format contract only: no UI/CLI delivery is claimed.
The CLI gates use no model, and retain incomplete nested execution capture.

## Integration needs for #342

Keep the following explicit gaps in the combined inventory:

- Generic ACP rejects tools; every agent case here is unsupported with that
  adapter. A future instrumented adapter must enforce tools/token budgets and
  observe actual commands, reads/writes, individual exits and ordering.
- Every agent case retains an uncovered assertion for alternate merge argv,
  nested shell calls and direct git. The canonical `arbor merge` prohibition
  catches failed and unfinished attempts too; it is not a verb-wide guarantee.
- State does not prove recording preceded action. This module does not claim
  wrong-order compliance; add trusted ordered execution observations before
  upgrading that requirement. Config absence cannot exclude write-then-delete.
- External effects and recipient semantics remain uncovered. No fake sending
  service establishes a real external boundary. Judgment, rationale, naming
  quality and whether an ambiguous proposal is warranted remain subjective.
- Multiple parsed review fields may come from different reports. Full report
  coherence, useful demos/screenshots, truthful checks, and proposal prose
  format remain integration gaps. A repeated review is a seeded follow-up,
  not a multi-turn transport or mid-turn steering test.
- APPROVE here settles an explicitly selected local record only. General
  proposal approval, challenged assumptions, partial/moot/follow-up answers,
  approved system writes and MERGE response/claim/landing remain uncovered.
  MERGE emission/delivery needs a real UI boundary, separately from its constant.
- #367 owns skill discovery/reference loading; #340 owns orchestration
  decisions; #356 owns delegation. No coverage from those owners is inferred.

Reconcile these concrete ids with COVERAGE.md without treating mapped cases as
measured adherence. Run selection through the existing aspect/probe/requirement
flags; no new registry is needed. Keep existing `ask`, `system`, `review-again`
E2E scenarios separately selectable. Later authorized results should retain
all repetitions and identify whether failures concern choice placement,
numbering, readiness or repeated review structure. Those distinctions can guide
skill wording or CLI affordances; synthetic passes and unsupported cases cannot
rank models or establish speedups. No paid run is required to integrate this work.

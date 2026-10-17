# Delegation boundaries (#356)

This module supplies bounded cases, not measured model adherence. All cases
are version 1 and use `delegation/tasks@1`: real isolated parent/child tasks,
with child based on `task/parent`. The repository format marker is seeded
directly; no skill installation, dev server, external agent or network is
started. The fake roster is disabled. `preMerge: true` is a check stand-in.

| Probe suffix (prefix `delegation/`) | Requirement | Observed/asserted boundary |
| --- | --- | --- |
| part-base | delegation-parts | Claim parent; observe extra base and separate worktree; brief remains a gap |
| part-return | delegation-parts | Forbid premature named merges/wait while parent fix is uncommitted |
| part-decisions | delegation-parts | Claim parent; retain raw ARBOR.md for decision propagation inspection |
| takeover | delegation-handoff | Successful claim of existing child |
| handoff-checkpoint | delegation-handoff | Roster before named handoff; checkpoint adequacy remains uncovered |
| relay-blocker | delegation-handoff | Inspect child; forbid named merge approval; exact blocker relay remains uncovered |
| heartbeat | delegation-handoff | Inspect child; report truth and delivery remain uncovered |
| no-dev-relay | delegation-no-dev | Forbid named relay/wait forms without dev |
| cli-no-dev-relay | delegation-no-dev | Actual local CLI refusal, independently checked by free test |

Each agent case stops at the first final reply (30 seconds, one turn, 2000
tokens). Commands are exact argv selectors: they are deliberately not claims
about all option orders or arbitrary payloads. Forbidden selectors omit exit
status so failed attempts count. A successful required command does not prove
that its accompanying brief or report was correct. Synthetic positive,
negative and incomplete-channel fixtures test the assertions only.

The dedicated tests call production HANDOFF, HANDOFF TO, REPORT and HEARTBEAT
formatters. This verifies emitted string construction, not coordinator delivery.
Actual delivery remains covered separately by the production handoff,
dev-conversation, tell and handed-out tests; no synthetic directive is emitted
as trusted CLI evidence in these probes.

## Integration needs for #342

Generic ACP cannot execute these tool-requiring agent probes: preserve its
unsupported outcome. CLI nested capture remains incomplete, so the real CLI
case remains uncovered even though its dedicated test verifies the refusal.
Do not promote either result to measured agent adherence.

Add a trusted option-normalizing execution adapter and structural brief, decision and blocker observations before closing the explicit gaps.
Do not parse proposed shell strings as execution or arbitrary prose as semantic
compliance. Raw parent ARBOR.md is observed, not inferred from a reply.
True parent commit -> child check/merge -> parent squash/merge, transport,
restart and child model execution remain optional E2E work. No paid runs were
performed. #367 owns progressive reference reads; #340 owns lanes and dispatch;
this module owns the delegation boundary and absent-dev relay restriction.

Free verification: `bun test evals/arbor-skill/delegation.probes.test.ts`,
`bin/wiz dev fix`, and `bin/wiz dev test`.

Later, only after explicit paid-run authorization and a tool-capable adapter,
select `--aspect delegation` or `--probe delegation/takeover` with the fast
runner. The current generic ACP adapter should report unsupported; adding
`--allow-unmetered` does not fix tool capture. Preserve repetition, config and
fixture identities and every nonpassing result in comparisons.

Example selection commands for later authorization (not executed here):

```sh
bin/wiz dev eval fast --module evals/arbor-skill/delegation.probes.ts --probe delegation/takeover --target codex:gpt-6-astra --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval fast --module evals/arbor-skill/delegation.probes.ts --aspect delegation --target codex:gpt-6-astra --target claude:opus --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
```

These select real registered cases but retain current ACP unsupported outcomes;
a future instrumented adapter is necessary for agent tool-use measurement.

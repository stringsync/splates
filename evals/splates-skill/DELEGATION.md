# Delegation boundaries (#356)

This module supplies bounded cases, not measured model adherence. All cases
are version 1 and use `delegation/tasks@1`: real isolated parent/child tasks,
with child based on `task/parent`. The repository format marker is seeded
directly; no skill installation, dev server, external agent or network is
started. `preMerge: true` is a check stand-in. An agent starts no agents, so
delegation here means parts handed to the harness's own subagents
(`references/parts.md`); work for another agent is queued, which
`ORCHESTRATION.md` covers.

| Probe suffix (prefix `delegation/`) | Requirement | Observed/asserted boundary |
| --- | --- | --- |
| part-base | delegation-parts | Claim parent; observe extra base and separate worktree; brief remains a gap |
| part-return | delegation-parts | Forbid premature named merges/wait while parent fix is uncommitted |
| part-decisions | delegation-parts | Claim parent; retain raw SPLATES.md for decision propagation inspection |

Each agent case stops at the first final reply (30 seconds, one turn, 2000
tokens). Commands are exact argv selectors: they are deliberately not claims
about all option orders or arbitrary payloads. Forbidden selectors omit exit
status so failed attempts count. A successful required command does not prove
that its accompanying brief or report was correct. Synthetic positive,
negative and incomplete-channel fixtures test the assertions only.

## Integration needs for #342

Generic ACP cannot execute these tool-requiring agent probes: preserve its
unsupported outcome. Do not promote it to measured agent adherence.

Add a trusted option-normalizing execution adapter and structural brief, decision and blocker observations before closing the explicit gaps.
Do not parse proposed shell strings as execution or arbitrary prose as semantic
compliance. Raw parent SPLATES.md is observed, not inferred from a reply.
True parent commit -> child check/merge -> parent squash/merge and real
subagent execution remain optional E2E work. No paid runs were performed. #367
owns progressive reference reads; #340 owns queueing; this module owns parts.

Free verification: `bun test evals/splates-skill/delegation.probes.test.ts`,
`splates dev fix`, and `splates dev test`.

Later, only after explicit paid-run authorization and a tool-capable adapter,
select `--aspect delegation` or `--probe delegation/part-base` with the fast
runner. The current generic ACP adapter should report unsupported; adding
`--allow-unmetered` does not fix tool capture. Preserve repetition, config and
fixture identities and every nonpassing result in comparisons.

Example selection commands for later authorization (not executed here):

```sh
splates dev eval fast --module evals/splates-skill/delegation.probes.ts --probe delegation/part-base --target codex:gpt-6-astra --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
splates dev eval fast --module evals/splates-skill/delegation.probes.ts --aspect delegation --target codex:gpt-6-astra --target claude:opus --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
```

These select real registered cases but retain current ACP unsupported outcomes;
a future instrumented adapter is necessary for agent tool-use measurement.

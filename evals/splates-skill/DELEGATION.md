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
| part-decisions | delegation-parts | Claim parent; retain raw SPLATES.md for decision propagation inspection |
| takeover | delegation-handoff | Successful claim of existing child |
| handoff-checkpoint | delegation-handoff | Roster before named handoff; checkpoint adequacy remains uncovered |
| cli-no-dev-tell | delegation-no-dev | Actual local CLI refusal, independently checked by free test |
| auto-question | delegation-auto | No task started for a question |
| auto-fits | delegation-auto | One task, nothing handed on |
| auto-hand-up | delegation-auto | One task handed to `fake large` at `high` effort; Handoff context and reason line remain gaps |
| auto-hand-down | delegation-auto | One task handed to `fake small` at `low` effort; spelled-out Next remains a gap |

The `auto-` cases use `delegation/auto@1`: no tasks, a roster of one disabled
agent with a cheap and a strong model, and code whose size differs from what
each request sounds like (one value, one name in 25 files, three retry loops
that disagree). The input stands in for the page's Auto line, telling the
agent which roster model it runs as; the real model is whatever runs the
probe. Tasks and their recorded dispatch are read from `.git/splates/tasks`,
never from the reply. A free test plays the right moves on the real CLI to
check the observer; bounds are 120 seconds, one turn, 8000 tokens.

Each agent case stops at the first final reply (30 seconds, one turn, 2000
tokens). Commands are exact argv selectors: they are deliberately not claims
about all option orders or arbitrary payloads. Forbidden selectors omit exit
status so failed attempts count. A successful required command does not prove
that its accompanying brief or report was correct. Synthetic positive,
negative and incomplete-channel fixtures test the assertions only.

The dedicated tests call production HANDOFF, HANDOFF TO, and REPORT
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
compliance. Raw parent SPLATES.md is observed, not inferred from a reply.
True parent commit -> child check/merge -> parent squash/merge, transport,
restart and child model execution remain optional E2E work. No paid runs were
performed. #367 owns progressive reference reads; #340 owns lanes and dispatch;
this module owns the delegation boundary and absent-dev tell restriction.

Free verification: `bun test evals/splates-skill/delegation.probes.test.ts`,
`splates dev fix`, and `splates dev test`.

Later, only after explicit paid-run authorization and a tool-capable adapter,
select `--aspect delegation` or `--probe delegation/takeover` with the fast
runner. The current generic ACP adapter should report unsupported; adding
`--allow-unmetered` does not fix tool capture. Preserve repetition, config and
fixture identities and every nonpassing result in comparisons.

Example selection commands for later authorization (not executed here):

```sh
splates dev eval fast --module evals/splates-skill/delegation.probes.ts --probe delegation/takeover --target codex:gpt-6-astra --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
splates dev eval fast --module evals/splates-skill/delegation.probes.ts --aspect delegation --target codex:gpt-6-astra --target claude:opus --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
```

These select real registered cases but retain current ACP unsupported outcomes;
a future instrumented adapter is necessary for agent tool-use measurement.

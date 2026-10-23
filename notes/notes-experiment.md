---
description: The notes-v2 experiment's assignment, seven-day correction measure, missing-data bounds and fixed review rule; read before judging whether automatic pointers help
---

The `notes-v2` phase compares automatic pointers against no pointers with a
50/50 assignment for new conversations. Existing conversations retain their
original assignment and remain in the historical comparison. Both groups can
read project notes, and both still run the router. This tests pointer delivery,
not removing notes or the latency saved by removing routing.

## Assignment and coverage

Enrollment is recorded as `notes assigned` before asking the judge. Its version,
assignment timestamp and holdout are also saved in the conversation log, so a
restart preserves them. A conversation with prior agent messages or an existing
holdout stays in the original phase. Assignment waits until a message has notes
to route; it does not require a working judge. Failures and missing judges are
recorded separately, rather than silently removing those conversations.

Keep the current immediate/optional thresholds and caps fixed during this phase.
Any change requires a new phase identifier and a fresh prospective cohort; never
pool versions. The frozen values are immediate p >= 0.8, cap two; optional
p >= 0.7, cap one; routing timeout two seconds. Note edits remain allowed, so
check their history when interpreting results.

## Review rule

The primary measure is the share of assigned conversations with at least one
user correction during the seven days after assignment. The enrollment prompt
has no prior treatment to assess, so its correction label is excluded. All
assigned conversations count, including unfinished ones and ones that never
start a task; selecting only conversations that finish work could bias results.
A correction is the router's probability >= 0.5. Before deciding, manually audit
a blinded sample of positive and negative correction labels against transcripts.

Review once the first 400 assignments in each arm have their full seven-day
follow-up. Later assignments do not change that cohort's primary result. This
is a fixed analysis, not a rule to stop on the first favorable daily estimate.
A worthwhile benefit is an absolute reduction of at least five percentage points.
The nominal conservative 95% interval for pointers minus holdout subtracts the
bounds of two Bonferroni-adjusted Wilson intervals. Missing correction outcomes
are allowed either value, widening the interval. Repeated tasks and messages do
not become independent primary samples: each conversation counts once.

- Upper bound below -5 points: evidence of a worthwhile benefit.
- Lower bound above -5 points: a benefit that large is not supported.
- Interval spans -5 points: inconclusive; do not claim equivalence or extend the
  sample until it happens to pass. Design a further phase if needed.

The screen supports a human decision; it never disables the feature itself.

## Supporting results

The Stats page separates this phase from history and shows enrollment, follow-up,
missing labels, routing failures, reads/application in both arms, recorded judge
spend and successful routing p95. Failed calls may have unreported spend.
Task outcomes count only work starting after assignment and ending within the
seven-day window. Pre-existing work is counted separately as excluded. Tokens
and turns show their measured-merge coverage. Agent/model breakdowns use outcome
metadata; model switches are not randomized and these rows are descriptive.
Historical results exclude tasks ending before their first routing judgment,
but their whole-conversation adherence scores remain descriptive, not causal.

## Where

- `packages/server/notes/route.ts`: enrollment and routing coverage
- `packages/server/notes/tiers.ts`: phase identifier and frozen routing policy
- `packages/server/stats/note-experiment.ts`: prospective cohort and review rule
- `packages/web/stats-notes.tsx`: historical and current comparisons

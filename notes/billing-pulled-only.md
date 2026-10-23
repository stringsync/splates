---
description: The Billing page shows dollars by provider from pulled sources and a machine-wide spend ledger, and every runner made with its estimate beside the pulled bill; costs are never entered by hand, and an unreachable provider is never recorded as zero
---

The Budget page became Billing (`#billing`, `#budget` still opens it). It
shows billed and estimated dollars by provider and service from the
machine-wide ledger `~/.splates/spend.jsonl` (`packages/server/spend/`),
which every project adds to and which billing pulls provider charges into
once per charge; a provider it cannot reach is never recorded as zero. The
scry and worker budgets and plan limits sit below, restyled to match.

Costs are never entered by hand: the person said they would not use hand
entry, so a provider with no pull source shows "Not tracked yet" (state
`untracked`, formerly `manual`). Each source row says Pulled, Needs a key,
Pull failed or Not tracked yet, with Add key, Fix token (opens the Creds
page at that key and shows the error in plain words) or Retry. Plan-billed
use such as a Claude subscription shows both its API-equivalent value and
real money out of pocket. Model list prices come from `models.dev`, cached a
day (`prices/`). DigitalOcean (whose invoices it pulled until 2026-10-23) and Hetzner are no longer sources.

Runners are the one cost splates estimates itself, and the person wanted
what each costs somewhere obvious, per machine, with its history, so the
Runners section sits above the budget bars. Each runner's life (type, the
hourly price the cloud's API gave as it was made, made and destroyed) and
each job it ran are rows of their own in the same `spend.jsonl`, kept
forever and never counted as spend (`Spend.entries` leaves them out;
`Spend.lines` and `spend/runners.ts` read them), so no second ledger
exists and a runner's estimate is never added to the bill it estimates.
`/api/billing/runners` answers every runner, the last 90 days and every
month of runner-hours and dollars, each month beside what the runners'
provider billed for it (a pulled invoice, by its period; Fly.io has none to pull, so its runners show as Estimated) with the
gap in percent, amber past 20%, and who each day's and month's cost went
to, counted per job: a runner's idle time in an hour is shared among the
tasks whose jobs ran on it that hour, as `splitSpend` does. Days and months
are UTC, as the ledger's are. Runner dollars are US
dollars whatever the display currency, as the price and the bill are.

Fly.io has no supported API for its bill or usage (checked 2026-10-22: a
community request of July 2026 for one went unanswered, the GraphQL
`App.usage` field is undocumented and not enough to cost from, and `flyctl`
has no billing command), so its source row reads Estimated (state
`estimated`, `Provider.estimated`) with an Open bill link to the Fly
dashboard (`Provider.dashboard`), and its months show "not billed yet"
beside the estimate rather than a zero. A Fly runner stopped and kept
costs only its root filesystem, so the ledger keeps `runner-stopped` and
`runner-started` rows beside `runner` and `runner-ended`, and the made row
carries `stoppedDollarsPerHour`: `runnersReport` cuts each life into
running and stopped spans, a runner shows as running, stopped and kept, or
deleted with its running and stopped time and what both cost so far, a
day's hours count running alone and its dollars both, and stopped time
goes to no task. The worker budget's day and month limits count the same
storage (`WorkerBudget.slept`, a life marked `stopped`, left out of
`running()` and the hourly rate; `counted()` is both, which reconcile
squares with the machines).

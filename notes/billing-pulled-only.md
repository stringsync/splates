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
day (`prices/`). DigitalOcean and Hetzner are no longer sources.

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
provider billed for it (DigitalOcean's invoice, by its period) with the
gap in percent, amber past 20%, and who each day's and month's cost went
to, counted per job: a runner's idle time in an hour is shared among the
tasks whose jobs ran on it that hour, as `splitSpend` does. Days and months
are UTC, as the ledger's and DigitalOcean's are. Runner dollars are US
dollars whatever the display currency, as the price and the bill are.

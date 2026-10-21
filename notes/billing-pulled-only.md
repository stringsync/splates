---
description: The Billing page shows dollars by provider from pulled sources and a machine-wide spend ledger; costs are never entered by hand, and an unreachable provider is never recorded as zero
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

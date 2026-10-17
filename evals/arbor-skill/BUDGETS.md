# Shared eval token budgets

Eval budgets pool **total tokens across every target, probe and repetition** in a
project. They do not make unsupported providers executable. The skill-change gate,
terminal confirmation and certified provider metering remain mandatory. No paid
runs were used to implement this feature. AGENTS.md's warning is unchanged.

## Configuration and controls

Like Scry, configuration loads the project's `eval.config.ts`, then the user's
`$XDG_CONFIG_HOME/eval/config.ts` (`~/.config/eval/config.ts`). The last `budgets`
value wins whole. A device override wins over both. No shared allowance is invented
when none is configured: model execution refuses until the user declares one.
The following is illustrative configuration, not an allowance installed for you:

```ts
import type { EvalBudgetConfig } from "./evals/arbor-skill/probe-budget-policy";
export default {
  budgets: [
    { tokens: 20_000, per: "month" },
    { tokens: 4_000, within: "7d" },
  ],
} satisfies EvalBudgetConfig;
```

Free management commands (examples only, not model runs):

```sh
bin/wiz dev eval budgets
bin/wiz dev eval budgets --format json
bin/wiz dev eval budgets set 20k/month,4k/7d
bin/wiz dev eval budgets set nothing
bin/wiz dev eval budgets reset
```

All configured limits apply simultaneously. Scry's `check` means one invocation;
`day`, `week` (Monday start), and `month` use local calendar boundaries. `24h`,
`7d`, and `2w` are rolling windows. Parsing and window calculations reuse Scry's
implementation. `reset` removes only the device override, returning to config;
it **never erases spending or outstanding reservations**. There is no automatic
budget raise, reset-spending command, unlimited allowance, or override bypass.
Scry's temporary raises/pauses and Budget page UI are not implemented for evals;
`set nothing` disables model admission until explicitly changed/reset.

Scope matches Scry: the current user on this device, keyed by the same
`projectName` resolution (including shared Git worktree identity and configured
project names). State lives under `$XDG_STATE_HOME/wiz/<project>/eval-budgets.json`,
or `~/.local/state/wiz/<project>/eval-budgets.json`. It is separate from Scry's
ledger. Devices do not share this allowance. One atomic file contains both the
override and reservations so a concurrent budget edit cannot race admission.

## Accounting and guarantees

Input tokens, including cached input, count once. Output tokens include hidden
reasoning once; do not add reasoning to a total that already includes it. Every
billable attempt and retry counts. An adapter unable to certify this total or the
corresponding complete charge ceiling remains unsupported. Tool dollar charges
are included in provider dollar reservations even when they have no token unit.

The runner first admits the entire probe × target × repetition batch against
provider quotes and invocation guardrails, then reserves its complete token and
microdollar ceilings in the shared ledger under an interprocess lock. It writes
by atomic rename before any seed or model request starts. Concurrent invocations
reread reservations under that same lock. There is no second allowance for retries.
A failure to persist refuses launch. Unsupported pricing/metering refuses before
any shared reservation. A declined confirmation does not reserve anything.

Reservations are never refunded, even when a known result reports fewer tokens.
Reports distinguish consumed reservations, outstanding reservations and remaining
window tokens from measured provider usage. Known usage totals and unknown-job
counts appear separately; unknown usage is never represented as measured zero.
A normally completed batch with all token and dollar usage known ages out from
its **completion** time. A failed, cancelled, interrupted, partially persisted or
unknown-usage batch stays outstanding across window resets. This is deliberately
more conservative than Scry's post-run input-token accounting. Restarting or
resetting the override cannot release these reservations. A stale outstanding
reservation can therefore exhaust a window indefinitely; automatic recovery
would require independent proof that all billable work ended and its usage is
complete. No such recovery shortcut is provided.

Per-invocation defaults remain **4,000 tokens / USD 0.10**, with hard maxima of
**10,000 tokens / USD 0.25**, regardless of shared configuration. `per: "check"`
is a per-invocation limit, as in Scry; add a day/month/rolling limit to constrain
spending across invocations. Token budgets are not dollar-equivalent across
models: input, cached input, output and reasoning prices may differ. Reserved USD
are certified ceilings; observed USD are reported usage. Neither proves live
cost without a certified provider. Unknown prices or unenforceable charges still
refuse execution. No production provider is certified and no live cost, latency
or adherence measurement exists.

Free tests cover two-process contention, restart persistence, reset without
refund, zero/exhausted/undeclared budgets, calendar/rolling windows, unknown usage,
config precedence, malformed state and concurrent bounded stand-ins. These tests
establish ledger/admission behavior, not provider billing enforcement.

---
description: How bin/splates picks which checkout's code runs, and why a merge from a worktree pins SPLATES_ROOT to the main tree
---

`bin/splates` runs `bin/_run packages/splates/checkout.ts` in the checkout
that `git rev-parse --show-toplevel` of the current directory names, so from
a worktree you run that worktree's code; outside any splates checkout it
falls back to the tree the shim lives in. `SPLATES_ROOT` pins a checkout, and
a pin with no such tree is an error, never a silent fallback.

The pin exists for `splates merge` from a worktree of this repo: the merge
would otherwise run the code it is about to rewrite, so it is
`SPLATES_ROOT="$(splates path)" splates merge`. `bin/splates` unsets
`SPLATES_ROOT` for `dev` commands, since the gate's `splates dev test` must
test the rebased worktree, not the pin. `bin/arbor` is a one-release alias
that warns.

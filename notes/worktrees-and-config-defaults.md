---
description: Where task worktrees live, why the folder is named .noindex, and the other defaults splates.config.ts can override
---

A task's worktree is `../<repo>-splates.noindex/<slug>` beside the main
checkout, on branch `task/<slug>`; here that is `splates-splates.noindex/`.
The suffix is deliberate: Spotlight skips a folder named `*.noindex`, and
indexing every `bun install` and removal in the worktrees kept two cores busy
and made timing tests fail the merge gate. The `.metadata_never_index` marker
is ignored by macOS 26, so it cannot replace the suffix.

`defaults()` in `packages/server/config/load.ts` also sets `notesDir:
"notes"`, `leaseStalenessMs` 90s, `mergeRetryCount` 5, `logCapacity` 1000,
`attachmentCapacity` 100 MB and `wiz: "bunx @webappwiz/cli"`; a project's
`splates.config.ts` overrides any of them, and this repo's sets
`postCheckout` and `postRewrite` to `bun install` and `preMerge` to
`./bin/splates dev test`, so the suite gates a merge. Older keys (`todoStalenessMs`) are renamed on load.

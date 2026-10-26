---
description: Where task worktrees live, why the folder is named .noindex, and the other defaults splates.config.ts can override
---

A task's worktree is `../<repo>-splates.noindex/<slug>` beside the main
checkout, on branch `task/<slug>`; here that is `splates-splates.noindex/`.
The suffix is deliberate: Spotlight skips a folder named `*.noindex`, and
indexing every `bun install` and removal in the worktrees kept two cores busy
and made timing tests fail the merge gate. The `.metadata_never_index` marker
is ignored by macOS 26, so it cannot replace the suffix.

To check what Spotlight holds, query the whole index, by name or content
(`mdfind "kMDItemFSName == 'x.txt'"`), never `mdfind -onlyin <dir>`: on a
folder outside the index that walks the disk by name, so it lists every
worktree and test repo under `$TMPDIR` as though indexed. Probed on macOS
26.6, files under the worktree root and anywhere under `$TMPDIR` (a
`.noindex` folder or not) never reach the index, while one under `~` does
within a minute; Spotlight indexes only the main checkout's tracked files,
and none of `node_modules`. So `fseventsd` load during a gate is the
volume's file churn, which no Spotlight setting changes, and running fresh
scripts or binaries costs `xprotectd` nothing.

`defaults()` in `packages/server/config/load.ts` also sets `notesDir:
"notes"`, `leaseStalenessMs` 90s, `mergeRetryCount` 5, `mergeConflictCount` 10, `logCapacity` 1000,
`attachmentCapacity` 100 MB and `wiz: "bunx @webappwiz/cli"`; a project's
`splates.config.ts` overrides any of them, and this repo's sets
`postCheckout` and `postRewrite` to `bun install` and `preMerge` to
`./bin/splates dev premerge`, so the suite gates a merge. Older keys
(`todoStalenessMs`, now `taskStalenessMs`) are renamed on load.

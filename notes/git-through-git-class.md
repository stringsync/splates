---
description: All of splates's git goes through the Git class, which adds --no-optional-locks, trims output, passes tokens through the environment and can run git on a remote worker
---

`Git` (`packages/server/git.ts`) is the one place splates runs git. Every
`run` adds `--no-optional-locks`, so background reads never refresh the index
while a merge writes it; output comes back trimmed, and `out()` throws on a
non-zero exit. `runWith(env)` is how a token reaches git without appearing
in argv, with `GIT_TERMINAL_PROMPT=0` so git fails instead of hanging. A
`GitRunner` decides where git runs: locally by default, or on the worker
holding the checkout (`workerGit`); `git.at(root)` re-roots a runner at a
clone.

`Watch` (`agents/watch.ts`) then flags what an agent's own commands did to
git: stashes left behind, dropped commits, branch switches, pushes and edits
to the main tree from a worktree. Work that spawns processes uses
`limited(items, n, each)` (`limited.ts`) rather than `Promise.all`, and
`READ_CONCURRENCY` (8) caps task reads, since each runs several git
processes.

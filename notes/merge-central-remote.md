---
description: With a central remote configured, merge pushes the tested branch as splates/<task> and moves the remote's trunk only while it holds the merge lease
---

When `remote` is set in `splates.config.ts` and the base is trunk, merge
fetches the remote's trunk, rebases onto it, gates, pushes the tested branch
as `splates/<task>` (`PUSHED_PREFIX`), then moves the remote's trunk itself
through `CoordinatorLanding` (`merge/trunk.ts`). It refuses unless it still
holds the merge lease (`merge.lock`, its holder judged by pid on the same
host and by heartbeat elsewhere) and trunk is still the tested commit, then
pushes trunk `--force-with-lease` against that commit.

The branch is pushed with a GitHub App installation token
(`merge/github-app.ts`), about an hour long and scoped to that repository's
contents, sent to git through the environment and never written to disk; a
ruleset on trunk keeps the App to `splates/*`. A local trunk ahead of the
remote is refused until the person pushes it. `splates checkpoint` pushes
the same branch with a `WIP: checkpoint` commit, so a task stopped mid-work
loses nothing past its last checkpoint.

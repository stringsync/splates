---
description: With a central remote configured, only the coordinator moves trunk; a task pushes its tested branch as splates/<task> with a short-lived GitHub App token and asks the coordinator to land it
---

When `remote` is set in `splates.config.ts` and the base is trunk, merge
fetches the remote's trunk, rebases onto it, gates, pushes the tested branch
as `splates/<task>` (`PUSHED_PREFIX`), and asks the coordinator to move
trunk: `CoordinatorLanding` (`merge/trunk.ts`), in-process on the
coordinator or `POST /api/land` from a worker. It refuses unless the asker
still holds the merge lease (`merge.lock` on the coordinator's disk, its
holder judged by pid on the same host and by heartbeat elsewhere) and trunk
is still the tested commit, then pushes trunk with the coordinator's own
credentials, `--force-with-lease` against that commit.

Workers push with GitHub App installation tokens (`merge/github-app.ts`),
about an hour long and scoped to that repository's contents, sent to git
through the environment and never written to a worker's disk; a ruleset on
trunk keeps the App to `splates/*`. A worker with no remote set is refused,
since it can land on trunk only through the remote, and a local trunk ahead
of the remote is refused until the person pushes it. `splates checkpoint`
pushes the same branch with a `WIP: checkpoint` commit, so a worker that
dies loses nothing past its last checkpoint.

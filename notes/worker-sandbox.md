---
description: The bubblewrap sandbox in workers/sandbox.ts, kept for runners now that no remote worker runs agents; this machine's own worker never sandboxes
---

`workers/sandbox.ts` wraps each process a worker other than this machine's
own starts in bubblewrap on Linux, and refuses to run as root
(`agentSandbox` in `workers/run.ts`). It served remote agents, which were
removed on 2026-10-22 along with the relay that let `splates` on a worker
reach the coordinator's records and the clones a worker kept. It is kept
for the runners that heavy jobs come back on. This machine's own worker
starts its agents unsandboxed, as the person, in the person's own
worktrees, whose `.git` a sandbox would cut off.

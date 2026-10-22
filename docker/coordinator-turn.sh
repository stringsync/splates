#!/bin/sh
# One turn of the scripted agent (`scripted-agent.ts`) proving the
# server (`prove-coordinator.sh`), on the box's own worker: told
# `[SPLATES TASK <task>]`, it claims the task, serves a page on a port for
# the server to list, waits for whoever watches to open it, commits
# and merges through the gate.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
splates() { bun "$(dirname "$here")/packages/splates/index.ts" "$@"; }
task=$(printf '%s' "$1" | sed -n 's/.*\[SPLATES TASK \([^]]*\)\].*/\1/p')
[ -n "$task" ] || { echo "no task in: $1"; exit 0; }
cd "$(splates claim "$task" | sed -n 's/^ *worktree: *//p')"
echo "on $(uname -sm) in $(pwd), dialed to ${SPLATES_DEV:-nothing}"

port=4777
nohup bun -e "Bun.serve({ port: $port, fetch: () => new Response('<title>from the agent</title>served by the agent', { headers: { 'content-type': 'text/html' } }) })" >/dev/null 2>&1 &
trap 'kill $! 2>/dev/null || true' EXIT
sleep 1
echo "serving on $port"

# Held until whoever watches has opened the port the server lists,
# who says so by creating $PROVE_OPENED, or half a minute has passed.
if [ -n "${PROVE_OPENED:-}" ]; then
	for _ in $(seq 30); do [ -e "$PROVE_OPENED" ] && break; sleep 1; done
fi

echo "from the agent" > agent.txt
git add agent.txt
git commit -qm "Add a file from the agent of a Linux coordinator"
printf '# %s\n\n## Goal\n\nprove the coordinator\n\n## Done\n\n- [x] it\n' "$task" > SPLATES.md
splates merge

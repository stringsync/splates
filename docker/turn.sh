#!/bin/sh
# One turn of the scripted agent (`scripted-agent.ts`) proving a worker:
# told `[SPLATES TASK <task>]`, it claims the task, serves a page on a port
# for the coordinator to forward, opens it in the browser it was offered,
# commits, and merges.
set -eu
task=$(printf '%s' "$1" | sed -n 's/.*\[SPLATES TASK \([^]]*\)\].*/\1/p')
[ -n "$task" ] || { echo "no task in: $1"; exit 0; }
# Opened in the project's clone, it claims the task into a clone of its own.
cd "$(splates claim "$task" | sed -n 's/^ *worktree: *//p')"
echo "on $(uname -sm) in $(pwd)"

# A dev server, left running for `splates ports` to find and forward.
port=4777
nohup bun -e "Bun.serve({ port: $port, fetch: () => new Response('<title>from linux</title>served on the worker', { headers: { 'content-type': 'text/html' } }) })" >/dev/null 2>&1 &
sleep 1
echo "serving on $port"

# The browser: a page opened through the MCP the session was offered.
if [ -n "${MCP_URL:-}" ]; then
	echo "browser mcp: $MCP_URL"
	bun "$(dirname "$0")/browse.ts" "$MCP_URL" "http://127.0.0.1:$port/"
else
	echo "no browser mcp offered"
fi

# Held until whoever watches has opened the port through the coordinator,
# who says so by `$HOME/opened`, or a minute has passed.
for _ in $(seq 60); do [ -e "$HOME/opened" ] && break; sleep 1; done
rm -f "$HOME/opened"

echo "from the linux worker" > linux.txt
git add linux.txt
git commit -qm "Add a file from the Linux worker"
printf '# %s\n\n## Goal\n\nprove the worker\n\n## Done\n\n- [x] it\n' "$task" > SPLATES.md
splates merge

#!/bin/sh
# Proves a server moves through its replica, end to end and without Docker: a
# throwaway project whose splates.config.ts names a `dir` replica, a server
# on this machine that queues a task and copies it there, then a second
# splates home, as another machine's, restored from the folder alone, where
# the task is listed and the first home is retired. Needs nothing of the
# user's: no credentials, no splates home.
#
#   docker/prove-restore.sh [port]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
checkout=$(dirname "$here")
port=${1:-4393}
dir=$(mktemp -d /private/tmp/splates-prove-XXXXXX)
pid=""
trap '[ -z "$pid" ] || { pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true; }; echo "left in $dir"' EXIT

# This checkout's `splates` with the splates home $1.
as() {
	home=$1
	shift
	env -i HOME="$HOME" PATH="$PATH" SPLATES_SECRET_STORE=file SPLATES_HOME="$home" bun "$checkout/packages/splates/index.ts" "$@"
}

mkdir -p "$dir/repo"
cd "$dir/repo"
git init -q -b main
git config user.email prove@example.com
git config user.name prove
git config commit.gpgsign false
printf 'export default { remote: null, replica: { provider: "dir", path: "%s" } };\n' "$dir/replica" >splates.config.ts
git add -A
git commit -qm init
as "$dir/mac" init >/dev/null 2>&1

echo "--- a server here queues a task and copies it into the replica"
as "$dir/mac" server --port "$port" >"$dir/server.log" 2>&1 &
pid=$!
until grep -q "splates server on" "$dir/server.log"; do sleep 1; done
as "$dir/mac" task add "carry me over" "proves a restore" --slug carry-me >/dev/null
until grep -rq "carry me over" "$dir/replica" 2>/dev/null; do sleep 1; done
as "$dir/mac" replica status
pkill -P "$pid" 2>/dev/null || true
kill "$pid" 2>/dev/null || true
pid=""
wait 2>/dev/null || true

echo "--- another machine's home restores from the folder alone"
as "$dir/droplet" replica restore
as "$dir/droplet" task list | tee "$dir/tasks.txt"
grep -q "carry me over" "$dir/tasks.txt"

echo "--- the first home is retired and says where the server went"
as "$dir/mac" replica retire droplet
if as "$dir/mac" task list >"$dir/after.txt" 2>&1; then exit 1; fi
cat "$dir/after.txt"
grep -q "moved to droplet" "$dir/after.txt"
echo "restore proved"

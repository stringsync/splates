#!/bin/sh
# Proves a Linux container as a runner of a server on this machine, end to
# end: a throwaway server and project, the image `worker.Dockerfile` builds
# joined with a token, and `splates run` run in the project, which goes to
# the runner as a snapshot of the worktree, uncommitted edit included. It checks
# the command ran on Linux in a checkout the project's `prepare` step had run
# in, that its output and exit code came back, and that a second job ships
# nothing the runner holds. Needs Docker, whose `host.docker.internal` reaches
# this machine's loopback, and nothing of the user's: no credentials, no
# splates home.
#
#   docker/prove-runner.sh [port]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
checkout=$(dirname "$here")
port=${1:-4392}
. "$here/prove-lib.sh"

echo "building the worker image"
docker build -q -f "$here/worker.Dockerfile" -t splates-worker "$checkout" >/dev/null

mkdir -p "$dir/home" "$dir/repo"
cd "$dir/repo"
git init -q -b main
git config user.email prove@example.com
git config user.name prove
git config commit.gpgsign false
printf 'export default { remote: null, prepare: "echo prepared > marker.txt" };\n' >splates.config.ts
echo committed >tracked.txt
splates init >/dev/null 2>&1
git add -A
git commit -qm init

echo "starting the server on $port"
splates server --port "$port" >"$dir/server.log" 2>&1 &
ends $!
until grep -q "splates server on" "$dir/server.log"; do sleep 1; done
port=$(sed -n 's/.*splates server on http:\/\/127\.0\.0\.1:\([0-9]*\).*/\1/p' "$dir/server.log")

echo "--- with no runner joined, the job runs here"
splates run -- sh -c 'echo here:$(uname -s)' | tee "$dir/local.txt"
grep -q "^here:" "$dir/local.txt"
if [ "$(uname -s)" != Linux ]; then ! grep -q "Linux" "$dir/local.txt"; fi

token=$(splates worker add 2>&1 | grep -o 'splj_[A-Za-z0-9_.=-]*' | head -1)
holds "$name"
# The worker dials its server over plain http only on its own loopback, so a
# forwarder there reaches this machine's.
docker run -d --name "$name" --entrypoint sh splates-worker -c \
	"bun /home/splates/splates/docker/forward.ts $port $port host.docker.internal & exec splates worker run --coordinator http://127.0.0.1:$port --join $token --id linux-runner --ephemeral" >/dev/null
until splates worker list 2>/dev/null | grep -q "linux-runner .*connected"; do sleep 1; done
splates worker list

echo "--- a job on the runner, with an edit that is not committed"
echo edited >tracked.txt
echo untracked >new.txt
code=0
splates run -- sh -c 'echo on:$(uname -s); cat tracked.txt new.txt marker.txt; exit 3' >"$dir/runner.txt" || code=$?
cat "$dir/runner.txt"
[ "$code" = 3 ]
grep -q "^on:Linux" "$dir/runner.txt"
grep -q "^edited" "$dir/runner.txt"
grep -q "^untracked" "$dir/runner.txt"
grep -q "^prepared" "$dir/runner.txt"
[ "$(cat tracked.txt)" = edited ]
[ ! -e marker.txt ]

echo "--- a second job, shipping only what changed"
echo more >new.txt
splates run -- cat new.txt | tee "$dir/second.txt"
grep -q "^more" "$dir/second.txt"
echo "proved"

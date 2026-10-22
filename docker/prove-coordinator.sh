#!/bin/sh
# Proves the server on Linux end to end: `splates server` runs in a
# Debian container as the user `splates`, and runs its agents there too.
# Through the CLI and the server's routes it registers a project, adds a
# task, has the scripted agent (`scripted-agent.ts`, `coordinator-turn.sh`)
# claim it in the box, serve a port the server lists, commit and merge
# through the gate, and looks for the conversation log and the journal. It
# restarts the server and looks for the records and the page's snapshot and
# event stream to survive, archives the conversation, and asks for a cred,
# which the box keeps in its secret service. Needs Docker and nothing of the
# user's: no credentials, no splates home. What Docker cannot stand in for
# (systemd, cloudflared) is not proved here.
#
#   docker/prove-coordinator.sh [port]
set -eu
port=${1:-4391}
. "$(cd "$(dirname "$0")" && pwd)/prove-lib.sh"
inner=4269

echo "building the image"
docker build -q -f "$here/worker.Dockerfile" -t splates-worker "$checkout" >/dev/null
docker build -q -f "$here/coordinator.Dockerfile" -t splates-coordinator "$checkout" >/dev/null

# The server's box: the worker image with a secret service and a shell
# for its entry, the remote shared at its path here, and the server's port
# published on this machine's loopback through a forwarder. Unconfined so bubblewrap may
# sandbox the agents of its own worker (`workers/sandbox.ts`).
holds "$name"
docker run -d --name "$name" --entrypoint sh -v "$dir:$dir" \
	-p "127.0.0.1:$port:$((inner + 1))" \
	--security-opt seccomp=unconfined --security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined splates-coordinator \
	/home/splates/splates/docker/coordinator-entry.sh "$((inner + 1))" "$inner" >/dev/null
until docker exec "$name" test -e /home/splates/session.env; do sleep 1; done
# Anything run in the box, with the session bus of its secret service.
box() {
	docker exec -e SPLATES_DEV="http://127.0.0.1:$inner" "$name" \
		sh -c '. "$HOME/session.env"; exec "$@"' sh "$@"
}
boxsplates() { box splates "$@"; }
box git config --global --add safe.directory '*'

prove_remote 'preMerge: "true", remote: "origin"' "$dir/repo"
box git clone -q "$dir/remote.git" /home/splates/project
box sh -c 'cd /home/splates/project && git config user.email prove@example.com && git config user.name prove && git config commit.gpgsign false && splates init >/dev/null 2>&1 && git add -A && git commit -qm skill && git push -q origin main'
boxsplates agents >/dev/null
box sh -c 'cp ~/.splates/agents.json /tmp/agents.json'
docker cp "$name:/tmp/agents.json" "$dir/agents.json"
prove_roster "$dir/agents.json" coordinator-turn.sh
docker cp "$dir/agents.json" "$name:/home/splates/.splates/agents.json"

# The turn holds its port open until $PROVE_OPENED exists: in the home,
# which its agent's sandbox sees.
opened=/home/splates/opened
start_server() {
	docker exec -d -e PROVE_OPENED="$opened" "$name" sh -c ". \$HOME/session.env; splates server run --port $inner >>/home/splates/server.log 2>&1"
	until box curl -fsS "http://127.0.0.1:$inner/api/snapshot" >/dev/null 2>&1; do sleep 1; done
}
echo "starting the coordinator"
start_server

# From inside the project, as the agents of the box would.
proj() { box sh -c "cd /home/splates/project && splates $*"; }
get() { curl -fsS "http://127.0.0.1:$port$1"; }

echo "--- a task for the scripted agent, run by the box's own worker"
proj add proof --agent scripted --model script --goal "'prove the Linux coordinator'"
log() { box sh -c 'grep -l "\"task\":\"proof\"" /home/splates/project/.git/splates/conversations/*.jsonl 2>/dev/null | head -1'; }
fail() { echo "$1"; box cat /home/splates/server.log; exit 1; }

echo "--- the task's port, listed by the server while its agent holds it open"
waits=0
until proj ports proof 2>/dev/null | grep -q 4777; do
	waits=$((waits + 1))
	[ "$waits" -lt 90 ] || fail "no port listed"
	sleep 1
done
proj ports proof
served=$(proj ports proof --json | bun -e 'const { ports } = JSON.parse(await Bun.stdin.text()); console.log(ports[0].local)')
box curl -fsS "$served/"
echo
box touch "$opened"

echo "waiting for the agent's turn"
conv=""
waits=0
until [ -n "$conv" ] && box grep -q '"turn","running":false' "$conv"; do
	waits=$((waits + 1))
	[ "$waits" -lt 150 ] || fail "the turn never ended"
	sleep 2
	conv=$(log)
done
box cat "$conv" >"$dir/conversation.jsonl"
echo "--- what the agent said"
prove_said "$dir/conversation.jsonl" | tee "$dir/said.txt"
grep -q "^on Linux" "$dir/said.txt"
echo "--- trunk on the remote"
git -C "$dir/remote.git" log --oneline -3 main
git -C "$dir/remote.git" log -1 --format=%s main | grep -q "agent of a Linux coordinator"
echo "--- the journal"
proj log | tee "$dir/log.txt"
grep -q proof "$dir/log.txt"

echo "--- a queued task and the page's view of it, before the restart"
proj task add "'kept across a restart'" --slug kept-across >/dev/null
get /api/snapshot >"$dir/before.json"
grep -q 'kept across' "$dir/before.json"
get /api/snapshot | grep -q proof && echo "(the merged task is still on the board)" || true

echo "--- restarting the coordinator"
box sh -c 'pkill -f "[s]erver run" || true'
sleep 2
start_server
get /api/snapshot >"$dir/after.json"
grep -q 'kept across' "$dir/after.json"
proj log | grep -q proof
# The page's event stream, which tells of a change as it happens: a task
# added while it is open comes down it.
curl -fsSN -m 6 "http://127.0.0.1:$port/events" >"$dir/events.txt" 2>/dev/null &
listening=$!
sleep 2
proj task add "'told by the stream'" --slug streamed >/dev/null
wait "$listening" || true
grep -q ': connected' "$dir/events.txt"
grep -q 'data: changed' "$dir/events.txt"

echo "--- archiving the conversation"
id=$(basename "$conv" .jsonl)
curl -fsS -X PUT -H "origin: http://127.0.0.1:$port" -H 'content-type: application/json' -d '{"archived":true}' \
	"http://127.0.0.1:$port/api/conversations/$id/archived" >/dev/null
get /api/conversations | grep -q "$id"
echo "archived $id"

echo "--- a cred, kept in the box's secret service"
proj creds request PROVE_TOKEN --purpose "'prove the cred store'" --instructions "'paste anything'" >/dev/null
proj creds list | grep -q PROVE_TOKEN
curl -fsS -X PUT -H "origin: http://127.0.0.1:$port" -H 'content-type: application/json' \
	-d '{"value":"not-a-secret","scope":"project"}' \
	"http://127.0.0.1:$port/api/creds/PROVE_TOKEN" >/dev/null
proj creds list | tee "$dir/creds.txt"
grep -q PROVE_TOKEN "$dir/creds.txt"
echo "proved"

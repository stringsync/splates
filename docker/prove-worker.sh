#!/bin/sh
# Proves a Linux container as a second worker of a coordinator on this
# machine, end to end: a throwaway coordinator and project requiring Linux,
# the image `worker.Dockerfile` builds, joined with a token, and a task
# handed to the scripted agent (`scripted-agent.ts`, `turn.sh`), which runs
# in the container: it claims the task into a clone there, serves a port the
# coordinator forwards, opens it in the worker's own browser, checks it
# runs in a sandbox of its own, and merges. Needs Docker, whose
# `host.docker.internal` reaches this machine's loopback, and nothing of
# the user's: no credentials, no splates home.
#
# With `--agent` and `--model`, a roster agent takes the task instead, told
# to do as the scripted one does; it runs on whatever key the coordinator
# delivers or login the container has, and what it does is printed, not
# checked.
#
#   docker/prove-worker.sh [--agent <id> --model <model>] [port]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
checkout=$(dirname "$here")
agent=scripted
model=script
while [ $# -gt 0 ]; do
	case $1 in
	--agent) agent=$2; shift 2 ;;
	--model) model=$2; shift 2 ;;
	*) break ;;
	esac
done
port=${1:-4390}
# Under /private, which Docker Desktop shares, at the same path inside the
# container, so the project's remote is one URL on both.
dir=$(mktemp -d /private/tmp/splates-prove-XXXXXX)
name=splates-prove-$$
server=""
daemon=""

cleanup() {
	docker rm -f "$name" >/dev/null 2>&1 || true
	[ -n "$server" ] && kill "$server" 2>/dev/null || true
	[ -n "$daemon" ] && kill "$daemon" 2>/dev/null || true
	echo "left in $dir"
}
trap cleanup EXIT

splates() {
	# Nothing of the agent this runs under, so the task reads as the person's.
	env -i HOME="$HOME" PATH="$PATH" SPLATES_HOME="$dir/home" \
		SPLATES_DEV="http://127.0.0.1:$port" \
		bun "$checkout/packages/splates/index.ts" "$@"
}

echo "building the worker image"
docker build -q -f "$here/worker.Dockerfile" -t splates-worker "$checkout" >/dev/null

mkdir -p "$dir/home"
git init -q --bare -b main "$dir/remote.git"
git init -q -b main "$dir/repo"
cd "$dir/repo"
git config user.email prove@example.com
git config user.name prove
git config commit.gpgsign false
printf 'export default { preMerge: "true", remote: "origin", platform: "linux" };\n' >splates.config.ts
git add -A
git commit -qm init
git remote add origin "$dir/remote.git"
git push -q origin main
splates init >/dev/null 2>&1
git add -A
git commit -qm skill
git push -q origin main

# The roster, with the scripted agent beside the defaults, wherever it runs.
splates agents >/dev/null
bun -e '
const [path, here] = process.argv.slice(1);
const roster = JSON.parse(await Bun.file(path).text());
const find = `d=/home/splates/splates/docker; [ -d "$d" ] || d=${here}; exec bun "$d/scripted-agent.ts" "$d/turn.sh"`;
roster.agents.push({
	id: "scripted",
	name: "Scripted",
	argv: ["sh", "-c", find],
	models: [{ id: "script", name: "Script", strengths: "proving a worker", cost: "none" }],
});
await Bun.write(path, JSON.stringify(roster, null, "\t"));
' "$dir/home/agents.json" "$here"

echo "starting the coordinator on $port"
splates server --port "$port" >"$dir/server.log" 2>&1 &
server=$!
until grep -q "splates server on" "$dir/server.log"; do sleep 1; done
# The port it took, the next free one when another server holds this one.
port=$(sed -n 's/.*splates server on http:\/\/127\.0\.0\.1:\([0-9]*\).*/\1/p' "$dir/server.log")

token=$(splates worker add 2>&1 | grep -o 'splj_[A-Za-z0-9_.=-]*' | head -1)
# Unconfined, so bubblewrap may make the namespaces and mount the `/proc`
# that sandbox each agent (`packages/server/workers/sandbox.ts`).
docker run -d --name "$name" -v "$dir/remote.git:$dir/remote.git" \
	--security-opt seccomp=unconfined --security-opt apparmor=unconfined \
	--security-opt systempaths=unconfined splates-worker \
	--coordinator "http://host.docker.internal:$port" --join "$token" --id linux-box --slots 2 >/dev/null
# The mount is owned by this machine's user, not the container's.
docker exec "$name" git config --global --add safe.directory '*'
# An agent's sandbox sees the mount read-only, as it sees all but its
# project, so the container pushes through a git daemon here instead, as a
# worker would to a remote anywhere.
git daemon --reuseaddr --listen=127.0.0.1 --port="$((port + 1000))" \
	--base-path="$dir" --export-all --enable=receive-pack "$dir" 2>"$dir/daemon.log" &
daemon=$!
docker exec "$name" git config --global \
	url."git://host.docker.internal:$((port + 1000))/remote.git".pushInsteadOf "$dir/remote.git"
until splates worker list 2>/dev/null | grep -q "linux-box .*connected"; do sleep 1; done
splates worker list
docker logs "$name" 2>&1 | grep -q "each agent runs in a sandbox of its own" || {
	docker logs "$name" 2>&1 | grep "agents run unsandboxed"
	exit 1
}

if [ "$agent" != scripted ]; then
	splates add proof --agent "$agent" --model "$model" --goal "prove the Linux worker: add linux.txt holding the output of \`uname -sm\` and \`ls /proc | grep -c '^[0-9]'\`, commit it, and merge"
else
	splates add proof --agent scripted --model script --goal "prove the Linux worker"
fi

log() { grep -l '"task":"proof"' "$dir"/repo/.git/splates/conversations/*.jsonl 2>/dev/null | head -1; }
said() {
	grep '"agent_message_chunk"' "$(log)" | bun -e '
for (const line of (await Bun.stdin.text()).trim().split("\n")) {
	const { content } = JSON.parse(line).update;
	if (content.type === "text") process.stdout.write(content.text);
}'
}

if [ "$agent" != scripted ]; then
	echo "waiting for $agent's turn"
	until [ -n "$(log)" ] && grep -q '"turn","running":false' "$(log)"; do sleep 2; done
	echo "--- what the agent said"
	said
	echo
	echo "--- trunk on the remote"
	git -C "$dir/remote.git" log --oneline -3 main
	git -C "$dir/remote.git" show main:linux.txt 2>/dev/null || echo "no linux.txt on trunk"
	exit 0
fi

echo "--- the task's port, forwarded here while its agent holds it open"
until splates ports proof 2>/dev/null | grep -q 4777; do sleep 1; done
splates ports proof
local=$(splates ports proof --json | bun -e 'const { ports } = JSON.parse(await Bun.stdin.text()); console.log(ports[0].local)')
curl -fsS "$local/"
echo
# In the project's directory, where its sandboxed agent can see and remove it.
docker exec "$name" touch /home/splates/.splates/worker/projects/repo/opened

echo "waiting for the agent's turn"
until [ -n "$(log)" ] && grep -q '"turn","running":false' "$(log)"; do sleep 2; done
echo "--- what the agent said"
said | tee "$dir/said.txt"
grep -q "^sandboxed:" "$dir/said.txt"
echo "--- trunk on the remote"
git -C "$dir/remote.git" log --oneline -3 main
git -C "$dir/remote.git" log -1 --format=%s main | grep -q "Linux worker"
echo "proved"

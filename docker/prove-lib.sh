# Plumbing `prove-coordinator.sh` sources: a scratch directory under
# /private, which Docker Desktop shares, so a path is one on this machine and in a container; the
# `splates` of this checkout, run as the person and nothing of the agent
# this runs under; the roster with the scripted agent (`scripted-agent.ts`)
# beside the defaults; and the throwaway project's bare remote.
here=$(cd "$(dirname "$0")" && pwd)
checkout=$(dirname "$here")
dir=$(mktemp -d /private/tmp/splates-prove-XXXXXX)
name=splates-prove-$$
pids=""
containers=""

# Each process or container a proof starts is told here to be ended with it.
ends() { pids="$pids $1"; }
holds() { containers="$containers $1"; }
cleanup() {
	for each in $containers; do docker rm -f "$each" >/dev/null 2>&1 || true; done
	# The server, as the supervisor runs it, and its worker are children.
	for each in $pids; do
		pkill -P "$each" 2>/dev/null || true
		kill "$each" 2>/dev/null || true
	done
	echo "left in $dir"
}
trap cleanup EXIT

# This machine's `splates` against the server at $port, with a splates
# home of its own under $dir.
splates() {
	env -i HOME="$HOME" PATH="$PATH" SPLATES_HOME="$dir/home" \
		SPLATES_DEV="http://127.0.0.1:$port" \
		bun "$checkout/packages/splates/index.ts" "$@"
}

# A bare remote for the project, holding its first commit: `splates.config.ts`
# with $1 as the config's fields, in a repository at $2.
prove_remote() {
	git init -q --bare -b main "$dir/remote.git"
	git init -q -b main "$2"
	(
		cd "$2"
		git config user.email prove@example.com
		git config user.name prove
		git config commit.gpgsign false
		printf 'export default { %s };\n' "$1" >splates.config.ts
		git add -A
		git commit -qm init
		git remote add origin "$dir/remote.git"
		git push -q origin main
	)
}

# Adds the scripted agent, running the script $2 (coordinator-turn.sh), to the roster file $1, wherever it runs: from the
# image's checkout when there is one, else from this one.
prove_roster() {
	bun -e '
const [path, here, turn] = process.argv.slice(1);
const roster = JSON.parse(await Bun.file(path).text());
const find = `d=/home/splates/splates/docker; [ -d "$d" ] || d=${here}; exec bun "$d/scripted-agent.ts" "$d/${turn}"`;
roster.agents.push({
	id: "scripted",
	name: "Scripted",
	argv: ["sh", "-c", find],
	models: [{ id: "script", name: "Script", strengths: "proving a worker", cost: "none" }],
});
await Bun.write(path, JSON.stringify(roster, null, "\t"));
' "$1" "$here" "${2:-coordinator-turn.sh}"
}

# What the agent said in the conversation log $1, as it was streamed.
prove_said() {
	grep '"agent_message_chunk"' "$1" | bun -e '
for (const line of (await Bun.stdin.text()).trim().split("\n")) {
	const { content } = JSON.parse(line).update;
	if (content.type === "text") process.stdout.write(content.text);
}'
}

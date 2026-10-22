import type { JobSize } from "./job-size";
import { SNAPSHOT_USER } from "./snapshot";

/**
 * The shell a runner `splates run` makes for itself is driven by, over SSH:
 * every script here runs as `SNAPSHOT_USER` under `$HOME/direct`, holding
 * nothing but a bare clone per project, a reservation file per job and when
 * it was last used. They run in bash, which a stock Ubuntu and macOS both
 * have, so the tests run them here as they run there.
 */

/** Where on a runner its jobs and clones are kept, under the user's home. */
const ROOT = '"$HOME/direct"';

/** Marks a runner whose boot finished, for a job to wait on. */
const READY = '"$HOME/.splates-ready"';

/** How long a reservation may wait for its job before it counts as abandoned, in seconds. */
const RESERVED_FOR = 300;

/**
 * The machine's user data: the recipe first on a stock image, then the key
 * `splates run` logs in with, for `SNAPSHOT_USER`, and the mark that it is
 * ready. No secret is in it: the key is the public half.
 */
export function directBootScript(
	publicKey: string,
	recipe: string | null,
): string {
	const home = `/home/${SNAPSHOT_USER}`;
	return [
		"#!/bin/sh",
		"set -eu",
		...(recipe === null
			? []
			: [
					"cat > /root/splates-recipe.sh <<'SPLATES_RECIPE'",
					recipe.trimEnd(),
					"SPLATES_RECIPE",
					"sh /root/splates-recipe.sh > /var/log/splates-recipe.log 2>&1",
					"rm /root/splates-recipe.sh",
				]),
		`id ${SNAPSHOT_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${SNAPSHOT_USER}`,
		`install -d -m 700 -o ${SNAPSHOT_USER} -g ${SNAPSHOT_USER} ${home}/.ssh`,
		`printf '%s\\n' ${shellQuoted(publicKey.trim())} >> ${home}/.ssh/authorized_keys`,
		`chown ${SNAPSHOT_USER}:${SNAPSHOT_USER} ${home}/.ssh/authorized_keys`,
		`chmod 600 ${home}/.ssh/authorized_keys`,
		`su - ${SNAPSHOT_USER} -c 'mkdir -p ~/direct/jobs && date +%s > ~/direct/last-used && touch ~/.splates-ready'`,
		"",
	].join("\n");
}

/** What a job writes on its stderr once its prepare step is done, which `splates run` takes out of the output. */
export const STARTED_LINE = "\u001esplates:started\n";

/** What `directReserveScript` answers. */
export type Reserved = "ok" | "full" | "booting";

/**
 * Reserves `size` of a runner holding `capacity` for job `id`, if the jobs
 * on it leave room: answers `ok` having written the reservation, `full`, or
 * `booting` before its boot has finished. A lock directory keeps two
 * reservations from racing; a job gone, or a reservation its job never
 * took up, frees its room.
 */
export function directReserveScript(opts: Reservation): string {
	const { id, project, size, capacity } = opts;
	return script([
		"set -eu",
		`[ -f ${READY} ] || { echo booting; exit 0; }`,
		`root=${ROOT}`,
		'jobs="$root/jobs"',
		'mkdir -p "$jobs"',
		...LOCKED,
		...USED,
		"set -- $used",
		`if awk -v c="$1" -v m="$2" 'BEGIN { exit !(c + ${size.cpus} <= ${capacity.cpus} + 1e-9 && m + ${size.memory} <= ${capacity.memory} + 1e-9) }'; then`,
		`  echo "${size.cpus} ${size.memory} - $now" > "$jobs/${id}.job"`,
		'  date +%s > "$root/last-used"',
		`  repo="$root/${project}/repo.git"`,
		'  [ -f "$repo/HEAD" ] || git init --bare --quiet "$repo"',
		"  echo ok",
		"else",
		"  echo full",
		"fi",
	]);
}

/** What `directReserveScript` reserves. */
export interface Reservation {
	id: string;
	project: string;
	size: JobSize;
	/** All the runner holds. */
	capacity: JobSize;
}

/**
 * Whether a runner is busy: answers `busy` while a job holds room on it,
 * `idle <seconds>` since it last ran one, or `booting`.
 */
export function directIdleScript(): string {
	return script([
		"set -eu",
		`[ -f ${READY} ] || { echo booting; exit 0; }`,
		`root=${ROOT}`,
		'jobs="$root/jobs"',
		'mkdir -p "$jobs"',
		...LOCKED,
		...USED,
		"set -- $used",
		`if [ "$1" != 0 ] || [ "$2" != 0 ]; then echo busy; exit 0; fi`,
		'last=$(cat "$root/last-used" 2>/dev/null || echo "$now")',
		'echo "idle $((now - last))"',
	]);
}

/** What `directJobScript` runs. */
export interface DirectJob {
	id: string;
	project: string;
	commit: string;
	size: JobSize;
	argv: string[];
	env: Record<string, string>;
	/** Run via `sh -c` in the checkout before the command; null runs none. */
	prepare: string | null;
	/** Seconds the prepare step and the command may run together; null for no limit. */
	timeout: number | null;
	/** Whether the files the command writes are kept for `directFilesScript` to send. */
	files: boolean;
}

/**
 * Runs a job on the runner: checks `commit` out of the project's clone in a
 * throwaway worktree, runs the prepare step and the command there in a
 * process group of their own, their output its own, and exits with the
 * command's code. Its stdin closing, as when `splates run` hangs up, kills
 * the group, as does the timeout passing, which exits 124. The checkout and
 * the reservation go once it ends.
 */
export function directJobScript(job: DirectJob): string {
	const { id, project, commit, size } = job;
	const exports = Object.entries({
		...job.env,
		SPLATES_HEAVY: "runner",
		SPLATES_CORES: String(Math.max(1, Math.floor(size.cpus))),
	}).map(([name, value]) => `export ${name}=${shellQuoted(value)}`);
	return script([
		"set -u",
		'export PATH="$HOME/.bun/bin:$PATH"',
		`root=${ROOT}`,
		`repo="$root/${project}/repo.git"`,
		`dir="$root/${project}/jobs/${id}"`,
		'tree="$dir/tree"',
		`mark="$root/jobs/${id}.job"`,
		'mkdir -p "$dir/files"',
		"finish() {",
		'  git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"',
		'  git -C "$repo" worktree prune >/dev/null 2>&1',
		`  git -C "$repo" update-ref -d ${jobRef(id)} >/dev/null 2>&1`,
		job.files ? '  rm -f "$dir/expired"' : '  rm -rf "$dir"',
		'  rm -f "$mark"',
		'  date +%s > "$root/last-used"',
		"}",
		`if ! git -C "$repo" worktree add --quiet --detach "$tree" ${commit}; then`,
		"  echo 'splates: the runner could not check the job out' >&2",
		"  finish",
		"  exit 1",
		"fi",
		// The job's stdin is the caller's line, and its stderr its own: the
		// shell's goes nowhere, so job control reports nothing on it.
		"exec 3<&0 4>&2 2>/dev/null",
		"set -m",
		"(",
		'  cd "$tree" || exit 1',
		'  export SPLATES_WORKTREE="$tree" SPLATES_JOB_FILES="$dir/files"',
		...exports.map((line) => `  ${line}`),
		...(job.prepare === null
			? []
			: [
					`  sh -c ${shellQuoted(job.prepare)} || exit $?`,
					`  printf '%s' ${shellQuoted(STARTED_LINE)} >&2`,
				]),
		`  exec ${job.argv.map(shellQuoted).join(" ")}`,
		") </dev/null 2>&4 &",
		"pid=$!",
		`echo "${size.cpus} ${size.memory} $pid $(date +%s)" > "$mark"`,
		// The caller hanging up closes this stdin.
		"( cat <&3 >/dev/null; kill -TERM -- -$pid 2>/dev/null ) &",
		"watch=$!",
		...(job.timeout === null
			? ["timer="]
			: [
					`( sleep ${job.timeout}; : > "$dir/expired"; kill -TERM -- -$pid 2>/dev/null; sleep 10; kill -KILL -- -$pid 2>/dev/null ) &`,
					"timer=$!",
				]),
		"wait $pid",
		"code=$?",
		"kill -- -$watch 2>/dev/null",
		'[ -z "$timer" ] || kill -- -$timer 2>/dev/null',
		'if [ -f "$dir/expired" ]; then',
		`  printf '\\nsplates: killed after running past its %s timeout; set a longer one with \`splates run --timeout\` or the project'"'"'s job.timeout in splates.config.ts\\n' ${shellQuoted(timeoutText(job.timeout))} >&4`,
		"  code=124",
		"fi",
		"finish",
		"exit $code",
	]);
}

/**
 * Sends the files a job kept, each named `names` that it wrote, as one line
 * of `name` and its base64, then forgets the job's directory.
 */
export function directFilesScript(opts: JobFiles): string {
	return script([
		"set -u",
		`dir=${ROOT}/${opts.project}/jobs/${opts.id}`,
		`for name in ${opts.names.map(shellQuoted).join(" ")}; do`,
		'  if [ -f "$dir/files/$name" ]; then',
		`    printf '%s\\t' "$name"`,
		`    base64 < "$dir/files/$name" | tr -d '\\n'`,
		"    echo",
		"  fi",
		"done",
		'rm -rf "$dir"',
	]);
}

/** Which files of which job `directFilesScript` sends. */
export interface JobFiles {
	id: string;
	project: string;
	names: readonly string[];
}

/** The ref a job's commit is pushed to on the runner, kept until it ends. */
export function jobRef(id: string): string {
	return `refs/splates/jobs/${id}`;
}

/** Where a project's bare clone is on a runner, from the user's home. */
export function directRepo(project: string): string {
	return `direct/${project}/repo.git`;
}

/** `word` as one argument of a shell command. */
export function shellQuoted(word: string): string {
	return `'${word.replaceAll("'", "'\\''")}'`;
}

/** Takes the jobs' lock directory, stealing one a dead script left after 30 s. */
const LOCKED = [
	'lock="$jobs/.lock"',
	"tries=0",
	'until mkdir "$lock" 2>/dev/null; do',
	"  tries=$((tries + 1))",
	'  if [ "$tries" -ge 300 ]; then rmdir "$lock" 2>/dev/null || true; tries=0; fi',
	"  sleep 0.1",
	"done",
	"trap 'rmdir \"$lock\"' EXIT",
];

/** Sums what the jobs on the runner hold, as `$used` "cpus memory", dropping those gone. */
const USED = [
	"now=$(date +%s)",
	'used=$(for f in "$jobs"/*.job; do',
	'  [ -f "$f" ] || continue',
	'  read -r c m pid at < "$f" || { rm -f "$f"; continue; }',
	'  if [ "$pid" = - ]; then',
	`    if [ $((now - at)) -ge ${RESERVED_FOR} ]; then rm -f "$f"; continue; fi`,
	'  elif ! kill -0 "$pid" 2>/dev/null; then',
	'    rm -f "$f"; continue',
	"  fi",
	'  echo "$c $m"',
	"done | awk '{ c += $1; m += $2 } END { printf \"%s %s\", c + 0, m + 0 }')",
];

/** `lines` as one script, run by bash over SSH. */
function script(lines: string[]): string {
	return `${lines.join("\n")}\n`;
}

function timeoutText(seconds: number | null): string {
	if (seconds === null) {
		return "";
	}
	if (seconds % 3600 === 0) {
		return `${seconds / 3600}h`;
	}
	return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

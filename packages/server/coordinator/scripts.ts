import { BOX_USER, KEYRING_PASSWORD } from "./box";
import type { MovedProject } from "./paths";

/** The unit that keeps `splates server` running on the box. */
export const COORDINATOR_UNIT = "splates-coordinator";

/** Where the move leaves its bundle on the box for `placeScript`. */
export const BUNDLE = "/root/splates-move.tgz";

/** The port the box's `splates server` listens on, on its loopback alone. */
export const BOX_PORT = 4310;

/** Runs a command in a D-Bus session whose GNOME Keyring the password in a file unlocked. */
export const KEYRING_RUN = "/usr/local/lib/splates/keyring-run";

const HOME = `/home/${BOX_USER}`;
const SPLATES = `${HOME}/.bun/bin/splates`;

/** A project's clone on the box, and how it signs in to push: its own deploy key. */
export interface BoxProject extends MovedProject {
	/** Its origin's URL, an SSH one, which the deploy key reaches. */
	url: string;
	trunk: string;
}

/** `text` as one word of a POSIX shell. */
export function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** `script` run as `BOX_USER` from a root shell, its stdin passed through. */
function asUser(script: string): string {
	return `su - ${BOX_USER} -c ${shellQuoted(script)}`;
}

/** Its deploy key's path on the box, by the clone's name, in words a shell takes bare. */
function keyOf(project: BoxProject): string {
	const name = project.boxRoot.slice(project.boxRoot.lastIndexOf("/") + 1);
	return `${HOME}/.ssh/splates-${name.replace(/[^\w.-]/g, "_")}`;
}

/**
 * Brings the box's splates to `version`, after waiting out its first boot,
 * which installs bun.
 */
export function upgradeScript(version: string): string {
	return [
		"set -eu",
		"cloud-init status --wait >/dev/null || true",
		asUser(`${HOME}/.bun/bin/bun add -g @stringsync/splates@${version}`),
		"",
	].join("\n");
}

/**
 * For each project: a deploy key of its own, made once; its clone, made
 * once with that key; and a dry-run push of trunk, which GitHub refuses
 * for a key without write access. Prints `ready <slug>` for each that
 * pushes, else `key <slug> <public key>`.
 */
export function clonesScript(projects: BoxProject[]): string {
	const lines = ["set -u", `mkdir -p ${HOME}/.ssh ${HOME}/projects`];
	for (const project of projects) {
		const key = keyOf(project);
		const ssh = `ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
		const root = shellQuoted(project.boxRoot);
		lines.push(
			`test -f ${key} || ssh-keygen -q -t ed25519 -N '' -C ${shellQuoted(`splates-coordinator ${project.slug}`)} -f ${key}`,
			`if ( test -d ${root}/.git || GIT_SSH_COMMAND=${shellQuoted(ssh)} git clone --quiet --branch ${shellQuoted(project.trunk)} -- ${shellQuoted(project.url)} ${root} ) >/dev/null 2>&1 \\`,
			`  && git -C ${root} config core.sshCommand ${shellQuoted(ssh)} \\`,
			`  && git -C ${root} push --dry-run --quiet origin ${shellQuoted(`HEAD:refs/heads/${project.trunk}`)} >/dev/null 2>&1; then`,
			`  echo ready ${shellQuoted(project.slug)}`,
			"else",
			`  echo key ${shellQuoted(project.slug)} "$(cat ${key}.pub)"`,
			"fi",
		);
	}
	lines.push("");
	return asUser(lines.join("\n"));
}

/** What `clonesScript` printed: each project that pushes, and each one's key that does not yet. */
export function readClones(stdout: string): {
	ready: string[];
	keys: { slug: string; key: string }[];
} {
	const ready: string[] = [];
	const keys: { slug: string; key: string }[] = [];
	for (const line of stdout.split("\n")) {
		const [kind, slug, ...rest] = line.trim().split(" ");
		if (kind === "ready" && slug !== undefined) {
			ready.push(slug);
		} else if (kind === "key" && slug !== undefined) {
			keys.push({ slug, key: rest.join(" ") });
		}
	}
	return { ready, keys };
}

/**
 * The unit: `splates server` as `BOX_USER`, in a D-Bus session whose
 * keyring the password systemd hands it unlocked, from the project the move
 * ran in, whose config names the worker provider; started again whenever it
 * stops.
 */
export function unitText(cwd: string): string {
	return [
		"[Unit]",
		"Description=splates coordinator",
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		`User=${BOX_USER}`,
		`WorkingDirectory=${cwd}`,
		`Environment=PATH=${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin`,
		`LoadCredential=keyring:${KEYRING_PASSWORD}`,
		`ExecStart=${KEYRING_RUN} %d/keyring ${SPLATES} server --port ${BOX_PORT}`,
		"Restart=always",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n");
}

/**
 * `keyring-run <password file> <command...>`: a D-Bus session of its own,
 * GNOME Keyring started in it and unlocked by the password, its login
 * keyring made with it the first time, then the command.
 */
export const KEYRING_RUN_SCRIPT = [
	"#!/bin/sh",
	"set -eu",
	'password="$1"',
	"shift",
	`exec dbus-run-session -- sh -c 'gnome-keyring-daemon --unlock --components=secrets <"$0" >/dev/null && exec "$@"' "$password" "$@"`,
	"",
].join("\n");

/**
 * The root script that puts the bundle at `BUNDLE` in place on the box,
 * over whatever an earlier move left, and readies the unit to start from
 * the clone at `cwd`. It stops the server first.
 */
export function placeScript(projects: BoxProject[], cwd: string): string {
	// The home files go into the user's `~/.splates`, each project's
	// records into its clone's `.git/splates`.
	const records = projects.map(
		(project) => `${shellQuoted(project.boxRoot)}/.git/splates`,
	);
	return [
		"set -eu",
		`systemctl stop ${COORDINATOR_UNIT} 2>/dev/null || true`,
		"dir=$(mktemp -d)",
		`tar -xzf ${BUNDLE} -C "$dir"`,
		`mkdir -p ${HOME}/.splates`,
		`cp -R "$dir/home/." ${HOME}/.splates/`,
		...projects.flatMap((project, index) => [
			`rm -rf ${records[index]}`,
			`cp -R "$dir/projects/"${shellQuoted(project.slug)} ${records[index]}`,
		]),
		`chown -R ${BOX_USER}:${BOX_USER} ${HOME}/.splates ${records.join(" ")}`,
		`rm -rf "$dir" ${BUNDLE}`,
		`mkdir -p ${KEYRING_RUN.slice(0, KEYRING_RUN.lastIndexOf("/"))}`,
		`cat > ${KEYRING_RUN} <<'SPLATES_KEYRING_RUN'`,
		KEYRING_RUN_SCRIPT.trimEnd(),
		"SPLATES_KEYRING_RUN",
		`chmod 755 ${KEYRING_RUN}`,
		`cat > /etc/systemd/system/${COORDINATOR_UNIT}.service <<'SPLATES_UNIT'`,
		unitText(cwd).trimEnd(),
		"SPLATES_UNIT",
		"systemctl daemon-reload",
		"",
	].join("\n");
}

/**
 * Keeps the creds on stdin, as `splates server keep-creds` reads them,
 * in `BOX_USER`'s keyring, unlocked by a copy of its password only that user
 * may read while it runs.
 */
export function credsScript(): string {
	const copy = "/run/splates-keyring";
	return [
		"set -eu",
		`install -o ${BOX_USER} -m 0400 ${KEYRING_PASSWORD} ${copy}`,
		`trap 'rm -f ${copy}' EXIT`,
		asUser(`${KEYRING_RUN} ${copy} ${SPLATES} server keep-creds`),
		"",
	].join("\n");
}

/** Starts the unit, at each boot from now on, and waits until the server answers. */
export function startScript(): string {
	return [
		"set -eu",
		`systemctl enable --now ${COORDINATOR_UNIT}`,
		...ANSWERS,
	].join("\n");
}

/** Restarts the unit on the release just installed, and waits until the server answers. */
export function restartScript(): string {
	return ["set -eu", `systemctl restart ${COORDINATOR_UNIT}`, ...ANSWERS].join(
		"\n",
	);
}

/** Waits up to two minutes for the box's server to answer on its loopback. */
const ANSWERS = [
	"for _ in $(seq 120); do",
	`  curl -fsS -o /dev/null http://localhost:${BOX_PORT}/ && exit 0`,
	"  sleep 1",
	"done",
	`echo "splates server did not answer in two minutes: journalctl -u ${COORDINATOR_UNIT}" >&2`,
	"exit 1",
	"",
];

/** A join token for a worker, from the box's server on its loopback. */
export function inviteScript(): string {
	const url = `http://localhost:${BOX_PORT}`;
	return `curl -fsS -X POST -H 'origin: ${url}' ${url}/api/workers/invite\n`;
}

import { BOX_USER, CLOUDFLARED_DEB } from "./box";
import type { MovedProject } from "./paths";

/** The unit that keeps `splates server` running on the box. */
export const COORDINATOR_UNIT = "splates-coordinator";

/** Where the move leaves its bundle on the box for `placeScript`. */
export const BUNDLE = "/root/splates-move.tgz";

/** The port the box's `splates server` listens on, on its loopback alone. */
export const BOX_PORT = 4310;

const HOME = `/home/${BOX_USER}`;
const SPLATES = `${HOME}/.bun/bin/splates`;

/** Makes the box's `splates` read its creds from Parameter Store under the instance role. */
const SSM = "SPLATES_SECRET_STORE=ssm";

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
 * What the box lacks of its creds: the device's tunnel token and each
 * project's deploy key, by the Parameter Store name each is kept under.
 * Prints one name per line, nothing when all are there.
 */
export function needsScript(projects: BoxProject[]): string {
	const roots = projects.map((project) => shellQuoted(project.boxRoot));
	return `${asUser(`${SSM} ${SPLATES} server needs ${roots.join(" ")}`)}\n`;
}

/**
 * For each project: its deploy key, read from Parameter Store under the
 * instance role into the user's `~/.ssh`; its clone, made once with that
 * key; and a dry-run push of trunk, which GitHub refuses for a key without
 * write access. Prints `ready <slug>` for each that pushes, else
 * `refused <slug>`.
 */
export function clonesScript(projects: BoxProject[]): string {
	const lines = ["set -u", `mkdir -p ${HOME}/.ssh ${HOME}/projects`];
	for (const project of projects) {
		const key = keyOf(project);
		const ssh = `ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
		const root = shellQuoted(project.boxRoot);
		lines.push(
			`if ( umask 077 && ${SSM} ${SPLATES} server deploy-key ${root} > ${key}.new && mv ${key}.new ${key} ) \\`,
			`  && ( test -d ${root}/.git || GIT_SSH_COMMAND=${shellQuoted(ssh)} git clone --quiet --branch ${shellQuoted(project.trunk)} -- ${shellQuoted(project.url)} ${root} ) >/dev/null 2>&1 \\`,
			`  && git -C ${root} config core.sshCommand ${shellQuoted(ssh)} \\`,
			`  && git -C ${root} push --dry-run --quiet origin ${shellQuoted(`HEAD:refs/heads/${project.trunk}`)} >/dev/null 2>&1; then`,
			`  echo ready ${shellQuoted(project.slug)}`,
			"else",
			`  echo refused ${shellQuoted(project.slug)}`,
			"fi",
		);
	}
	lines.push("");
	return asUser(lines.join("\n"));
}

/** What `clonesScript` printed: each project that pushes, and each that does not. */
export function readClones(stdout: string): {
	ready: string[];
	refused: string[];
} {
	const ready: string[] = [];
	const refused: string[] = [];
	for (const line of stdout.split("\n")) {
		const [kind, slug] = line.trim().split(" ");
		if (kind === "ready" && slug !== undefined) {
			ready.push(slug);
		} else if (kind === "refused" && slug !== undefined) {
			refused.push(slug);
		}
	}
	return { ready, refused };
}

/**
 * The unit: `splates server` as `BOX_USER`, its creds read from Parameter
 * Store under the instance role, from the project the move ran in, whose
 * config names the worker provider; started again whenever it stops.
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
		`Environment=${SSM}`,
		`ExecStart=${SPLATES} server --port ${BOX_PORT}`,
		"Restart=always",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n");
}

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
		`cat > /etc/systemd/system/${COORDINATOR_UNIT}.service <<'SPLATES_UNIT'`,
		unitText(cwd).trimEnd(),
		"SPLATES_UNIT",
		"systemctl daemon-reload",
		"",
	].join("\n");
}

/**
 * The root script that brings what a release installs outside bun up to
 * its text: the unit, rewritten only when it differs, keeping the
 * `WorkingDirectory` it has, then `systemctl daemon-reload` when it
 * changed; and cloudflared, from
 * the latest .deb, which a deploy that cannot fetch it only says so about.
 */
export function refreshScript(): string {
	const unit = `/etc/systemd/system/${COORDINATOR_UNIT}.service`;
	const cwd = "@CWD@";
	const fresh = (text: string, delimiter: string) => [
		`cat > "$dir/next" <<'${delimiter}'`,
		text.trimEnd(),
		delimiter,
	];
	return [
		"set -eu",
		"dir=$(mktemp -d)",
		`trap 'rm -rf "$dir"' EXIT`,
		`dir_of_unit=$(sed -n 's/^WorkingDirectory=//p' ${unit})`,
		...fresh(unitText(cwd), "SPLATES_UNIT"),
		`sed "s|${cwd}|$dir_of_unit|" "$dir/next" > "$dir/unit"`,
		`if ! cmp -s "$dir/unit" ${unit}; then`,
		`  install -m 644 "$dir/unit" ${unit}`,
		"  systemctl daemon-reload",
		"fi",
		`( curl -fsSL -o "$dir/cloudflared.deb" ${CLOUDFLARED_DEB} && dpkg -i "$dir/cloudflared.deb" >/dev/null ) || echo "could not upgrade cloudflared: it stays as it was" >&2`,
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

/**
 * Withdraws the join token on stdin from the box's server on its loopback,
 * revoking the service token minted for it.
 */
export function withdrawScript(): string {
	const url = `http://localhost:${BOX_PORT}`;
	return `curl -fsS -X DELETE -H 'origin: ${url}' -H 'content-type: application/json' --data-binary @- ${url}/api/workers/invite\n`;
}

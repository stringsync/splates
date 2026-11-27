import { dirname } from "node:path";
import type { Ps } from "core/system";
import { Duration } from "core/time";
import manifest from "../package.json" with { type: "json" };

/** The version of splates running now, as `ship` stamped it. */
export const RUNNING: string = manifest.version;

/** Where npm says which version of splates is the latest. */
export const REGISTRY =
	"https://registry.npmjs.org/@stringsync%2fsplates/latest";

/** How long a check waits on the registry before giving up for this round. */
const PATIENCE = Duration.secs(10);

/** A newer splates than the one serving, published since it started. */
export interface Release {
	running: string;
	newest: string;
}

/**
 * Commits to splates's own source since `splates server` started from a checkout of
 * it, which a restart picks up.
 */
export interface Behind {
	/** The last commit to the source as the server started. */
	running: string;
	/** The last commit to it now. */
	newest: string;
}

/**
 * Commits to splates's own source on the checkout's upstream branch that the
 * local checkout has not fast-forwarded onto yet, so a restart alone would
 * still run the older local commit.
 */
export interface Stuck {
	/** The upstream branch ahead of local HEAD, e.g. `origin/main`. */
	upstream: string;
	/** The last commit to splates's source on local HEAD. */
	local: string;
	/** The newest commit to splates's source on `upstream`. */
	newest: string;
	/** How many server source commits `upstream` has past local HEAD. */
	commits: number;
	/** The source checkout's repository root, absolute. */
	root: string;
	/** Tracked uncommitted changes in `root` that may block fast-forwarding. */
	dirty: number;
}

/**
 * The directories splates runs from in a checkout: its own, and the wren
 * library it imports, whose commits change what the server runs just as much.
 */
export const SOURCE = [
	dirname(import.meta.dirname),
	`${dirname(dirname(import.meta.dirname))}/splates`,
	`${dirname(dirname(import.meta.dirname))}/web`,
	...coreSource(),
];

/** wren's directory, or none in a compiled binary, which has no files to resolve. */
function coreSource(): string[] {
	try {
		return [
			dirname(dirname(Bun.fileURLToPath(import.meta.resolve("core/time")))),
		];
	} catch {
		return [];
	}
}

/**
 * The last commit to `source`, or null when splates does not run from a
 * checkout, as from npm, or git cannot say. Never throws, like `newest`.
 */
export async function sourceCommit(
	ps: Ps,
	source = SOURCE,
): Promise<string | null> {
	const [here = "", ...rest] = source;
	try {
		const { exitCode, stdout } = await ps.spawnCapture([
			"git",
			"-C",
			here,
			"log",
			"-1",
			"--format=%H",
			"--",
			here,
			...rest,
		]);
		const commit = stdout.trim();
		return exitCode === 0 && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null;
	} catch {
		return null;
	}
}

/**
 * Whether `source`'s local checkout is behind its local remote-tracking
 * upstream branch on commits touching `source`, without hitting the network.
 * Returns null when up to date, outside a checkout, detached, or with no
 * upstream configured. Never throws.
 */
export async function stuckSource(
	ps: Ps,
	source = SOURCE,
): Promise<Stuck | null> {
	const [here = "", ...rest] = source;
	try {
		const ahead = await ps.spawnCapture([
			"git",
			"-C",
			here,
			"log",
			"--format=%H",
			"HEAD..@{upstream}",
			"--",
			here,
			...rest,
		]);
		if (ahead.exitCode !== 0) {
			return null;
		}
		const commits = ahead.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^[0-9a-f]{40,64}$/.test(line));
		const newest = commits[0];
		if (newest === undefined) {
			return null;
		}
		const [upstreamOut, localSource, rootOut, statusOut] = await Promise.all([
			ps.spawnCapture([
				"git",
				"-C",
				here,
				"rev-parse",
				"--abbrev-ref",
				"@{upstream}",
			]),
			sourceCommit(ps, source),
			ps.spawnCapture(["git", "-C", here, "rev-parse", "--show-toplevel"]),
			ps.spawnCapture([
				"git",
				"-C",
				here,
				"status",
				"--porcelain",
				"--untracked-files=no",
			]),
		]);
		const local =
			localSource ??
			(await ps
				.spawnCapture(["git", "-C", here, "rev-parse", "HEAD"])
				.then(({ exitCode, stdout }) =>
					exitCode === 0 ? stdout.trim() : null,
				));
		const root = rootOut.exitCode === 0 ? rootOut.stdout.trim() : "";
		if (local === null || root === "") {
			return null;
		}
		const upstream =
			upstreamOut.exitCode === 0 && upstreamOut.stdout.trim() !== ""
				? upstreamOut.stdout.trim()
				: "upstream";
		const dirty =
			statusOut.exitCode === 0
				? statusOut.stdout.split("\n").filter((line) => line.trim() !== "")
						.length
				: 0;
		return {
			upstream,
			local,
			newest,
			commits: commits.length,
			root,
			dirty,
		};
	} catch {
		return null;
	}
}

/**
 * The latest version of splates on npm, or null when the registry cannot say:
 * offline, slow, or answering with something else. A check that fails has
 * nothing to tell the person at the page, so it never throws.
 */
export async function newest(registry = REGISTRY): Promise<string | null> {
	try {
		const response = await fetch(registry, {
			signal: AbortSignal.timeout(PATIENCE.ms),
		});
		if (!response.ok) {
			return null;
		}
		const { version } = (await response.json()) as { version?: unknown };
		return typeof version === "string" && parse(version) !== null
			? version
			: null;
	} catch {
		return null;
	}
}

/**
 * Whether `version` is past `than`, by major, minor and patch. A prerelease is
 * never newer: only what `@latest` installs is worth a restart.
 */
export function isNewer(version: string, than: string): boolean {
	const [mine, theirs] = [parse(version), parse(than)];
	if (mine === null || theirs === null) {
		return false;
	}
	for (let i = 0; i < 3; i += 1) {
		if (mine[i] !== theirs[i]) {
			return (mine[i] as number) > (theirs[i] as number);
		}
	}
	return false;
}

function parse(version: string): number[] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match === null ? null : match.slice(1).map(Number);
}

import type { Config } from "./config";
import { shipSettings } from "./scopes";

/** One thing the Ships page can ship from a repository. */
export interface ShipTarget {
	name: string;
	/** The path globs it owns, relative to the root. */
	paths: string[];
	ship: string | null;
	shipStatus: string | null;
	afterBump: string | null;
}

/**
 * The ship targets a config resolves to: its `ships`, else one target per
 * `projects` entry, else the repository itself as `repoName`. Throws on a
 * name that is empty, a target with no paths, a glob that is absolute or
 * climbs out of the root, and targets that overlap.
 */
export function shipTargets(
	config: Partial<
		Pick<Config, "ships" | "projects" | "ship" | "shipStatus" | "afterBump">
	>,
	repoName: string,
): ShipTarget[] {
	if (config.ships) {
		return validated(
			Object.entries(config.ships).map(([name, target]) => ({
				name,
				paths: target.paths,
				ship: target.ship,
				shipStatus:
					target.shipStatus !== undefined
						? target.shipStatus
						: (config.shipStatus ?? null),
				afterBump:
					target.afterBump !== undefined
						? target.afterBump
						: (config.afterBump ?? null),
			})),
		);
	}
	const projects = config.projects ?? { [repoName]: ["**"] };
	return Object.entries(projects).map(([name, entry]) => ({
		name,
		paths: Array.isArray(entry) ? entry : entry.paths,
		...shipSettings(config, name),
	}));
}

function validated(targets: ShipTarget[]): ShipTarget[] {
	const globs: { name: string; glob: string }[] = [];
	for (const target of targets) {
		if (target.name.trim() === "") {
			throw new Error("ships: a target's name may not be empty");
		}
		if (target.paths.length === 0) {
			throw new Error(`ships: ${target.name} owns no paths`);
		}
		for (const path of target.paths) {
			const glob = path.replace(/^\.\//, "").replace(/\/+$/, "");
			if (glob.startsWith("/") || glob.split("/").includes("..")) {
				throw new Error(`ships: ${path} must stay inside the repository`);
			}
			globs.push({ name: target.name, glob: glob === "" ? "**" : glob });
		}
	}
	for (let i = 0; i < globs.length; i++) {
		for (const other of globs.slice(i + 1)) {
			const first = globs[i];
			if (
				first &&
				first.name !== other.name &&
				overlaps(first.glob, other.glob)
			) {
				throw new Error(
					`ships: ${first.name} (${first.glob}) and ${other.name} (${other.glob}) overlap`,
				);
			}
		}
	}
	return targets;
}

function literalPrefix(glob: string): string[] {
	const segments = glob.split("/");
	const end = segments.findIndex((segment) => /[*?[\]{}]/.test(segment));
	return end === -1 ? segments : segments.slice(0, end);
}

/** Whether two globs' literal leading directories are prefixes of one another. */
function overlaps(left: string, right: string): boolean {
	const [leftPrefix, rightPrefix] = [literalPrefix(left), literalPrefix(right)];
	const shared = Math.min(leftPrefix.length, rightPrefix.length);
	return leftPrefix
		.slice(0, shared)
		.every((segment, i) => segment === rightPrefix[i]);
}

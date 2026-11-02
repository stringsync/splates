import type { Config } from "./config";

/** One thing the Ships page can ship from a repository. */
export interface ShipTarget {
	name: string;
	/** The path globs it owns, relative to the root; empty for a `ships` target. */
	paths: string[];
	/** The workspace packages it publishes, empty unless an npm target by package. */
	packages: string[];
	/** The workspace packages it deploys, empty unless a deploy target. */
	deploys: string[];
	ship: string | null;
	shipStatus: string | null;
	afterBump: string | null;
}

/**
 * The ship targets a config declares in `ships`, none without it. Throws on a
 * name that is empty, a target naming neither packages nor deploys, or both.
 */
export function shipTargets(
	config: Partial<Pick<Config, "ships" | "shipStatus" | "afterBump">>,
): ShipTarget[] {
	if (config.ships) {
		return validated(
			Object.entries(config.ships).map(([name, target]) => ({
				name,
				paths: [],
				packages: target.packages ?? [],
				deploys: target.deploys ?? [],
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
	return [];
}

function validated(targets: ShipTarget[]): ShipTarget[] {
	for (const target of targets) {
		if (target.name.trim() === "") {
			throw new Error("ships: a target's name may not be empty");
		}
		if (target.packages.length === 0 && target.deploys.length === 0) {
			throw new Error(`ships: ${target.name} names no packages or deploys`);
		}
		if (target.packages.length > 0 && target.deploys.length > 0) {
			throw new Error(`ships: ${target.name} names both packages and deploys`);
		}
	}
	return targets;
}

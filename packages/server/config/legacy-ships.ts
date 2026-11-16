import type { Config } from "./config";

/** One command-backed target on the Ships page. */
export interface ShipTarget {
	name: string;
	ship: string;
	/** Targets that ship, or are already current, before this one. */
	dependencies: string[];
	/** `dependencies` and theirs in turn, nearest first, without repeats. */
	dependenciesClosure: string[];
}

export function shipTargets(
	config: Partial<Pick<Config, "legacyShips">>,
): ShipTarget[] {
	const targets = Object.entries(config.legacyShips ?? {}).map(
		([name, target]) => {
			for (const key of Object.keys(target)) {
				if (key === "needs" || key === "after") {
					throw new Error(
						`ships: ${name}.${key} is no longer supported; rename it to dependencies`,
					);
				}
				if (!["ship", "dependencies"].includes(key)) {
					throw new Error(
						`ships: ${name}.${key} is unsupported; declare release behavior in the core/legacy-ship command wrapper`,
					);
				}
			}
			return {
				name,
				ship: target.ship,
				dependencies: [...new Set(target.dependencies ?? [])],
				dependenciesClosure: [] as string[],
			};
		},
	);
	const names = new Set(targets.map((target) => target.name));
	for (const target of targets) {
		if (!target.name.trim()) {
			throw new Error("ships: a target's name may not be empty");
		}
		if (typeof target.ship !== "string" || !target.ship.trim()) {
			throw new Error(
				`ships: ${target.name} needs a ship command implementing the core/legacy-ship wrapper`,
			);
		}
		for (const dependency of target.dependencies) {
			if (dependency === target.name || !names.has(dependency)) {
				throw new Error(
					`ships: ${target.name} depends on ${dependency}, which is not another target`,
				);
			}
		}
	}
	const byName = new Map(targets.map((target) => [target.name, target]));
	const edges = (name: string) => byName.get(name)?.dependencies ?? [];
	// A cycle of dependencies has no order to ship in.
	const state = new Map<string, "open" | "done">();
	const visit = (name: string, path: string[]) => {
		if (state.get(name) === "done") {
			return;
		}
		if (state.get(name) === "open") {
			const cycle = [...path.slice(path.indexOf(name)), name];
			throw new Error(
				`ships: dependencies form a cycle: ${cycle.join(" -> ")}`,
			);
		}
		state.set(name, "open");
		for (const next of edges(name)) {
			visit(next, [...path, name]);
		}
		state.set(name, "done");
	};
	for (const target of targets) {
		visit(target.name, []);
	}
	for (const target of targets) {
		const seen: string[] = [];
		const queue = [...target.dependencies];
		while (queue.length > 0) {
			const next = queue.shift() as string;
			if (seen.includes(next)) {
				continue;
			}
			seen.push(next);
			queue.push(...(byName.get(next)?.dependencies ?? []));
		}
		target.dependenciesClosure = seen;
	}
	return targets;
}

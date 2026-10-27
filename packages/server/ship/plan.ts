import type { ShipGraph, ShipProject, Use } from "./graph";

/** One project's part in a ship. */
export interface ShipStep {
	slug: string;
	/**
	 * `ship` runs its `ship` command and publishes; `bump` only moves its pins
	 * to the versions shipped before it.
	 */
	action: "ship" | "bump";
	/** The version it is at, null when its root manifest names none. */
	from: string | null;
	/** The version a ship takes it to, the next patch; null for a bump. */
	to: string | null;
	/** The packages a ship publishes; none for a bump. */
	publishes: string[];
	/** The packages it moves to their new versions, by the project shipping them. */
	takes: Use[];
	/** Why it ships or only takes its bump. */
	why: string;
}

/** A ship of one project and everything downstream of it, in dependency order. */
export interface ShipPlan {
	/** The project the ship starts from. */
	from: string;
	steps: ShipStep[];
}

/** Why there is no plan to ship a project. */
export class ShipPlanError extends Error {
	constructor(
		/** The exit reason a command refuses with. */
		readonly reason: "not_found" | "usage" | "cycle",
		message: string,
	) {
		super(message);
	}
}

/**
 * The plan to ship `slug`: it, then each project pinning a package shipped
 * before it, in dependency order. A dependent ships in turn when it is
 * public, names a `ship` command and has dependents of its own to pass its
 * new version on to; otherwise it only takes its bump.
 */
export function planShip(graph: ShipGraph, slug: string): ShipPlan {
	const start = graph.projects.find((each) => each.slug === slug);
	if (start === undefined) {
		throw new ShipPlanError(
			"not_found",
			`no registered project is named ${slug}`,
		);
	}
	if (start.ship === null || start.private) {
		throw new ShipPlanError(
			"usage",
			start.private
				? `${slug} publishes no public package, so there is nothing to ship`
				: `${slug} names no \`ship\` command in its splates.config.ts`,
		);
	}
	const shipping = new Set([slug]);
	const steps: ShipStep[] = [];
	for (const project of dependencyOrder(graph)) {
		if (project.slug === slug) {
			steps.push(shipStep(project, [], "the project shipped"));
			continue;
		}
		const takes = project.uses.filter((use) => shipping.has(use.project));
		if (takes.length === 0) {
			continue;
		}
		const why = bumpOnly(project);
		if (why !== null) {
			steps.push({
				slug: project.slug,
				action: "bump",
				from: project.version,
				to: null,
				publishes: [],
				takes,
				why,
			});
			continue;
		}
		shipping.add(project.slug);
		const by = project.dependents.map((each) => each.project).join(", ");
		steps.push(shipStep(project, takes, `${by} pins it`));
	}
	return { from: slug, steps };
}

/** Why a dependent in a ship only takes its bump, or null when it ships too. */
function bumpOnly(project: ShipProject): string | null {
	if (project.private) {
		return "private";
	}
	if (project.ship === null) {
		return "names no ship command";
	}
	if (project.dependents.length === 0) {
		return "nothing pins it";
	}
	return null;
}

function shipStep(project: ShipProject, takes: Use[], why: string): ShipStep {
	return {
		slug: project.slug,
		action: "ship",
		from: project.version,
		to: project.version === null ? null : nextPatch(project.version),
		publishes: project.packages,
		takes,
		why,
	};
}

/** `version` a patch on, as a release bumps it; null when it is not `x.y.z`. */
export function nextPatch(version: string): string | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (match === null) {
		return null;
	}
	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number(patch) + 1}`;
}

/**
 * Every project after those whose packages it pins, ties left in
 * registration order. Throws on a cycle, which no order ships.
 */
function dependencyOrder(graph: ShipGraph): ShipProject[] {
	const left = new Map(
		graph.projects.map((each) => [
			each.slug,
			new Set(each.uses.map((use) => use.project)),
		]),
	);
	const ordered: ShipProject[] = [];
	while (ordered.length < graph.projects.length) {
		const next = graph.projects.find((each) => left.get(each.slug)?.size === 0);
		if (next === undefined) {
			const stuck = [...left.keys()].join(", ");
			throw new ShipPlanError(
				"cycle",
				`${stuck} pin each other's packages in a cycle, which no order ships`,
			);
		}
		ordered.push(next);
		left.delete(next.slug);
		for (const waiting of left.values()) {
			waiting.delete(next.slug);
		}
	}
	return ordered;
}

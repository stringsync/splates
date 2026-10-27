import type { ShipGraph, ShipProject, Use } from "./graph";

/** How far a publish moves its project's version. */
export type ShipBump = "patch" | "minor" | "major";

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
	/** How far a ship moves the version; null for a dependency-only bump. */
	bump: ShipBump | null;
	/** The version a ship takes it to; null for a bump or an invalid version. */
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
 * The plan to ship `slug` at `bump`, then each project pinning a package shipped
 * before it, in dependency order. A dependent ships at the next patch in turn
 * when it is public, names a `ship` command and has dependents of its own to
 * pass its new version on to; otherwise it only takes its bump.
 */
export function planShip(
	graph: ShipGraph,
	slug: string,
	bump: ShipBump = "patch",
): ShipPlan {
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
			steps.push(shipStep(project, [], "the project shipped", bump));
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
				bump: null,
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

function shipStep(
	project: ShipProject,
	takes: Use[],
	why: string,
	bump: ShipBump = "patch",
): ShipStep {
	return {
		slug: project.slug,
		action: "ship",
		from: project.version,
		bump,
		to: project.version === null ? null : nextVersion(project.version, bump),
		publishes: project.packages,
		takes,
		why,
	};
}

/** `version` moved by `bump`; null when it is not `x.y.z`. */
export function nextVersion(version: string, bump: ShipBump): string | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (match === null) {
		return null;
	}
	const [major = 0, minor = 0, patch = 0] = match.slice(1).map(Number);
	if (bump === "major") {
		return `${major + 1}.0.0`;
	}
	if (bump === "minor") {
		return `${major}.${minor + 1}.0`;
	}
	return `${major}.${minor}.${patch + 1}`;
}

/** `version` a patch on, as a release bumps it; null when it is not `x.y.z`. */
export function nextPatch(version: string): string | null {
	return nextVersion(version, "patch");
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

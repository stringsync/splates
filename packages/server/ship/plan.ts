import type { ShipGraph, ShipProject, Use } from "./graph";

/** How far a publish moves its project's version. */
export type ShipBump = "patch" | "minor" | "major";

/** One project's part in a ship. */
export interface ShipReview {
	status: "pending" | "done" | "failed";
	proposed: ShipBump | null;
	reasons: string;
}

export interface ShipStep {
	/** The dependent review completed before approval. */
	review?: ShipReview;
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

/**
 * A ship of one project, or of every changed one, and everything downstream,
 * in dependency order.
 */
export interface ShipPlan {
	/** The stopped run being recovered and its confirmed publications. */
	recovery?: { id: string; inputs: Use[] };
	/** The saved review approved by the person. */
	id?: string;
	/** The project the ship starts from, or {@link CHANGED}. */
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
 * What a ship of every project changed since its last release names as the
 * project it starts from: no project's slug, since a slug has no `+`.
 */
export const CHANGED = "+changed";

/** How a ship starting from `from` is named to the person. */
export function shipName(from: string): string {
	return from === CHANGED ? "changed projects" : from;
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
	if (slug === CHANGED) {
		return planChanged(graph);
	}
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
	return planFrom(graph, slug, new Map([[slug, "the project shipped"]]), bump);
}

/**
 * The projects with commits on their release branch since their version tag
 * that can ship: public, with a `ship` command. One whose history is unknown
 * is left out, as the Ship page marks it.
 */
export function changedProjects(graph: ShipGraph): ShipProject[] {
	return graph.projects.filter(
		(each) =>
			each.ship !== null &&
			!each.private &&
			each.changes?.commits != null &&
			each.changes.commits > 0,
	);
}

/**
 * The plan to ship every changed project at a patch, in dependency order,
 * each dependent of one taking its bump first, and each project downstream
 * as {@link planShip} carries it. A changed project ships even when nothing
 * pins it.
 */
export function planChanged(graph: ShipGraph): ShipPlan {
	const changed = changedProjects(graph);
	if (changed.length === 0) {
		throw new ShipPlanError(
			"usage",
			"no project has changed since its last release",
		);
	}
	return planFrom(
		graph,
		CHANGED,
		new Map(
			changed.map((each) => [
				each.slug,
				`it has ${each.changes?.commits} unshipped commit${each.changes?.commits === 1 ? "" : "s"} since ${each.changes?.tag}`,
			]),
		),
	);
}

/** Ships each of `roots`, saying why, and carries them downstream. */
function planFrom(
	graph: ShipGraph,
	from: string,
	roots: Map<string, string>,
	bump: ShipBump = "patch",
): ShipPlan {
	const shipping = new Set<string>();
	const steps: ShipStep[] = [];
	for (const project of dependencyOrder(graph)) {
		const takes = project.uses.filter((use) => shipping.has(use.project));
		const root = roots.get(project.slug);
		if (root !== undefined) {
			shipping.add(project.slug);
			steps.push(shipStep(project, takes, root, bump));
			continue;
		}
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
	return { from, steps };
}

/** Why a dependent in a ship only takes its bump, or null when it ships too. */
export function bumpOnly(project: ShipProject): string | null {
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

export function shipStep(
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
export function dependencyOrder(graph: ShipGraph): ShipProject[] {
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

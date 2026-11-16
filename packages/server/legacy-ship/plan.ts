import type { ShipGraph, ShipProject, Use } from "./graph";

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

/** How far a publish moves its project's version. */
export type ShipBump = "patch" | "minor" | "major";

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
	/** A deploy target: it deploys a commit, with no version or npm publish. */
	deploy?: boolean;
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
	/** The dependents the person left out, with what only they reach; absent for none. */
	skipped?: string[];
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
 * pass its new version on to; otherwise it only takes its bump. Each
 * dependent `skip` names is left out, with whatever only it would carry the
 * release to.
 */
export function planShip(
	graph: ShipGraph,
	slug: string,
	bump: ShipBump = "patch",
	skip: string[] = [],
): ShipPlan {
	if (slug === CHANGED) {
		return planChanged(graph, skip);
	}
	const start = graph.projects.find((each) => each.slug === slug);
	if (start === undefined) {
		throw new ShipPlanError(
			"not_found",
			`no registered project is named ${slug}`,
		);
	}
	if (start.ship === null) {
		throw new ShipPlanError(
			"usage",
			`${slug} names no \`ship\` command in its splates.config.ts`,
		);
	}
	return planFrom(
		graph,
		slug,
		new Map([[slug, "the project shipped"]]),
		bump,
		skip,
	);
}

/**
 * The projects with commits on their release branch since their version tag
 * that can ship: with a `ship` command, a deploy target included. One whose history is unknown
 * is left out, as the Ship page marks it.
 */
export function changedProjects(graph: ShipGraph): ShipProject[] {
	return graph.projects.filter(
		(each) =>
			each.ship !== null &&
			each.changes?.commits != null &&
			each.changes.commits > 0,
	);
}

/**
 * The plan to ship every changed project at a patch, in dependency order,
 * each dependent of one taking its bump first, and each project downstream
 * as {@link planShip} carries it. A changed project ships even when nothing
 * pins it, and even when `skip` names it: only dependents are left out.
 */
export function planChanged(graph: ShipGraph, skip: string[] = []): ShipPlan {
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
				`it has ${each.changes?.commits} unshipped commit${each.changes?.commits === 1 ? "" : "s"} ${each.changes?.tag == null ? "and was never deployed" : `since ${each.changes.tag}`}`,
			]),
		),
		"patch",
		skip,
	);
}

/**
 * Ships each of `roots`, saying why, and carries them downstream past the
 * dependents `skip` names.
 */
function planFrom(
	graph: ShipGraph,
	from: string,
	roots: Map<string, string>,
	bump: ShipBump = "patch",
	skip: string[] = [],
): ShipPlan {
	const shipping = new Set<string>();
	const steps: ShipStep[] = [];
	const skipped: string[] = [];
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
		if (skip.includes(project.slug)) {
			skipped.push(project.slug);
			continue;
		}
		const why = bumpOnly(project);
		if (why !== null) {
			steps.push({
				slug: project.slug,
				action: "bump",
				from: project.commandPlan?.identity.from ?? null,
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
	return skipped.length === 0 ? { from, steps } : { from, steps, skipped };
}

/** Why a dependent in a ship only takes its bump, or null when it ships too. */
export function bumpOnly(project: ShipProject): string | null {
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
		from: project.commandPlan?.identity.from ?? null,
		bump,
		to: project.commandPlan?.identity.to ?? null,
		publishes: project.packages,
		takes,
		why,
		...(project.deploy ? { deploy: true } : {}),
	};
}

/**
 * Every project after those whose packages it pins, ties left in
 * registration order. Throws on a cycle, which no order ships.
 */
export function dependencyOrder(graph: ShipGraph): ShipProject[] {
	const left = new Map(
		graph.projects.map((each) => [
			each.slug,
			new Set([
				...each.uses.map((use) => use.project),
				// A target waits on the dependencies it names that exist.
				...(each.dependencies ?? []).filter((name) =>
					graph.projects.some((other) => other.slug === name),
				),
			]),
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

import type { ShipGraph, ShipProject } from "@splates/server/ship";

/** A pin that trails the version its project is at now. */
export type Stale = { project: string; name: string; from: string; to: string };

export const shippable = (each: ShipProject) =>
	each.ship !== null && !each.private;

/**
 * `projects` with each after the first of its dependencies among them, as
 * the plan's tree reads top to bottom, so the list is in release order.
 */
export function releaseOrder(projects: ShipProject[]): ShipProject[] {
	const slugs = new Set(projects.map((each) => each.slug));
	const seen = new Set<string>();
	const ordered: ShipProject[] = [];
	const visit = (project: ShipProject) => {
		if (seen.has(project.slug)) {
			return;
		}
		seen.add(project.slug);
		for (const use of project.uses) {
			const dependency = projects.find((each) => each.slug === use.project);
			if (dependency !== undefined && slugs.has(use.project)) {
				visit(dependency);
			}
		}
		ordered.push(project);
	};
	for (const each of projects) {
		visit(each);
	}
	return ordered;
}

/**
 * `projects` as a tree for display: each under the first project it pins,
 * so who depends on whom shows.
 */
export function treeOrder(
	projects: ShipProject[],
): { project: ShipProject; depth: number }[] {
	const slugs = new Set(projects.map((each) => each.slug));
	const firstPinned = (project: ShipProject) =>
		project.uses
			.map((use) => use.project)
			.find((slug) => slugs.has(slug) && slug !== project.slug) ?? null;
	const rows: { project: ShipProject; depth: number }[] = [];
	const seen = new Set<string>();
	const visit = (parent: string | null, depth: number) => {
		for (const each of projects) {
			if (!seen.has(each.slug) && firstPinned(each) === parent) {
				seen.add(each.slug);
				rows.push({ project: each, depth });
				visit(each.slug, depth + 1);
			}
		}
	};
	visit(null, 0);
	return rows;
}

/** The pins of `project` that trail the version their project is at now. */
export function staleOf(project: ShipProject, graph: ShipGraph): Stale[] {
	return project.uses.flatMap((use) => {
		const now = graph.projects.find(
			(each) => each.slug === use.project,
		)?.version;
		return now == null
			? []
			: use.pins
					.filter((pin) => pin.version !== now)
					.map((pin) => ({
						project: use.project,
						name: pin.name,
						from: pin.version,
						to: now,
					}));
	});
}

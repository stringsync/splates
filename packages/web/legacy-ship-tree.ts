import type { ShipGraph, ShipProject } from "@splates/server/legacy-ship";

/** A pin that trails the version its project is at now. */
export type Stale = { project: string; name: string; from: string; to: string };

/** Any target with a ship command can be shipped: private, versioned or a deploy. */
export const shippable = (each: ShipProject) => each.ship !== null;

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
		const before = [
			...project.uses.map((use) => use.project),
			...(project.dependencies ?? []),
		];
		for (const slug of before) {
			const dependency = projects.find((each) => each.slug === slug);
			if (dependency !== undefined && slugs.has(slug)) {
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

import type { RecSource } from "@splates/server/rec/browser";

export interface RecGroup {
	/** The Compose project, or "" for containers that have none. */
	project: string;
	sources: RecSource[];
}

/** Containers by Compose project: the server's folder first, then the rest by name, those with no project last. */
export function groupSources(
	sources: RecSource[],
	current: string | undefined,
): RecGroup[] {
	const groups = new Map<string, RecSource[]>();
	for (const source of sources) {
		const project = source.project ?? "";
		groups.set(project, [...(groups.get(project) ?? []), source]);
	}
	const rank = (project: string) =>
		project === "" ? 2 : project === current ? 0 : 1;
	return [...groups]
		.sort(
			([left], [right]) =>
				rank(left) - rank(right) || left.localeCompare(right),
		)
		.map(([project, grouped]) => ({ project, sources: grouped }));
}

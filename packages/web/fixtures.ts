import type { Checkpoint } from "@stringsync/splates/conversations";
import type { ProjectChoice } from "./project-api";

export * from "@stringsync/splates/fixtures";

/** A conversation of a project's, as the projects route lists it. */
export function live(
	id: string,
	name: string,
	checkpoint: Checkpoint | null = null,
	survives = false,
) {
	return {
		id,
		name,
		status: checkpoint === "done" ? "stopped" : "running",
		checkpoint,
		survives,
	};
}

/** A project as the projects route lists it, holding `listed`. */
export function project(
	slug: string,
	listed: ProjectChoice["conversations"],
	focused = false,
): ProjectChoice {
	return {
		slug,
		root: `/code/${slug}`,
		gone: false,
		focused,
		conversations: listed,
		waiting: 0,
	};
}

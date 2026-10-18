import { basename } from "node:path";
import { BOX_USER } from "./box";

/** Where the box keeps each project's clone, by its main tree's name. */
export const BOX_PROJECTS = `/home/${BOX_USER}/projects`;

/** A project as the move carries it: its main tree here and its clone on the box. */
export interface MovedProject {
	slug: string;
	root: string;
	boxRoot: string;
}

/**
 * Where each project lands on the box: its clone under `BOX_PROJECTS` by its
 * main tree's name, which also names its project creds store. Refuses two
 * projects of one name, which would share a clone.
 */
export function movedProjects(
	projects: { slug: string; root: string }[],
): MovedProject[] {
	const seen = new Map<string, string>();
	return projects.map(({ slug, root }) => {
		const name = basename(root);
		const other = seen.get(name);
		if (other !== undefined) {
			throw new Error(
				`${other} and ${root} share the name ${name}, which names a project's clone and creds on the box: rename one`,
			);
		}
		seen.set(name, root);
		return { slug, root, boxRoot: `${BOX_PROJECTS}/${name}` };
	});
}

/**
 * `text` with each project's main tree here put as its clone on the box, as
 * the coordinator's own records hold them, roots keyed and listed. Only a
 * whole root: a worktree root named for its main tree, as
 * `splates-splates.noindex` is for `splates`, is a worker's path and stays.
 */
export function rewriteRoots(text: string, projects: MovedProject[]): string {
	let rewritten = text;
	for (const { root, boxRoot } of projects) {
		rewritten = rewritten.replace(
			new RegExp(`(?<=")${escaped(root)}(?=")`, "g"),
			boxRoot,
		);
	}
	return rewritten;
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

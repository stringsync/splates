import { relative, sep } from "node:path";
import type { ProjectNote } from "./notes";

/** The task the gardener drafts its fixes in: while it is open, the gardener waits for its review rather than drafting more. */
export const GARDEN_TASK = "notes-garden";

/**
 * The notes the gardener reads, by their paths from `root`: each one no
 * queued task's subject or detail names, since whoever takes that task
 * settles what the note says; none while `working`, the tasks open in
 * worktrees, holds the gardener's last fixes still waiting for review.
 */
export function unclaimed(
	notes: readonly ProjectNote[],
	root: string,
	queued: readonly { subject: string; text: string }[],
	working: readonly string[],
): string[] {
	if (working.includes(GARDEN_TASK)) {
		return [];
	}
	const said = queued.map(({ subject, text }) => `${subject}\n${text}`);
	return notes
		.map(({ path }) => relative(root, path).split(sep).join("/"))
		.filter((path) => !said.some((words) => words.includes(path)));
}

import { relative, sep } from "node:path";
import type { ProjectNote } from "./notes";

/**
 * The notes an audit reads, by their paths from `root`: each one no open
 * task's subject or detail names, since a task already open for a note
 * would only be queued again until it lands.
 */
export function unclaimed(
	notes: readonly ProjectNote[],
	root: string,
	open: readonly { subject: string; text: string }[],
): string[] {
	const said = open.map(({ subject, text }) => `${subject}\n${text}`);
	return notes
		.map(({ path }) => relative(root, path).split(sep).join("/"))
		.filter((path) => !said.some((words) => words.includes(path)));
}

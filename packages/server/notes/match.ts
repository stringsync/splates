import type { Tool } from "../conversations";
import type { ProjectNote } from "./notes";

/** A note's exact path, relative path or unambiguous filename. */
export function noteCalled(
	called: string,
	notes: readonly ProjectNote[],
	tree: string | null,
	worktree: string | null,
): ProjectNote | undefined {
	called = (
		worktree && called.startsWith(`${worktree}/`)
			? called.slice(worktree.length + 1)
			: called
	).replace(/^\.\//, "");
	return noteSpellings(notes, tree).find(([name]) => name === called)?.[1][0];
}

/**
 * Notes a file read or a shell cat reads, once each in catalogue order.
 * `splates notes` lists descriptions only, so it reads none.
 */
export function notesRead(
	tool: Tool,
	notes: readonly ProjectNote[],
	tree: string | null,
	worktree: string | null,
): ProjectNote[] {
	const found = new Set(
		readArguments(tool).map(
			(path) => noteCalled(path, notes, tree, worktree)?.path,
		),
	);
	return notes.filter((note) => found.has(note.path));
}

/**
 * Whether `tool` reads any markdown file, so may read a note: cheap to ask
 * before listing the notes.
 */
export function readsMarkdown(tool: Tool): boolean {
	return readArguments(tool).some((path) => path.endsWith(".md"));
}

/** The paths a file read reads, or the files a shell cat, head or tail is given. */
function readArguments(tool: Tool): string[] {
	const paths = tool.kind === "read" ? tool.paths : [];
	const commands =
		tool.command?.match(
			/(?:^|[;&|\n])\s*(?:cat|head|tail|less|more)\s+([^;&|\n]+)/g,
		) ?? [];
	return [
		...paths,
		...commands.flatMap(
			(command) =>
				command
					.replace(/^[;&|\n]\s*/, "")
					.trim()
					.match(/"[^"]*"|'[^']*'|[^\s]+/g)
					?.slice(1)
					.map((word) => word.replace(/^["']|["']$/g, "")) ?? [],
		),
	];
}

/** Known spellings of a note, longest first so a path wins over its filename. */
export function noteSpellings(
	notes: readonly ProjectNote[],
	tree: string | null,
): [string, ProjectNote[]][] {
	const names = new Map<string, ProjectNote[]>();
	for (const note of notes) {
		const relative =
			tree && note.path.startsWith(`${tree}/`)
				? note.path.slice(tree.length + 1)
				: note.path;
		for (const name of new Set([
			note.path,
			relative,
			note.path.split("/").at(-1) ?? "",
		])) {
			names.set(name, [...(names.get(name) ?? []), note]);
		}
	}
	return [...names]
		.filter(([name, found]) => name !== "" && found.length === 1)
		.sort(([left], [right]) => right.length - left.length);
}

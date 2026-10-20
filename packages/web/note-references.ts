import type { Tool } from "@stringsync/splates-server/conversations";
import type { ProjectNote } from "@stringsync/splates-server/notes";

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
	return spellings(notes, tree).find(([name]) => name === called)?.[1][0];
}

/** Links note names in prose and inline code alone, leaving links and code blocks intact. */
export function linkNotes(
	text: string,
	notes: readonly ProjectNote[],
	tree: string | null,
): string {
	if (notes.length === 0) {
		return text;
	}
	const names = spellings(notes, tree);
	const pattern = new RegExp(
		`(?<![\\w/\\\\@#=.-])(${names.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w/\\\\-]|\\.\\w)`,
		"g",
	);
	if (names.length === 0) {
		return text;
	}
	const link = (name: string) => {
		const note = noteCalled(name, notes, tree, tree);
		return note
			? `[${name.replace(/[[\]\\]/g, "\\$&")}](#note=${encodeURIComponent(note.path).replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)})`
			: name;
	};
	return text
		.split(
			/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|!?\[[^\]\n]*\]\([^\n]*?\)|<[^>\n]*>)/,
		)
		.map((part, i) => {
			if (i % 2 === 0) {
				return part.replace(pattern, link);
			}
			const code = /^`([^`\n]+)`$/.exec(part)?.[1];
			return code && noteCalled(code, notes, tree, tree) ? link(code) : part;
		})
		.join("");
}

/** The note path carried by a generated link. */
export function noteIn(href: string | undefined): string | null {
	if (!href?.startsWith("#note=")) {
		return null;
	}
	try {
		return decodeURIComponent(href.slice(6));
	} catch {
		return null;
	}
}

/** Notes a file read or a shell cat reads, once each in catalogue order. */
export function notesRead(
	tool: Tool,
	notes: readonly ProjectNote[],
	tree: string | null,
	worktree: string | null,
): ProjectNote[] {
	const paths = tool.kind === "read" ? tool.paths : [];
	const commands =
		tool.command?.match(
			/(?:^|[;&|\n])\s*(?:cat|head|tail|less|more)\s+([^;&|\n]+)/g,
		) ?? [];
	const arguments_ = commands.flatMap(
		(command) =>
			command
				.replace(/^[;&|\n]\s*/, "")
				.trim()
				.match(/"[^"]*"|'[^']*'|[^\s]+/g)
				?.slice(1)
				.map((word) => word.replace(/^["']|["']$/g, "")) ?? [],
	);
	const found = new Set(
		[...paths, ...arguments_].map(
			(path) => noteCalled(path, notes, tree, worktree)?.path,
		),
	);
	return notes.filter((note) => found.has(note.path));
}

/** Known spellings of a note, longest first so a path wins over its filename. */
function spellings(notes: readonly ProjectNote[], tree: string | null) {
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

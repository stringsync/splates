import type { ProjectNote } from "@stringsync/splates-server/notes";
import {
	noteCalled,
	noteSpellings,
} from "@stringsync/splates-server/notes/browser";

/** Links note names in prose and inline code alone, leaving links and code blocks intact. */
export function linkNotes(
	text: string,
	notes: readonly ProjectNote[],
	tree: string | null,
): string {
	if (notes.length === 0) {
		return text;
	}
	const names = noteSpellings(notes, tree);
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

/** A line of a diff, as assistant-ui's `CodeDiff` draws one. */
export interface DiffLine {
	kind: "context" | "added" | "removed";
	text: string;
}

/** A run of changed lines and the context around them. */
export interface Hunk {
	/** Where it is, as git heads it: `@@ -10,6 +10,8 @@`. */
	range: string;
	lines: DiffLine[];
}

/** One file's changes. */
export interface FileDiff {
	path: string;
	/** Where it was, for a file that moved; null otherwise. */
	from: string | null;
	status: "added" | "deleted" | "renamed" | "modified";
	added: number;
	removed: number;
	/** Git says only that it differs, with no lines to show. */
	binary: boolean;
	/** Some of it is not committed yet. */
	uncommitted: boolean;
	hunks: Hunk[];
}

/** `git diff` output as files, hunks and lines. */
export function parseDiff(text: string): FileDiff[] {
	const files: FileDiff[] = [];
	let file: FileDiff | null = null;
	let hunk: Hunk | null = null;
	for (const line of text.split("\n")) {
		const header = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
		if (header !== null) {
			file = {
				path: header[2] ?? "",
				from: null,
				status: "modified",
				added: 0,
				removed: 0,
				binary: false,
				uncommitted: false,
				hunks: [],
			};
			files.push(file);
			hunk = null;
			continue;
		}
		if (file === null) {
			continue;
		}
		if (hunk === null) {
			if (line.startsWith("new file mode")) {
				file.status = "added";
			} else if (line.startsWith("deleted file mode")) {
				file.status = "deleted";
			} else if (line.startsWith("rename from ")) {
				file.status = "renamed";
				file.from = line.slice("rename from ".length);
			} else if (line.startsWith("rename to ")) {
				file.path = line.slice("rename to ".length);
			} else if (line.startsWith("Binary files ")) {
				file.binary = true;
			}
		}
		const range = /^(@@ [^@]+ @@)/.exec(line);
		if (range !== null) {
			hunk = { range: range[1] ?? line, lines: [] };
			file.hunks.push(hunk);
			continue;
		}
		if (hunk === null) {
			continue;
		}
		if (line.startsWith("+")) {
			hunk.lines.push({ kind: "added", text: line.slice(1) });
			file.added++;
		} else if (line.startsWith("-")) {
			hunk.lines.push({ kind: "removed", text: line.slice(1) });
			file.removed++;
		} else if (line.startsWith(" ")) {
			hunk.lines.push({ kind: "context", text: line.slice(1) });
		}
		// `\ No newline at end of file`, and the blank line the output ends on,
		// say nothing worth a line of their own.
	}
	return files;
}

/** An edit as lines: what it took out, then what it put in. */
export function editLines(old: string | null, now: string): DiffLine[] {
	return [
		...(old === null
			? []
			: old.split("\n").map((text): DiffLine => ({ kind: "removed", text }))),
		...now.split("\n").map((text): DiffLine => ({ kind: "added", text })),
	];
}

import { describe, expect, it } from "bun:test";
import { tool } from "../fixtures";
import { notesRead, readsMarkdown } from "./match";

describe("notesRead", () => {
	const notes = [
		{
			path: "/repo/notes/retries.md",
			description: "Retry only transient failures",
		},
	];
	const read = tool({
		kind: "read",
		paths: ["/tasks/fix/notes/retries.md"],
	});

	it("finds file reads in worktrees and cat commands, without matching mentions in echo or edits", () => {
		expect(notesRead(read, notes, "/repo", "/tasks/fix")).toEqual(notes);
		expect(
			[
				"cat 'notes/retries.md' notes/retries.md",
				"pwd && cat notes/retries.md",
				"head -20 /repo/notes/retries.md",
			].map((command) => notesRead(tool({ command }), notes, "/repo", "/repo")),
		).toEqual([notes, notes, notes]);
		expect(
			notesRead({ ...read, kind: "edit" }, notes, "/repo", "/tasks/fix"),
		).toEqual([]);
		expect(
			notesRead(
				tool({ command: 'echo "cat notes/retries.md"' }),
				notes,
				"/repo",
				"/repo",
			),
		).toEqual([]);
		expect(
			notesRead(tool({ command: "splates notes" }), notes, "/repo", "/repo"),
		).toEqual([]);
	});

	it("tells a markdown read from any other before the notes are listed", () => {
		expect(readsMarkdown(read)).toBe(true);
		expect(readsMarkdown(tool({ command: "cat package.json" }))).toBe(false);
		expect(readsMarkdown(tool({ command: "splates notes" }))).toBe(false);
	});
});

import { describe, expect, it } from "bun:test";
import { editLines, parseDiff } from "./diff";

describe("parseDiff", () => {
	it("reads files, hunks and lines, counting what each adds and removes", () => {
		const text = [
			"diff --git a/src/a.ts b/src/a.ts",
			"index 1111111..2222222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1,3 +1,3 @@ export function a() {",
			" keep",
			"-old",
			"+new",
			"@@ -10,2 +10,3 @@",
			" more",
			"+added",
			"\\ No newline at end of file",
			"diff --git a/new.ts b/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/new.ts",
			"@@ -0,0 +1 @@",
			"+hello",
			"diff --git a/gone.ts b/gone.ts",
			"deleted file mode 100644",
			"--- a/gone.ts",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"--- bye",
			"",
		].join("\n");

		expect(parseDiff(text)).toEqual([
			{
				path: "src/a.ts",
				from: null,
				status: "modified",
				added: 2,
				removed: 1,
				binary: false,
				uncommitted: false,
				hunks: [
					{
						range: "@@ -1,3 +1,3 @@",
						lines: [
							{ kind: "context", text: "keep" },
							{ kind: "removed", text: "old" },
							{ kind: "added", text: "new" },
						],
					},
					{
						range: "@@ -10,2 +10,3 @@",
						lines: [
							{ kind: "context", text: "more" },
							{ kind: "added", text: "added" },
						],
					},
				],
			},
			{
				path: "new.ts",
				from: null,
				status: "added",
				added: 1,
				removed: 0,
				binary: false,
				uncommitted: false,
				hunks: [
					{ range: "@@ -0,0 +1 @@", lines: [{ kind: "added", text: "hello" }] },
				],
			},
			{
				path: "gone.ts",
				from: null,
				status: "deleted",
				added: 0,
				removed: 1,
				binary: false,
				uncommitted: false,
				hunks: [
					{
						range: "@@ -1 +0,0 @@",
						lines: [{ kind: "removed", text: "-- bye" }],
					},
				],
			},
		]);
	});

	it("names where a moved file came from, and marks a binary one", () => {
		const text = [
			"diff --git a/old.ts b/new.ts",
			"similarity index 100%",
			"rename from old.ts",
			"rename to new.ts",
			"diff --git a/logo.png b/logo.png",
			"Binary files a/logo.png and b/logo.png differ",
		].join("\n");

		expect(
			parseDiff(text).map(({ path, from, status, binary }) => ({
				path,
				from,
				status,
				binary,
			})),
		).toEqual([
			{ path: "new.ts", from: "old.ts", status: "renamed", binary: false },
			{ path: "logo.png", from: null, status: "modified", binary: true },
		]);
	});
});

describe("editLines", () => {
	it("puts what an edit took out before what it put in", () => {
		expect(editLines("a\nb", "c")).toEqual([
			{ kind: "removed", text: "a" },
			{ kind: "removed", text: "b" },
			{ kind: "added", text: "c" },
		]);
		expect(editLines(null, "new")).toEqual([{ kind: "added", text: "new" }]);
	});
});

import { describe, expect, it } from "bun:test";
import type { Commit } from "./git";
import { SPLIT, systemsReport } from "./system-changes";
import { Systems } from "./systems";

function commit(files: string[]): Commit {
	return {
		hash: "h",
		at: "2026-10-14T00:00:00Z",
		author: "Ada",
		subject: "s",
		files,
	};
}

describe("systemsReport", () => {
	it("groups the files no system covers by directory, the busiest groups of several first", () => {
		const files = [
			"docs/a.md",
			"README.md",
			"src/a.ts",
			"src/b.ts",
			"lib/c.ts",
		];

		const report = systemsReport(
			Systems.of({ docs: { globs: ["docs/**"] } }),
			files,
			[
				commit(["lib/c.ts"]),
				commit(["lib/c.ts", "docs/a.md"]),
				// Two files in one group count as one change to it.
				commit(["src/a.ts", "src/b.ts"]),
			],
		);

		expect(report.uncovered).toBe(4);
		// A lone file goes after a group of several, however busy.
		expect(report.groups).toEqual([
			{ glob: "src/*", files: 2, changed: 1 },
			{ glob: "lib/*", files: 1, changed: 2 },
			{ glob: "*", files: 1, changed: 0 },
		]);
	});

	it("splits a crowded directory by the first word of each name", () => {
		const many = Array.from(
			{ length: SPLIT },
			(_, at) => `app/tunnel-${at}.ts`,
		);
		const report = systemsReport(
			Systems.of({}),
			[...many, "app/age.ts", "app/.gitignore"],
			[commit(["app/tunnel-1.ts"])],
		);

		expect(report.groups).toEqual([
			{ glob: "app/tunnel*", files: SPLIT, changed: 1 },
			{ glob: "app/.gitignore*", files: 1, changed: 0 },
			{ glob: "app/age*", files: 1, changed: 0 },
		]);
	});

	it("counts how often each system changed alongside each other, the most first", () => {
		const report = systemsReport(
			Systems.of({
				board: { globs: ["board/**"] },
				skills: { globs: ["skills/**"] },
				stats: { globs: ["stats/**"] },
			}),
			[],
			[
				commit(["board/a.ts", "skills/a.md"]),
				commit(["board/b.ts", "stats/a.ts", "skills/a.md"]),
				commit(["board/a.ts", "board/b.ts"]),
				commit(["stats/a.ts", "skills/a.md"]),
			],
		);

		const overlaps = (name: string) =>
			report.systems.find((each) => each.name === name)?.overlaps;
		expect(overlaps("board")).toEqual([
			{ name: "skills", changed: 2 },
			{ name: "stats", changed: 1 },
		]);
		expect(overlaps("stats")).toEqual([
			{ name: "skills", changed: 2 },
			{ name: "board", changed: 1 },
		]);
	});
});

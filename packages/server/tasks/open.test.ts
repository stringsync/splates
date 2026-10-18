import { describe, expect, it } from "bun:test";
import { inTree } from "./open";

describe("inTree", () => {
	const trees = { root: "/repo", worktrees: "/repo-splates" };
	const there =
		(...present: string[]) =>
		async (path: string) =>
			present.includes(path);

	it("opens a task's file inside its worktree", async () => {
		expect(
			await inTree(
				"/repo-splates/alpha/src/a.ts",
				trees,
				there("/repo-splates/alpha"),
			),
		).toEqual({
			tree: "/repo-splates/alpha",
			file: "/repo-splates/alpha/src/a.ts",
		});
	});

	it("opens a gone worktree's file at its place in the main tree", async () => {
		expect(
			await inTree("/repo-splates/alpha/src/a.ts", trees, there()),
		).toEqual({
			tree: "/repo",
			file: "/repo/src/a.ts",
		});
	});

	it("opens a main tree's file inside the main tree", async () => {
		expect(await inTree("/repo/src/a.ts", trees, there())).toEqual({
			tree: "/repo",
			file: "/repo/src/a.ts",
		});
	});

	it("opens nothing outside the project's trees", async () => {
		expect(await inTree("/etc/passwd", trees, there())).toBeNull();
		expect(await inTree("/repo/../etc/passwd", trees, there())).toBeNull();
		expect(await inTree("/repository/a.ts", trees, there())).toBeNull();
	});
});

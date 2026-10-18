import { describe, expect, it } from "bun:test";
import { movedProjects, rewriteRoots } from "./paths";

const ROOT = "/Users/me/Projects/splates";
const WORKTREES = "/Users/me/Projects/splates-splates.noindex";

describe("rewriteRoots", () => {
	const projects = movedProjects([{ slug: "splates", root: ROOT }]);

	it("puts a root as the box's clone, and leaves the worktree root named for it", () => {
		const text = JSON.stringify({
			roots: [ROOT],
			grants: { [ROOT]: "tasks" },
			worktree: `${WORKTREES}/fix`,
			under: `${ROOT}/packages`,
		});

		expect(JSON.parse(rewriteRoots(text, projects))).toEqual({
			roots: ["/home/splates/projects/splates"],
			grants: { "/home/splates/projects/splates": "tasks" },
			worktree: `${WORKTREES}/fix`,
			under: `${ROOT}/packages`,
		});
	});

	it("refuses two projects of one name, which would share a clone", () => {
		expect(() =>
			movedProjects([
				{ slug: "splates", root: ROOT },
				{ slug: "splates-2", root: "/Users/me/old/splates" },
			]),
		).toThrow("share the name splates");
	});
});

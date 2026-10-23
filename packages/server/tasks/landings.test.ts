import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";
import { landingNotice, landingsOverlapping } from "./landings";

describe("landings overlapping an open task", () => {
	// scry-ignore simple-test-setup: the landing and the open task are the scenario.
	it("names a landed task's shared files until the branch rebases past it", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "README.md", "task\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk\n", "another landing");
		const commit = (await deps.git.run(deps.root, "rev-parse", "HEAD")).stdout;
		await deps.service.finished.record({
			id: 99,
			task: "beta",
			subject: "beta",
			ended: "merged",
			reason: null,
			base: worktree.base,
			commit,
			startedAt: new Date(0).toISOString(),
			endedAt: new Date().toISOString(),
			conversation: null,
			took: [],
			plan: "",
		});

		const landings = await landingsOverlapping(
			await deps.service.find("alpha"),
		);
		expect(landings).toEqual([{ task: "beta", commit, files: ["README.md"] }]);
		expect(
			landingNotice({ task: "beta", commit, files: ["README.md"] }, "main"),
		).toBe(
			`beta landed as ${commit.slice(0, 8)}, changing README.md you also changed: rebase onto main and rerun the tests that cover them`,
		);

		await deps.git.run(worktree.path, "merge", "-s", "ours", "main", "-m", "m");
		expect(await landingsOverlapping(await deps.service.find("alpha"))).toEqual(
			[],
		);
	});
});

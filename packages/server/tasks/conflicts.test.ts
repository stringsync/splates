import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";
import { ConflictChecks } from "./conflicts";
import { list } from "./list";
import { TaskOverlaps } from "./overlaps";
import { show } from "./show";

describe("early conflict checks", () => {
	// scry-ignore simple-test-setup: the conflicting commits and dirty file are the scenario this test exercises, not shared setup.
	it("predicts conflicts, keeps dirty files and leases untouched, and clears resolved warnings", async () => {
		await using deps = await Testing.open();
		await deps.commit(deps.root, "with spaces.txt", "seed\n", "another file");
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "with spaces.txt", "task\n", "task edit");
		await deps.commit(deps.root, "with spaces.txt", "trunk\n", "trunk edit");
		await deps.fs.write(`${worktree.path}/dirty.txt`, "keep this\n");
		const head = await deps.gitCli(worktree.path, "rev-parse", "HEAD");
		const before = worktree.state;
		const checks = new ConflictChecks(deps.storage);

		expect(await checks.check(worktree)).toMatchObject({
			fresh: true,
			conflict: { files: ["with spaces.txt"] },
		});
		expect(await checks.check(worktree)).toMatchObject({ fresh: false });
		expect((await deps.service.find("alpha")).state).toEqual(before);
		expect(await deps.gitCli(worktree.path, "rev-parse", "HEAD")).toBe(head);
		expect(await deps.fs.read(`${worktree.path}/dirty.txt`)).toBe(
			"keep this\n",
		);
		await list(deps);
		await show(deps, "alpha");
		expect(deps.out()).toContain(
			"coming conflict (committed tips): with spaces.txt",
		);

		await deps.commit(
			worktree.path,
			"with spaces.txt",
			"trunk\n",
			"align the edit",
		);
		expect(await checks.check(await deps.service.find("alpha"))).toBeNull();
		expect((await checks.read("alpha"))?.files).toEqual([]);
	});

	it("warns when a goal names an open task's changed file, including uncommitted work", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const alpha = await deps.service.find("alpha");
		await deps.fs.write(`${alpha.path}/README.md`, "pending\n");
		await add(deps, "beta", { goal: "Update `README.md`" });
		expect(deps.out()).toContain("overlap with alpha: README.md");
		expect(
			await new TaskOverlaps(deps.service).warnings("beta", "", ["README.md"]),
		).toEqual([
			"overlap with alpha: README.md; coordinate the work or queue it with --blocked-by",
		]);
		expect(
			await new TaskOverlaps(deps.service).warnings(
				"beta",
				"Different work",
				[],
			),
		).toEqual([]);
	});
});

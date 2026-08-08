import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Config } from "../lib/config";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";

/** Called per test rather than once per describe: these run concurrently. */
async function setup(overrides: Partial<Config> = {}) {
	const r = await repo();
	const config = testConfig(r.root, overrides);
	const store = new WorktreeStore(
		r.fs,
		r.ps,
		new Git(r.ps, r.fs, r.root),
		config,
		r.arborDir,
	);
	await store.init();
	return {
		...r,
		config,
		store,
		shell: new Shell(r.ps),
	};
}

describe("create", () => {
	test("makes a worktree, a branch and a record", async () => {
		const d = await setup();

		await create(d, "alpha");

		const state = (await d.store.find("alpha")).state;
		expect(state).toMatchObject({
			task: "alpha",
			branch: "task/alpha",
			status: "working",
			graftAttempts: 0,
		});
		expect(await d.fs.exists(join(state?.worktree ?? "", "README.md"))).toBe(
			true,
		);
		expect(
			await d.gitCli(
				state?.worktree ?? "",
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			),
		).toBe("task/alpha");
		expect(d.out()).toContain("created alpha");
		await d.cleanup();
	});

	test("refuses a name that is already taken and points at claim", async () => {
		const d = await setup();
		await create(d, "alpha");

		const exit = await bails(create(d, "alpha"));

		expect(exit.reason).toBe("exists");
		expect(exit.message).toContain("arbor claim alpha");
		await d.cleanup();
	});

	test("rejects names that are not legal branch or directory names", async () => {
		const d = await setup();

		for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
			expect((await bails(create(d, name))).reason).toBe("usage");
		}
		await d.cleanup();
	});

	test("reports a failed postCreate hook but keeps the worktree", async () => {
		const d = await setup({ postCreate: "exit 3" });

		const exit = await bails(create(d, "alpha"));

		expect(exit.reason).toBe("hook_failed");
		const state = (await d.store.find("alpha")).state;
		expect(await d.fs.exists(state?.worktree ?? "")).toBe(true);
		await d.cleanup();
	});

	test("refuses with a reason, a message and the data behind it", async () => {
		const d = await setup();

		const exit = await bails(create(d, "Alpha"));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("invalid task name 'Alpha'");
		expect(exit.data).toEqual({ task: "Alpha" });
		await d.cleanup();
	});
});

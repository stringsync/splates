import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Config } from "../lib/config";
import { Failures } from "../lib/failures";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, raised, repo, testConfig } from "../lib/testing";
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
	const failures = new Failures();
	return {
		...r,
		config,
		store,
		shell: new Shell(r.ps),
		failures,
		raised: raised(failures),
	};
}

describe("create", () => {
	test("makes a worktree, a branch, a port and a record", async () => {
		const d = await setup();

		await create(d, d.failures, "alpha");

		const state = (await d.store.find("alpha")).state;
		expect(state).toMatchObject({
			task: "alpha",
			branch: "task/alpha",
			status: "working",
			graftAttempts: 0,
		});
		expect(state?.port).toBeGreaterThanOrEqual(3100);
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
		await create(d, d.failures, "alpha");

		const exit = await bails(create(d, d.failures, "alpha"));

		expect(exit.reason).toBe("exists");
		expect(exit.code).toBe(10);
		expect(d.raised.at(-1)?.message).toContain("arbor claim alpha");
		await d.cleanup();
	});

	test("rejects names that are not legal branch or directory names", async () => {
		const d = await setup();

		for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
			expect((await bails(create(d, d.failures, name))).reason).toBe("usage");
		}
		await d.cleanup();
	});

	test("reports a failed postCreate hook but keeps the worktree", async () => {
		const d = await setup({ postCreate: "exit 3" });

		const exit = await bails(create(d, d.failures, "alpha"));

		expect(exit.reason).toBe("hook_failed");
		expect(exit.code).toBe(9);
		const state = (await d.store.find("alpha")).state;
		expect(await d.fs.exists(state?.worktree ?? "")).toBe(true);
		await d.cleanup();
	});

	test("raises a fail event carrying the reason and its data", async () => {
		const d = await setup();

		await bails(create(d, d.failures, "Alpha"));

		expect(d.raised).toEqual([
			{
				reason: "usage",
				message: expect.stringContaining("invalid task name 'Alpha'"),
				data: { task: "Alpha" },
			},
		]);
		await d.cleanup();
	});
});

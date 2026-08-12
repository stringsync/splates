import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { Config } from "../config";
import { Git } from "../git";
import { Shell } from "../shell";
import { bails, repo, testConfig } from "../testing";
import { WorktreeStore } from "../worktree-store";
import { create } from "./create";

describe("create", () => {
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const r = await repo();
		const config = testConfig(r.root);
		const store = new WorktreeStore(
			r.fs,
			r.ps,
			new Git(r.ps, r.fs, r.root),
			config,
			r.arborDir,
		);
		await store.init();
		d = { ...r, config, store, shell: new Shell(r.ps) };
	});

	afterEach(() => d.cleanup());

	it("makes a worktree, a branch and a record", async () => {
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
	});

	it("refuses a name that is already taken and points at claim", async () => {
		await create(d, "alpha");

		const exit = await bails(create(d, "alpha"));

		expect(exit.reason).toBe("exists");
		expect(exit.message).toContain("arbor claim alpha");
	});

	it("rejects names that are not legal branch or directory names", async () => {
		for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
			expect((await bails(create(d, name))).reason).toBe("usage");
		}
	});

	it("reports a failed postCreate hook but keeps the worktree", async () => {
		d.config = testConfig(d.root, { postCreate: "exit 3" });

		const exit = await bails(create(d, "alpha"));

		expect(exit.reason).toBe("hook_failed");
		const state = (await d.store.find("alpha")).state;
		expect(await d.fs.exists(state?.worktree ?? "")).toBe(true);
	});

	it("refuses with a reason, a message and the data behind it", async () => {
		const exit = await bails(create(d, "Alpha"));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("invalid task name 'Alpha'");
		expect(exit.data).toEqual({ task: "Alpha" });
	});
});

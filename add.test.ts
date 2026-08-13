import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("add", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			new Git(fixture.ps, fixture.fs, fixture.root),
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = { ...fixture, config, store, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("makes a worktree, a branch and a record", async () => {
		await add(deps, "alpha");

		const state = (await deps.store.find("alpha")).state;
		expect(state).toMatchObject({
			task: "alpha",
			branch: "task/alpha",
			status: "working",
			mergeAttempts: 0,
		});
		expect(await deps.fs.exists(join(state?.worktree ?? "", "README.md"))).toBe(
			true,
		);
		expect(
			await deps.gitCli(
				state?.worktree ?? "",
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			),
		).toBe("task/alpha");
		expect(deps.out()).toContain("added alpha");
	});

	it("refuses a name that is already taken and points at claim", async () => {
		await add(deps, "alpha");

		const exit = await bails(add(deps, "alpha"));

		expect(exit.reason).toBe("exists");
		expect(exit.message).toContain("arbor claim alpha");
	});

	it("rejects names that are not legal branch or directory names", async () => {
		for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
			expect((await bails(add(deps, name))).reason).toBe("usage");
		}
	});

	it("reports a failed postCheckout hook but keeps the worktree", async () => {
		deps.config = testConfig(deps.root, { postCheckout: "exit 3" });

		const exit = await bails(add(deps, "alpha"));

		expect(exit.reason).toBe("hook_failed");
		const state = (await deps.store.find("alpha")).state;
		expect(await deps.fs.exists(state?.worktree ?? "")).toBe(true);
	});

	it("refuses with a reason, a message and the data behind it", async () => {
		const exit = await bails(add(deps, "Alpha"));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("invalid task name 'Alpha'");
		expect(exit.data).toEqual({ task: "Alpha" });
	});
});

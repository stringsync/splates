import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { rm } from "./rm";
import { Shell } from "./shell";
import { bails, LIVE_PID, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("rm", () => {
	// `shell` is only here for the `create` calls that arrange each test.
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

	it("removes everything and says what was thrown away", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.store.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

		await rm(deps, "alpha");

		expect(deps.out()).toContain("discarded 1 commit(s)");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.fs.exists(deps.store.recordPath("alpha"))).toBe(false);
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("tells 'already removed' apart from 'never existed'", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");

		expect((await bails(rm(deps, "alpha"))).reason).toBe("already_removed");
		expect((await bails(rm(deps, "never"))).reason).toBe("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.store.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		await rm(deps, "alpha");

		expect(deps.out()).toContain("already gone");
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await add(deps, "alpha");
		const worktree = await (await deps.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(rm(deps, "alpha"));

		expect(exit.reason).toBe("lease_held");
		expect(exit.message).toContain("--force");

		await rm(deps, "alpha", { force: true });
		expect(await deps.fs.exists(worktree.path)).toBe(false);
	});
});

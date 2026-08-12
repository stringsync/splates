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

	it("removes everything and says what was thrown away", async () => {
		await add(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

		await rm(d, "alpha");

		expect(d.out()).toContain("discarded 1 commit(s)");
		expect(await d.fs.exists(worktree)).toBe(false);
		expect(await d.fs.exists(d.store.recordPath("alpha"))).toBe(false);
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
	});

	it("tells 'already removed' apart from 'never existed'", async () => {
		await add(d, "alpha");
		await rm(d, "alpha");

		expect((await bails(rm(d, "alpha"))).reason).toBe("already_removed");
		expect((await bails(rm(d, "never"))).reason).toBe("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await add(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.rm(worktree, { recursive: true, force: true });

		await rm(d, "alpha");

		expect(d.out()).toContain("already gone");
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await add(d, "alpha");
		const worktree = await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(rm(d, "alpha"));

		expect(exit.reason).toBe("lease_held");
		expect(exit.message).toContain("--force");

		await rm(d, "alpha", { force: true });
		expect(await d.fs.exists(worktree.path)).toBe(false);
	});
});

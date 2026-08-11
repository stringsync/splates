import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Config } from "../lib/config";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, LIVE_PID, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { prune } from "./prune";

describe("prune", () => {
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
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

		await prune(d, "alpha");

		expect(d.out()).toContain("discarded 1 commit(s)");
		expect(await d.fs.exists(worktree)).toBe(false);
		expect(await d.fs.exists(d.store.recordPath("alpha"))).toBe(false);
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
	});

	it("tells 'already pruned' apart from 'never existed'", async () => {
		await create(d, "alpha");
		await prune(d, "alpha");

		expect((await bails(prune(d, "alpha"))).reason).toBe("already_pruned");
		expect((await bails(prune(d, "never"))).reason).toBe("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.rm(worktree, { recursive: true, force: true });

		await prune(d, "alpha");

		expect(d.out()).toContain("already gone");
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await create(d, "alpha");
		const worktree = await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(prune(d, "alpha"));

		expect(exit.reason).toBe("lease_live");
		expect(exit.message).toContain("--force");

		await prune(d, "alpha", { force: true });
		expect(await d.fs.exists(worktree.path)).toBe(false);
	});
});
